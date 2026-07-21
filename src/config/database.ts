// DATABASE CONFIGURATION

import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
const { PrismaClient } = require('@prisma/client');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,

    // ── Connection pool sizing ──────────────────────────────────────
    // 20 connections max (safe for Supabase Free Tier 60 max).
    max: parseInt(process.env.PG_POOL_MAX || '20', 10),

    // ── Timeouts ────────────────────────────────────────────────────
    // Allow up to 15s for Supabase pooler connections (handles cold starts).
    connectionTimeoutMillis: parseInt(process.env.PG_CONNECT_TIMEOUT_MS || '15000', 10),

    // Release idle connections after 30s.
    idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS || '30000', 10),
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
