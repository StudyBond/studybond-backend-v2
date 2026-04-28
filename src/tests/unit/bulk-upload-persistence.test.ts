import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  questionCreate: vi.fn(),
  explanationCreate: vi.fn(),
  transaction: vi.fn(),
  resolveManagedQuestionAsset: vi.fn(),
  cleanupQuestionAssets: vi.fn(),
  resolveByCode: vi.fn(),
  lockFreeExamSubjects: vi.fn(),
  ensureFreeExamPoolCapacity: vi.fn()
}));

mocks.transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) =>
  callback({
    question: {
      create: mocks.questionCreate
    },
    explanation: {
      create: mocks.explanationCreate
    }
  })
);

vi.mock('../../config/database', () => {
  const prismaMock = {
    $transaction: mocks.transaction
  };

  return {
    __esModule: true,
    default: prismaMock,
    prisma: prismaMock
  };
});

mocks.resolveManagedQuestionAsset.mockImplementation(async ({ url }: { url?: string | null }) => ({
  url: url ?? null,
  publicId: null,
  uploadedAsset: null
}));

mocks.cleanupQuestionAssets.mockImplementation(async () => undefined);

vi.mock('../../modules/questions/question-assets', () => ({
  resolveManagedQuestionAsset: mocks.resolveManagedQuestionAsset,
  cleanupQuestionAssets: mocks.cleanupQuestionAssets
}));

mocks.resolveByCode.mockImplementation(async () => ({
  id: 42,
  code: 'UI',
  name: 'University of Ibadan',
  slug: 'ui'
}));

vi.mock('../../shared/institutions/context', () => ({
  institutionContextService: {
    resolveByCode: mocks.resolveByCode
  }
}));

mocks.lockFreeExamSubjects.mockImplementation(async () => undefined);
mocks.ensureFreeExamPoolCapacity.mockImplementation(async () => undefined);

vi.mock('../../modules/questions/question-pool', () => ({
  lockFreeExamSubjects: mocks.lockFreeExamSubjects,
  ensureFreeExamPoolCapacity: mocks.ensureFreeExamPoolCapacity
}));

import { processBulkUpload } from '../../modules/questions/bulk-upload';

describe('processBulkUpload persistence order', () => {
  beforeEach(() => {
    mocks.questionCreate.mockReset();
    mocks.explanationCreate.mockReset();
    mocks.transaction.mockClear();
    mocks.cleanupQuestionAssets.mockClear();
    mocks.resolveByCode.mockClear();
    mocks.lockFreeExamSubjects.mockClear();
    mocks.ensureFreeExamPoolCapacity.mockClear();

    mocks.questionCreate.mockResolvedValue({ id: 901 });
    mocks.explanationCreate.mockResolvedValue({ id: 7001 });
  });

  it('creates the question first and attaches explanation with the created question id', async () => {
    const result = await processBulkUpload([
      {
        questionText: 'What is 2 + 2?',
        optionA: '3',
        optionB: '4',
        optionC: '5',
        optionD: '6',
        optionE: null,
        correctAnswer: 'B',
        subject: 'Mathematics',
        topic: 'Arithmetic',
        difficultyLevel: 'easy',
        questionType: 'REAL_PAST_QUESTION',
        questionPool: 'REAL_BANK',
        hasImage: false,
        imageUrl: null,
        optionAImageUrl: null,
        optionBImageUrl: null,
        optionCImageUrl: null,
        optionDImageUrl: null,
        optionEImageUrl: null,
        explanationText: 'Because 2 plus 2 equals 4.',
        explanationImageUrl: null,
        additionalNotes: 'Basic arithmetic',
        parentQuestionId: null
      }
    ], { institutionCode: 'UI' });

    expect(result.success).toBe(true);
    expect(mocks.questionCreate).toHaveBeenCalledTimes(1);
    expect(mocks.explanationCreate).toHaveBeenCalledTimes(1);
    expect(mocks.explanationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        questionId: 901,
        explanationText: 'Because 2 plus 2 equals 4.',
        additionalNotes: 'Basic arithmetic'
      }),
      select: {
        id: true
      }
    }));
    expect(mocks.cleanupQuestionAssets).not.toHaveBeenCalled();
  });
});
