import 'dotenv/config'; // MUST be first — loads .env before any module reads process.env
import { prisma } from './src/config/database';

async function seed() {
  try {
    console.log("Seeding default UI institution...");
    
    const existing = await prisma.institution.findUnique({
      where: { code: 'UI' }
    });

    if (existing) {
      console.log("Institution UI already exists.");
    } else {
      await prisma.institution.create({
        data: {
          code: 'UI',
          name: 'University of Ibadan',
          slug: 'university-of-ibadan',
          isActive: true
        }
      });
      console.log("✅ Default Institution 'UI' seeded successfully!");
    }
  } catch (error) {
    console.error("Failed to seed institution:", error);
  } finally {
    await prisma.$disconnect();
  }
}

seed();
