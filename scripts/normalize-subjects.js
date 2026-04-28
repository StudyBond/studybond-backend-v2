#!/usr/bin/env node

/**
 * Script to normalize all question subjects to canonical values
 * Maps variants like "English Language", "Use of English" → "English"
 *
 * Usage: node scripts/normalize-subjects.js
 * or: npm run normalize:subjects
 */

require("dotenv").config({ quiet: true });

const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

const SUBJECT_CANONICAL_MAP = {
  english: "English",
  "english language": "English",
  "use of english": "English",
  mathematics: "Mathematics",
  maths: "Mathematics",
  math: "Mathematics",
  physics: "Physics",
  chemistry: "Chemistry",
  biology: "Biology",
};

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSubjectLabel(subject) {
  const trimmed =
    typeof subject === "string" ? normalizeWhitespace(subject) : "";
  if (!trimmed) {
    return "";
  }

  return SUBJECT_CANONICAL_MAP[trimmed.toLowerCase()] ?? trimmed;
}

async function normalizeSubjects() {
  let prisma;

  try {
    // Initialize Prisma client
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });

    console.log("Starting subject normalization...\n");

    // Get all unique subjects in the database
    const uniqueSubjects = await prisma.question.findMany({
      select: { subject: true },
      distinct: ["subject"],
    });

    console.log(`Found ${uniqueSubjects.length} unique subjects\n`);

    const updateMap = new Map();

    // Build map of changes needed
    for (const record of uniqueSubjects) {
      if (!record.subject) continue;

      const canonical = normalizeSubjectLabel(record.subject);
      if (canonical !== record.subject) {
        const key = `${record.subject} → ${canonical}`;
        if (!updateMap.has(key)) {
          updateMap.set(key, { canonical, count: 0 });
        }
      }
    }

    if (updateMap.size === 0) {
      console.log("✓ All subjects are already normalized!");
      return;
    }

    console.log("Changes needed:");
    for (const [key] of updateMap) {
      console.log(`  ${key}`);
    }
    console.log();

    // Get total count of questions to update
    let totalUpdates = 0;
    for (const record of uniqueSubjects) {
      if (!record.subject) continue;
      const canonical = normalizeSubjectLabel(record.subject);
      if (canonical !== record.subject) {
        const count = await prisma.question.count({
          where: { subject: record.subject },
        });
        totalUpdates += count;
      }
    }

    console.log(`Total questions to update: ${totalUpdates}\n`);

    // Perform updates
    let updatedCount = 0;
    for (const record of uniqueSubjects) {
      if (!record.subject) continue;

      const canonical = normalizeSubjectLabel(record.subject);
      if (canonical !== record.subject) {
        const result = await prisma.question.updateMany({
          where: { subject: record.subject },
          data: { subject: canonical },
        });

        updatedCount += result.count;
        console.log(
          `✓ Updated ${result.count} questions: "${record.subject}" → "${canonical}"`,
        );
      }
    }

    console.log(
      `\n✓ Normalization complete! Updated ${updatedCount} questions.`,
    );
  } catch (error) {
    console.error("Error during normalization:", error);
    process.exit(1);
  } finally {
    if (prisma) {
      await prisma.$disconnect();
    }
  }
}

normalizeSubjects();
