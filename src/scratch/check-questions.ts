import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkQuestions() {
  try {
    const totalQuestions = await prisma.question.count();
    console.log('Total Questions:', totalQuestions);

    const subjects = await prisma.question.groupBy({
      by: ['subject'],
      _count: {
        _all: true
      }
    });

    console.log('Questions by Subject:');
    subjects.forEach(s => {
      console.log(`${s.subject}: ${s._count._all}`);
    });

    if (totalQuestions === 0) {
        console.log('\nWARNING: Database is EMPTY. You need to upload questions for Daily Challenge to work.');
    }

  } catch (error) {
    console.error('Error checking database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkQuestions();
