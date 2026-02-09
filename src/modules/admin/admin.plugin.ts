// ============================================
// ADMIN PLUGIN
// ============================================
// Fastify plugin for admin module registration

import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { adminRoutes } from './admin.routes';

async function adminPlugin(app: FastifyInstance) {
    // Register admin routes under /api/admin prefix
    await app.register(adminRoutes, { prefix: '/api/admin' });
}

export default fp(adminPlugin, {
    name: 'admin-plugin'
});
