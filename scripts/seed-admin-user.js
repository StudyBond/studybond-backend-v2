#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient, Role } = require('@prisma/client');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const VALID_ROLES = new Set([Role.ADMIN, Role.SUPERADMIN]);
const DEFAULT_ROLE = Role.SUPERADMIN;
const DEFAULT_LAUNCH_INSTITUTION_CODE = process.env.LAUNCH_INSTITUTION_CODE || 'UI';

function printHelp() {
  console.log(`
StudyBond admin seeding helper

Usage:
  npm run seed:superadmin -- --email you@example.com
  npm run seed:admin -- --email you@example.com --password StrongPass123!
  npm run seed:admin-user -- --email you@example.com --role SUPERADMIN --name "Your Name"

Options:
  --email <value>         Required. Email address to create or promote.
  --role <value>          ADMIN or SUPERADMIN. Default: SUPERADMIN.
  --password <value>      Optional. Sets a password. If omitted for a new user, one is generated.
  --name <value>          Optional. Full name. Defaults to a name derived from the email for new users.
  --institution <value>   Optional. Institution code to attach. Default: ${DEFAULT_LAUNCH_INSTITUTION_CODE}.
  --allow-remote          Allow running against a non-local database host.
  --dry-run               Show the intended change without writing to the database.
  --help                  Show this help text.

Behavior:
  - Refuses to run when NODE_ENV=production.
  - Refuses remote database targets unless --allow-remote is provided.
  - Creates the user if missing, or promotes the existing user if present.
  - Marks the account verified and clears ban state so local admin login works immediately.
  - Preserves the existing password unless you pass --password.
`);
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith('--')) {
      continue;
    }

    const trimmed = token.slice(2);
    const eqIndex = trimmed.indexOf('=');

    if (eqIndex >= 0) {
      const key = trimmed.slice(0, eqIndex);
      const value = trimmed.slice(eqIndex + 1);
      args[key] = value === '' ? true : value;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[trimmed] = true;
      continue;
    }

    args[trimmed] = next;
    index += 1;
  }

  return args;
}

function resolveConnectionString() {
  return process.env.DIRECT_URL || process.env.DATABASE_URL || null;
}

function resolveHostName(connectionString) {
  try {
    const parsed = new URL(connectionString);
    return parsed.hostname || 'unknown';
  } catch {
    return 'unknown';
  }
}

function isLocalDatabaseHost(hostname) {
  return LOCAL_HOSTS.has(hostname);
}

function deriveFullName(email) {
  const localPart = String(email).split('@')[0] || 'StudyBond Admin';
  const cleaned = localPart
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return 'StudyBond Admin';
  }

  return cleaned
    .split(' ')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function generateTemporaryPassword() {
  return `StudyBond!${crypto.randomBytes(6).toString('hex')}`;
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

function normalizeRole(rawRole) {
  const candidate = String(rawRole || DEFAULT_ROLE).trim().toUpperCase();
  if (!VALID_ROLES.has(candidate)) {
    throw new Error(`Invalid role "${rawRole}". Use ADMIN or SUPERADMIN.`);
  }

  return candidate;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    throw new Error('Refusing to run seed-admin-user in production. This helper is dev-only.');
  }

  const email = String(args.email || '').trim().toLowerCase();
  if (!email) {
    throw new Error('Missing required --email argument.');
  }

  const role = normalizeRole(args.role);
  const connectionString = resolveConnectionString();
  if (!connectionString) {
    throw new Error('Missing DIRECT_URL or DATABASE_URL.');
  }

  const hostName = resolveHostName(connectionString);
  if (!isLocalDatabaseHost(hostName) && !args['allow-remote']) {
    throw new Error(
      `Resolved database host "${hostName}" is not local. ` +
      'Pass --allow-remote only if you intentionally want to seed a remote non-production database.'
    );
  }

  const institutionCode = String(args.institution || DEFAULT_LAUNCH_INSTITUTION_CODE).trim().toUpperCase();
  const dryRun = Boolean(args['dry-run']);
  const passwordInput = typeof args.password === 'string' ? args.password : '';
  const nameInput = typeof args.name === 'string' ? args.name.trim() : '';

  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: Number.parseInt(process.env.PGCONNECT_TIMEOUT_MS || '15000', 10),
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({
    adapter,
    log: ['error'],
  });

  try {
    await prisma.$connect();

    const institution = await prisma.institution.findUnique({
      where: { code: institutionCode },
      select: { id: true, code: true, name: true },
    });

    if (!institution) {
      throw new Error(
        `Institution "${institutionCode}" does not exist. ` +
        'Seed the institution first or pass a valid --institution code.'
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isVerified: true,
        isBanned: true,
        targetInstitutionId: true,
      },
    });

    const shouldCreate = !existingUser;
    const generatedPassword = shouldCreate && !passwordInput ? generateTemporaryPassword() : null;
    const effectivePassword = passwordInput || generatedPassword;
    const passwordHash = effectivePassword ? await hashPassword(effectivePassword) : null;
    const fullName = nameInput || existingUser?.fullName || deriveFullName(email);

    const updateData = {
      role,
      fullName,
      isVerified: true,
      verificationToken: null,
      tokenExpiresAt: null,
      isBanned: false,
      bannedAt: null,
      bannedReason: null,
      passwordResetToken: null,
      passwordResetExpires: null,
      passwordResetAttemptCount: 0,
      ...(passwordHash ? { passwordHash } : {}),
      ...((args.institution || !existingUser?.targetInstitutionId)
        ? { targetInstitutionId: institution.id }
        : {}),
    };

    const summaryLines = [
      `Database host: ${hostName}`,
      `Mode: ${dryRun ? 'dry-run' : 'apply'}`,
      `Institution: ${institution.code} (${institution.name})`,
      `Operation: ${shouldCreate ? 'create user' : 'promote/update existing user'}`,
      `Email: ${email}`,
      `Role: ${role}`,
      `Password: ${
        effectivePassword
          ? shouldCreate
            ? 'generated or supplied for the new account'
            : 'updated'
          : 'unchanged'
      }`,
      `Verification state: will be marked verified`,
      `Ban state: will be cleared`,
    ];

    console.log(summaryLines.map((line) => `- ${line}`).join('\n'));

    if (dryRun) {
      if (generatedPassword) {
        console.log(`\nGenerated password (dry-run preview): ${generatedPassword}`);
      }
      console.log('\nDry-run complete. No database changes were written.');
      return;
    }

    let persistedUser;
    if (shouldCreate) {
      persistedUser = await prisma.user.create({
        data: {
          email,
          passwordHash,
          fullName,
          role,
          isVerified: true,
          verificationToken: null,
          tokenExpiresAt: null,
          isBanned: false,
          bannedAt: null,
          bannedReason: null,
          passwordResetToken: null,
          passwordResetExpires: null,
          passwordResetAttemptCount: 0,
          targetInstitutionId: institution.id,
        },
        select: {
          id: true,
          email: true,
          role: true,
          fullName: true,
          isVerified: true,
          isBanned: true,
          targetInstitutionId: true,
        },
      });
    } else {
      persistedUser = await prisma.user.update({
        where: { email },
        data: updateData,
        select: {
          id: true,
          email: true,
          role: true,
          fullName: true,
          isVerified: true,
          isBanned: true,
          targetInstitutionId: true,
        },
      });
    }

    console.log('\nAdmin account is ready.');
    console.log(`- User ID: ${persistedUser.id}`);
    console.log(`- Email: ${persistedUser.email}`);
    console.log(`- Role: ${persistedUser.role}`);
    console.log(`- Full name: ${persistedUser.fullName}`);
    console.log(`- Verified: ${persistedUser.isVerified ? 'yes' : 'no'}`);
    console.log(`- Banned: ${persistedUser.isBanned ? 'yes' : 'no'}`);
    console.log(`- Institution ID: ${persistedUser.targetInstitutionId ?? 'none'}`);

    if (generatedPassword) {
      console.log(`- Temporary password: ${generatedPassword}`);
      console.log('  Save it now or rerun with --password to replace it.');
    } else if (passwordInput) {
      console.log('- Password: updated to the value you supplied.');
    } else {
      console.log('- Password: preserved from the existing account.');
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  const message = String(error?.message || error);
  const isConnectivityError = /(ECONNREFUSED|EACCES|ETIMEDOUT|timeout|can't reach database server|connect )/i.test(message);

  console.error('');

  if (isConnectivityError) {
    console.error(
      '[seed-admin-user] Database connection failed. ' +
      'Check DIRECT_URL/DATABASE_URL, confirm PostgreSQL is reachable, and use --allow-remote only for an intentional non-local dev database.'
    );
    console.error(`[seed-admin-user] Details: ${message}`);
    process.exit(1);
  }

  console.error(`[seed-admin-user] ${message}`);
  process.exit(1);
});
