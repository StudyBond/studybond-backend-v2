// DATABASE CONFIGURATION

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

/**
 * We use SINGLETON PATTERN
 * 
 * Why? In development, hot-reloading can create multiple Prisma instances
 * This causes "Too many Prisma clients" warnings
 * Solution: Store instance in globalThis
 */

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development'
        ? ['query', 'info', 'warn', 'error']
        : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

/**
 * CONNECT TO DATABASE
 * 
 * Tests the connection by running a simple query
 * Throws error if database is unreachable
 */
export async function connectDatabase(): Promise<void> {
    try {
        await prisma.$connect();
        console.log('✅ Database connected successfully');
    } catch (error) {
        console.error('❌ Database connection failed:', error);
        throw error;
    }
}

/**
 * DISCONNECT FROM DATABASE
 * 
 * Gracefully closes the connection
 * Call this on app shutdown
 */
export async function disconnectDatabase(): Promise<void> {
    await prisma.$disconnect();
    console.log('Database disconnected');
}

export default prisma;