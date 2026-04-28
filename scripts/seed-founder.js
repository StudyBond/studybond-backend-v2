#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const { spawnSync } = require('child_process');
const path = require('path');

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

function printHelp() {
  console.log(`
StudyBond founder seeding helper

Usage:
  npm run seed:founder -- --email founder@studybond.app --password StrongPass123!

Defaults:
  - role is always SUPERADMIN
  - email defaults to FOUNDER_ADMIN_EMAIL
  - name defaults to FOUNDER_ADMIN_NAME
  - password defaults to FOUNDER_ADMIN_PASSWORD if set

Supported options:
  --email <value>
  --name <value>
  --password <value>
  --institution <value>
  --allow-remote
  --dry-run
  --help
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const email = String(args.email || process.env.FOUNDER_ADMIN_EMAIL || '').trim();
  const name = String(args.name || process.env.FOUNDER_ADMIN_NAME || '').trim();
  const password = String(args.password || process.env.FOUNDER_ADMIN_PASSWORD || '').trim();
  const institution = String(args.institution || process.env.FOUNDER_ADMIN_INSTITUTION || '').trim();

  if (!email) {
    console.error('[seed-founder] Missing founder email. Pass --email or set FOUNDER_ADMIN_EMAIL.');
    process.exit(1);
  }

  const childArgs = [
    path.join(__dirname, 'seed-admin-user.js'),
    '--role=SUPERADMIN',
    `--email=${email}`,
  ];

  if (name) {
    childArgs.push(`--name=${name}`);
  }

  if (password) {
    childArgs.push(`--password=${password}`);
  }

  if (institution) {
    childArgs.push(`--institution=${institution}`);
  }

  if (args['allow-remote']) {
    childArgs.push('--allow-remote');
  }

  if (args['dry-run']) {
    childArgs.push('--dry-run');
  }

  const result = spawnSync(process.execPath, childArgs, {
    stdio: 'inherit',
    env: process.env,
  });

  if (typeof result.status === 'number') {
    process.exit(result.status);
  }

  console.error('[seed-founder] Failed to execute seed-admin-user helper.');
  process.exit(1);
}

main();
