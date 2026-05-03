import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkLeaderboardData() {
  const stats = await prisma.userInstitutionStats.findMany({
    include: {
      user: true,
      institution: true
    }
  });

  console.log('--- UserInstitutionStats ---');
  console.log(JSON.stringify(stats, null, 2));

  const count = await prisma.userInstitutionStats.count({
    where: {
      weeklySp: { gt: 0 }
    }
  });
  console.log('\n--- Count with weeklySp > 0 ---');
  console.log(count);
}

checkLeaderboardData()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
