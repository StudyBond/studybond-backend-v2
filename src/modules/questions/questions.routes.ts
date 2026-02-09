
// ============================================
// QUESTIONS ROUTES
// ============================================
// API endpoint definitions

import { FastifyInstance } from 'fastify';
import { QuestionsController } from './questions.controller';
import { authenticate } from '../../shared/decorators/authenticate';
import { requireAdmin } from '../../shared/decorators/requireAdmin';

export async function questionsRoutes(app: FastifyInstance) {
    const controller = new QuestionsController();

    // All routes require authentication and admin privileges
    app.addHook('preHandler', authenticate);
    app.addHook('preHandler', requireAdmin);

    // Create
    app.post('/', controller.createQuestion);

    // Read
    app.get('/', controller.getQuestions);
    app.get('/:id', controller.getQuestionById);

    // Update
    app.put('/:id', controller.updateQuestion);

    // Delete
    app.delete('/:id', controller.deleteQuestion);

    // Bulk Upload (CSV/Excel)
    app.post('/bulk', controller.bulkUpload);

    app.log.info('Questions routes registered');
}
