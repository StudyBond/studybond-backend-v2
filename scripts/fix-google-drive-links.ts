
import 'dotenv/config';
import { prisma } from '../src/config/database';
import { normalizeImageUrl, normalizeTextImageUrls } from '../src/modules/questions/question-assets';

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

  // 2. Repair Explanation image URLs
  console.log('\nChecking Explanation image URLs...');
  const explanations = await prisma.explanation.findMany({
    where: {
      explanationImageUrl: { contains: 'drive.google.com' }
    }
  });

  console.log(`Found ${explanations.length} explanation images to repair.`);

  for (const exp of explanations) {
    await prisma.explanation.update({
      where: { id: exp.id },
      data: {
        explanationImageUrl: normalizeImageUrl(exp.explanationImageUrl)
      }
    });
    console.log(`  > Repaired Explanation image for Question ID: ${exp.questionId}`);
  }

  // 3. Repair Google Drive URLs embedded inside explanationText and additionalNotes
  console.log('\nChecking Explanation text content for embedded Drive links...');
  const textExplanations = await prisma.explanation.findMany({
    where: {
      OR: [
        { explanationText: { contains: 'drive.google.com' } },
        { additionalNotes: { contains: 'drive.google.com' } },
      ]
    }
  });

  console.log(`Found ${textExplanations.length} explanation texts to repair.`);

  for (const exp of textExplanations) {
    await prisma.explanation.update({
      where: { id: exp.id },
      data: {
        explanationText: normalizeTextImageUrls(exp.explanationText) ?? exp.explanationText,
        additionalNotes: normalizeTextImageUrls(exp.additionalNotes) ?? exp.additionalNotes,
      }
    });
    console.log(`  > Repaired Explanation text for Question ID: ${exp.questionId}`);
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
