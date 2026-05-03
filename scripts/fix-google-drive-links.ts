
import 'dotenv/config';
import { prisma } from '../src/config/database';
import { normalizeImageUrl } from '../src/modules/questions/question-assets';

async function main() {
  console.log('--- Starting Google Drive Link Repair ---');

  // 1. Repair Questions
  console.log('Checking Questions...');
  const questions = await prisma.question.findMany({
    where: {
      OR: [
        { imageUrl: { contains: 'drive.google.com' } },
        { optionAImageUrl: { contains: 'drive.google.com' } },
        { optionBImageUrl: { contains: 'drive.google.com' } },
        { optionCImageUrl: { contains: 'drive.google.com' } },
        { optionDImageUrl: { contains: 'drive.google.com' } },
        { optionEImageUrl: { contains: 'drive.google.com' } },
      ]
    }
  });

  console.log(`Found ${questions.length} questions to repair.`);

  for (const q of questions) {
    await prisma.question.update({
      where: { id: q.id },
      data: {
        imageUrl: normalizeImageUrl(q.imageUrl),
        optionAImageUrl: normalizeImageUrl(q.optionAImageUrl),
        optionBImageUrl: normalizeImageUrl(q.optionBImageUrl),
        optionCImageUrl: normalizeImageUrl(q.optionCImageUrl),
        optionDImageUrl: normalizeImageUrl(q.optionDImageUrl),
        optionEImageUrl: normalizeImageUrl(q.optionEImageUrl),
      }
    });
    console.log(`  > Repaired Question ID: ${q.id}`);
  }

  // 2. Repair Explanations
  console.log('\nChecking Explanations...');
  const explanations = await prisma.explanation.findMany({
    where: {
      explanationImageUrl: { contains: 'drive.google.com' }
    }
  });

  console.log(`Found ${explanations.length} explanations to repair.`);

  for (const exp of explanations) {
    await prisma.explanation.update({
      where: { id: exp.id },
      data: {
        explanationImageUrl: normalizeImageUrl(exp.explanationImageUrl)
      }
    });
    console.log(`  > Repaired Explanation for Question ID: ${exp.questionId}`);
  }

  console.log('\n--- Repair Completed Successfully ---');
}

main()
  .catch((e) => {
    console.error('Repair failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
