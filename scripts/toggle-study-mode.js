#!/usr/bin/env node

require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function printHelp() {
  console.log(`
StudyBond Study Mode Admin Toggle Helper

Usage:
  npm run study-mode:toggle -- --institution UI --enable
  npm run study-mode:toggle -- --institution UI --disable
  npm run study-mode:toggle -- --institution UI --status

Options:
  --institution <code|id>   Required. Institution code (e.g., UI, OAU, UNILAG) or numeric ID.
  --enable                  Enable Study Mode for the institution.
  --disable                 Disable Study Mode for the institution.
  --status                  Show current Study Mode status for the institution.
  --help                    Show this help text.
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length === 0) {
    printHelp();
    process.exit(0);
  }

  const instIndex = args.indexOf('--institution');
  if (instIndex === -1 || !args[instIndex + 1]) {
    console.error('Error: Missing required argument --institution <code|id>');
    printHelp();
    process.exit(1);
  }

  const instArg = args[instIndex + 1].trim();
  const shouldEnable = args.includes('--enable');
  const shouldDisable = args.includes('--disable');
  const isStatusCheck = args.includes('--status');

  if (!shouldEnable && !shouldDisable && !isStatusCheck) {
    console.error('Error: Specify one action: --enable, --disable, or --status');
    printHelp();
    process.exit(1);
  }

  try {
    // Find institution by ID or Code
    const isNumeric = /^\d+$/.test(instArg);
    const institution = await prisma.institution.findFirst({
      where: isNumeric
        ? { id: parseInt(instArg, 10) }
        : { code: instArg.toUpperCase() },
      include: {
        examConfigs: {
          where: { isActive: true }
        }
      }
    });

    if (!institution) {
      console.error(`Error: Institution '${instArg}' not found in database.`);
      process.exit(1);
    }

    const activeConfig = institution.examConfigs[0];
    if (!activeConfig) {
      console.error(`Error: No active InstitutionExamConfig found for '${institution.name}' (${institution.code}).`);
      process.exit(1);
    }

    if (isStatusCheck) {
      console.log(`\n🏫 Institution: ${institution.name} (${institution.code})`);
      console.log(`📌 Study Mode Status: ${activeConfig.studyModeEnabled ? '✅ ENABLED' : '🔒 DISABLED'}\n`);
      process.exit(0);
    }

    const newStatus = shouldEnable;
    await prisma.institutionExamConfig.update({
      where: { id: activeConfig.id },
      data: { studyModeEnabled: newStatus }
    });

    console.log(`\n🎉 Success!`);
    console.log(`🏫 Institution: ${institution.name} (${institution.code})`);
    console.log(`📌 Study Mode is now: ${newStatus ? '✅ ENABLED (Visible to students)' : '🔒 DISABLED (Hidden from students)'}\n`);

  } catch (error) {
    console.error('Failed to update Study Mode status:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
