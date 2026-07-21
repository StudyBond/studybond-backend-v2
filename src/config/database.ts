// DATABASE CONFIGURATION

import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
const { PrismaClient } = require('@prisma/client');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,

    // ── Connection pool sizing ──────────────────────────────────────
    // 20 is safe for Supabase free (60 max) and Render starter (97 max).
    // Increase to 30-50 if you upgrade your DB plan.
    max: parseInt(process.env.PG_POOL_MAX || '20', 10),

    // ── Timeouts ────────────────────────────────────────────────────
    // Fail fast instead of queuing forever when the pool is saturated.
    connectionTimeoutMillis: parseInt(process.env.PG_CONNECT_TIMEOUT_MS || '5000', 10),

    // Release idle connections after 30s to free DB slots for other
    // services (workers, jobs) sharing the same Postgres instance.
    idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS || '30000', 10),

    // Kill any query running longer than 15s — prevents a single
    // runaway query from holding a connection slot indefinitely.
    statement_timeout: parseInt(process.env.PG_STATEMENT_TIMEOUT_MS || '15000', 10),
});

const adapter = new PrismaPg(pool);

/**
 * We use SINGLETON PATTERN
 * 
 * Why? In development, hot-reloading can create multiple Prisma instances
 * This causes "Too many Prisma clients" warnings
 * Solution: Store instance in globalThis
 */

const globalForPrisma = globalThis as unknown as {
    prisma: any | undefined;
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
        console.log('Database connected successfully');
    } catch (error) {
        console.error('Database connection failed:', error);
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
    console.log('Database disconnected.');
}

export default prisma;
