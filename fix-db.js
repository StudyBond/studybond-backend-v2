const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
  try {
    console.log("Dropping conflicting index constraints from the database...");
    
    // Drop the unique constraints if they exist
    await prisma.$executeRawUnsafe(`ALTER TABLE "Exam" DROP CONSTRAINT IF EXISTS "Exam_userId_originalExamId_attemptNumber_key" CASCADE;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "ExamAnswer" DROP CONSTRAINT IF EXISTS "ExamAnswer_examId_questionId_key" CASCADE;`);

    // Drop the indexes if they exist (in Postgres, constraints create indexes with the same name)
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "Exam_userId_originalExamId_attemptNumber_key" CASCADE;`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "ExamAnswer_examId_questionId_key" CASCADE;`);
    
    console.log("✅ Conflicts cleared! You can now run 'npx prisma db push' again.");
  } catch (error) {
    console.error("Failed to drop constraints:", error);
  } finally {
    await prisma.$disconnect();
  }
}

fix();
