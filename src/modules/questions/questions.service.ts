import prisma from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import {
  cleanupQuestionAssets,
  type QuestionAssetKind,
  resolveManagedQuestionAsset,
  uploadQuestionAssetFile
} from './question-assets';
import {
  CreateQuestionInput,
  QuestionAssetUploadResponse,
  QuestionFilterQuery,
  QuestionResponse,
  UpdateQuestionInput
} from './questions.types';
import { lockFreeExamSubjects, ensureFreeExamPoolCapacity } from './question-pool';
import { normalizeQuestionPool, normalizeQuestionSource, normalizeQuestionType, QUESTION_POOLS, QUESTION_TYPES } from './questions.constants';
import { institutionContextService } from '../../shared/institutions/context';
import { getSubjectSearchVariants, normalizeSubjectLabel } from '../../shared/utils/subjects';

const QUESTION_INCLUDE = {
  parentQuestion: {
    select: {
      id: true,
      questionText: true,
      imageUrl: true
    }
  },
  institution: {
    select: {
      id: true,
      code: true
    }
  },
  explanation: true
} as const;

const QUESTION_UPDATE_FIELDS = [
  'questionText',
  'optionA',
  'optionB',
  'optionC',
  'optionD',
  'optionE',
  'correctAnswer',
  'subject',
  'topic',
  'difficultyLevel',
  'parentQuestionId',
  'year'
] as const;

const QUESTION_ASSET_FIELD_CONFIGS = [
  { kind: 'question', urlField: 'imageUrl', publicIdField: 'imagePublicId' },
  { kind: 'optionA', urlField: 'optionAImageUrl', publicIdField: 'optionAImagePublicId' },
  { kind: 'optionB', urlField: 'optionBImageUrl', publicIdField: 'optionBImagePublicId' },
  { kind: 'optionC', urlField: 'optionCImageUrl', publicIdField: 'optionCImagePublicId' },
  { kind: 'optionD', urlField: 'optionDImageUrl', publicIdField: 'optionDImagePublicId' },
  { kind: 'optionE', urlField: 'optionEImageUrl', publicIdField: 'optionEImagePublicId' }
] as const;

function hasOwn<T extends object>(payload: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function gatherQuestionPublicIds(question: any): string[] {
  return [
    question.imagePublicId,
    question.optionAImagePublicId,
    question.optionBImagePublicId,
    question.optionCImagePublicId,
    question.optionDImagePublicId,
    question.optionEImagePublicId,
    question.explanation?.explanationImagePublicId
  ].filter(Boolean);
}

export class QuestionsService {

  async createQuestion(input: CreateQuestionInput): Promise<QuestionResponse> {
    const institution = await institutionContextService.resolveByCode(input.institutionCode);
    const normalizedSubject = normalizeSubjectLabel(input.subject);

    if (input.parentQuestionId) {
      const parent = await prisma.question.findFirst({
        where: {
          id: input.parentQuestionId,
          institutionId: institution.id
        }
      });

      if (!parent) {
        throw new NotFoundError(`Parent question ${input.parentQuestionId} was not found in institution ${institution.code}`);
      }
    }

    const normalizedSource = normalizeQuestionSource({
      questionType: input.questionType,
      questionPool: input.questionPool
    });

    const mediaPlan = await this.prepareCreateMediaPlan(input);

    try {
      const question = await prisma.$transaction(async (tx: any) => {
        if (normalizedSource.questionPool === QUESTION_POOLS.FREE_EXAM) {
          await lockFreeExamSubjects(tx, [{ institutionId: institution.id, subject: normalizedSubject }]);
          await ensureFreeExamPoolCapacity(tx, institution.id, normalizedSubject, 1);
        }

        return tx.question.create({
          data: {
            institutionId: institution.id,
            questionText: input.questionText,
            hasImage: Boolean(mediaPlan.questionData.imageUrl),
            imageUrl: mediaPlan.questionData.imageUrl,
            imagePublicId: mediaPlan.questionData.imagePublicId,

            optionA: input.optionA,
            optionB: input.optionB,
            optionC: input.optionC,
            optionD: input.optionD,
            optionE: input.optionE,

            optionAImageUrl: mediaPlan.questionData.optionAImageUrl,
            optionAImagePublicId: mediaPlan.questionData.optionAImagePublicId,
            optionBImageUrl: mediaPlan.questionData.optionBImageUrl,
            optionBImagePublicId: mediaPlan.questionData.optionBImagePublicId,
            optionCImageUrl: mediaPlan.questionData.optionCImageUrl,
            optionCImagePublicId: mediaPlan.questionData.optionCImagePublicId,
            optionDImageUrl: mediaPlan.questionData.optionDImageUrl,
            optionDImagePublicId: mediaPlan.questionData.optionDImagePublicId,
            optionEImageUrl: mediaPlan.questionData.optionEImageUrl,
            optionEImagePublicId: mediaPlan.questionData.optionEImagePublicId,

            correctAnswer: input.correctAnswer,

            subject: normalizedSubject,
            topic: input.topic,
            difficultyLevel: input.difficultyLevel,
            questionType: normalizedSource.questionType,
            questionPool: normalizedSource.questionPool,
            isAiGenerated: normalizedSource.questionType === QUESTION_TYPES.AI_GENERATED,

            parentQuestionId: input.parentQuestionId,
            year: input.year ?? null,
            explanation: mediaPlan.explanationData ? {
              create: mediaPlan.explanationData
            } : undefined
          },
          include: QUESTION_INCLUDE
        });
      });

      return this.mapToResponse(question);
    } catch (error) {
      await cleanupQuestionAssets(mediaPlan.uploadedPublicIds);
      throw error;
    }
  }

  async getQuestions(query: QuestionFilterQuery) {
    const institution = await institutionContextService.resolveByCode(query.institutionCode);
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      institutionId: institution.id
    };

    if (query.subject) {
      where.subject = {
        in: getSubjectSearchVariants(query.subject)
      };
    }
    if (query.topic) where.topic = { contains: query.topic };
    if (query.questionType) where.questionType = normalizeQuestionType(query.questionType);
    if (query.questionPool) where.questionPool = normalizeQuestionPool(query.questionPool);
    if (query.hasImage !== undefined) where.hasImage = query.hasImage;
    if (query.isAiGenerated !== undefined) where.isAiGenerated = query.isAiGenerated;
    if (query.year !== undefined) where.year = query.year;
    if (query.search) {
      where.questionText = {
        contains: query.search
      };
    }

    const [questions, total] = await Promise.all([
      prisma.question.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'desc' },
        include: QUESTION_INCLUDE
      }),
      prisma.question.count({ where })
    ]);

    return {
      questions: questions.map((question: any) => this.mapToResponse(question)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getQuestionById(id: number): Promise<QuestionResponse> {
    const question = await prisma.question.findUnique({
      where: { id },
      include: QUESTION_INCLUDE
    });

    if (!question) {
      throw new NotFoundError('Question not found');
    }

    return this.mapToResponse(question);
  }

  async updateQuestion(id: number, input: UpdateQuestionInput): Promise<QuestionResponse> {
    const existing = await prisma.question.findUnique({
      where: { id },
      include: {
        institution: {
          select: {
            id: true,
            code: true
          }
        },
        explanation: true
      }
    });

    if (!existing) {
      throw new NotFoundError('Question not found');
    }

    const targetInstitution = input.institutionCode
      ? await institutionContextService.resolveByCode(input.institutionCode)
      : existing.institution
        ? await institutionContextService.resolveByCode(existing.institution.code)
        : await institutionContextService.resolveByCode();

    if (input.parentQuestionId && input.parentQuestionId !== existing.parentQuestionId) {
      const parent = await prisma.question.findFirst({
        where: {
          id: input.parentQuestionId,
          institutionId: targetInstitution.id
        }
      });

      if (!parent) {
        throw new NotFoundError(`Parent question ${input.parentQuestionId} was not found in institution ${targetInstitution.code}`);
      }
    }

    const normalizedSource = normalizeQuestionSource({
      questionType: input.questionType ?? existing.questionType,
      questionPool: input.questionPool ?? (existing as any).questionPool
    });
    const normalizedInputSubject = hasOwn(input, 'subject')
      ? normalizeSubjectLabel(input.subject as string)
      : undefined;
    const existingSubject = normalizeSubjectLabel(existing.subject);

    const mediaPlan = await this.prepareUpdateMediaPlan(existing, input);

    const lockScopes = new Map<string, { institutionId: number; subject: string }>();
    if ((existing as any).questionPool === QUESTION_POOLS.FREE_EXAM) {
      lockScopes.set(
        `${existing.institutionId}:${existingSubject.toLowerCase()}`,
        { institutionId: existing.institutionId, subject: existingSubject }
      );
    }
    if (normalizedSource.questionPool === QUESTION_POOLS.FREE_EXAM) {
      const targetSubject = normalizedInputSubject ?? existingSubject;
      lockScopes.set(
        `${targetInstitution.id}:${targetSubject.toLowerCase()}`,
        { institutionId: targetInstitution.id, subject: targetSubject }
      );
    }

    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        if (lockScopes.size > 0) {
          await lockFreeExamSubjects(tx, [...lockScopes.values()]);
        }

        if (normalizedSource.questionPool === QUESTION_POOLS.FREE_EXAM) {
          await ensureFreeExamPoolCapacity(
            tx,
            targetInstitution.id,
            normalizedInputSubject ?? existingSubject,
            1,
            id
          );
        }

        return tx.question.update({
          where: { id },
          data: {
            ...this.buildScalarQuestionUpdateData(input),
            institutionId: targetInstitution.id,
            ...mediaPlan.questionData,
            hasImage: Boolean(
              mediaPlan.questionData.imageUrl ?? existing.imageUrl
            ),
            questionType: normalizedSource.questionType,
            questionPool: normalizedSource.questionPool,
            isAiGenerated: normalizedSource.questionType === QUESTION_TYPES.AI_GENERATED,
            ...(mediaPlan.explanationMutation ? { explanation: mediaPlan.explanationMutation } : {})
          },
          include: QUESTION_INCLUDE
        });
      });

      await cleanupQuestionAssets(mediaPlan.stalePublicIds);
      return this.mapToResponse(updated);
    } catch (error) {
      await cleanupQuestionAssets(mediaPlan.uploadedPublicIds);
      throw error;
    }
  }

  async deleteQuestion(id: number): Promise<void> {
    const existing = await prisma.question.findUnique({
      where: { id },
      include: {
        childQuestions: true,
        explanation: true
      }
    });

    if (!existing) {
      throw new NotFoundError('Question not found');
    }

    if (existing.childQuestions.length > 0) {
      throw new AppError('Cannot delete parent question that has linked child questions', 400);
    }

    const publicIdsToCleanup = gatherQuestionPublicIds(existing);
    await prisma.question.delete({ where: { id } });
    await cleanupQuestionAssets(publicIdsToCleanup);
  }

  async uploadQuestionAsset(input: {
    kind: QuestionAssetKind;
    buffer: Buffer;
    filename: string;
    contentType?: string;
  }): Promise<QuestionAssetUploadResponse> {
    const uploaded = await uploadQuestionAssetFile(input);
    return {
      kind: input.kind,
      provider: uploaded.provider,
      url: uploaded.url,
      publicId: uploaded.publicId,
      bytes: uploaded.bytes,
      width: uploaded.width,
      height: uploaded.height,
      format: uploaded.format,
      originalFilename: uploaded.originalFilename
    };
  }

  private async prepareCreateMediaPlan(input: CreateQuestionInput): Promise<{
    questionData: Record<string, string | null>;
    explanationData: {
      explanationText: string;
      explanationImageUrl: string | null;
      explanationImagePublicId: string | null;
      additionalNotes: string | null;
    } | null;
    uploadedPublicIds: string[];
  }> {
    const uploadedPublicIds: string[] = [];
    const questionData: Record<string, string | null> = {};

    for (const config of QUESTION_ASSET_FIELD_CONFIGS) {
      const resolved = await resolveManagedQuestionAsset({
        url: input[config.urlField as keyof CreateQuestionInput] as string | null | undefined,
        publicId: input[config.publicIdField as keyof CreateQuestionInput] as string | null | undefined
      }, config.kind);

      questionData[config.urlField] = resolved.url;
      questionData[config.publicIdField] = resolved.publicId;

      if (resolved.uploadedAsset?.publicId) {
        uploadedPublicIds.push(resolved.uploadedAsset.publicId);
      }
    }

    const resolvedExplanationAsset = await resolveManagedQuestionAsset({
      url: input.explanationImageUrl,
      publicId: input.explanationImagePublicId
    }, 'explanation');

    if (resolvedExplanationAsset.uploadedAsset?.publicId) {
      uploadedPublicIds.push(resolvedExplanationAsset.uploadedAsset.publicId);
    }

    const hasExplanationContent = Boolean(
      input.explanationText?.trim()
      || resolvedExplanationAsset.url
      || input.additionalNotes?.trim()
    );

    return {
      questionData,
      explanationData: hasExplanationContent ? {
        explanationText: input.explanationText || '',
        explanationImageUrl: resolvedExplanationAsset.url,
        explanationImagePublicId: resolvedExplanationAsset.publicId,
        additionalNotes: input.additionalNotes ?? null
      } : null,
      uploadedPublicIds
    };
  }

  private async prepareUpdateMediaPlan(existing: any, input: UpdateQuestionInput): Promise<{
    questionData: Record<string, string | null>;
    explanationMutation: Record<string, unknown> | null;
    uploadedPublicIds: string[];
    stalePublicIds: string[];
  }> {
    const uploadedPublicIds: string[] = [];
    const stalePublicIds: string[] = [];
    const questionData: Record<string, string | null> = {};

    for (const config of QUESTION_ASSET_FIELD_CONFIGS) {
      if (!hasOwn(input, config.urlField)) {
        continue;
      }

      const resolved = await resolveManagedQuestionAsset({
        url: input[config.urlField as keyof UpdateQuestionInput] as string | null | undefined,
        publicId: hasOwn(input, config.publicIdField)
          ? input[config.publicIdField as keyof UpdateQuestionInput] as string | null | undefined
          : null
      }, config.kind);

      questionData[config.urlField] = resolved.url;
      questionData[config.publicIdField] = resolved.publicId;

      if (resolved.uploadedAsset?.publicId) {
        uploadedPublicIds.push(resolved.uploadedAsset.publicId);
      }

      const previousPublicId = existing[config.publicIdField];
      if (previousPublicId && previousPublicId !== resolved.publicId) {
        stalePublicIds.push(previousPublicId);
      }
    }

    const explanationMutation = await this.buildExplanationMutation(existing, input, uploadedPublicIds, stalePublicIds);

    return {
      questionData,
      explanationMutation,
      uploadedPublicIds,
      stalePublicIds
    };
  }

  private async buildExplanationMutation(
    existing: any,
    input: UpdateQuestionInput,
    uploadedPublicIds: string[],
    stalePublicIds: string[]
  ): Promise<Record<string, unknown> | null> {
    const hasExplanationChange = hasOwn(input, 'explanationText')
      || hasOwn(input, 'explanationImageUrl')
      || hasOwn(input, 'explanationImagePublicId')
      || hasOwn(input, 'additionalNotes');

    if (!hasExplanationChange) {
      return null;
    }

    const currentExplanation = existing.explanation;
    let resolvedExplanationImageUrl = currentExplanation?.explanationImageUrl ?? null;
    let resolvedExplanationImagePublicId = currentExplanation?.explanationImagePublicId ?? null;

    if (hasOwn(input, 'explanationImageUrl')) {
      const resolvedExplanationAsset = await resolveManagedQuestionAsset({
        url: input.explanationImageUrl,
        publicId: hasOwn(input, 'explanationImagePublicId') ? input.explanationImagePublicId : null
      }, 'explanation');

      resolvedExplanationImageUrl = resolvedExplanationAsset.url;
      resolvedExplanationImagePublicId = resolvedExplanationAsset.publicId;

      if (resolvedExplanationAsset.uploadedAsset?.publicId) {
        uploadedPublicIds.push(resolvedExplanationAsset.uploadedAsset.publicId);
      }

      if (
        currentExplanation?.explanationImagePublicId
        && currentExplanation.explanationImagePublicId !== resolvedExplanationImagePublicId
      ) {
        stalePublicIds.push(currentExplanation.explanationImagePublicId);
      }
    }

    const explanationText = hasOwn(input, 'explanationText')
      ? input.explanationText ?? ''
      : currentExplanation?.explanationText ?? '';
    const additionalNotes = hasOwn(input, 'additionalNotes')
      ? input.additionalNotes ?? null
      : currentExplanation?.additionalNotes ?? null;

    const hasExplanationContent = Boolean(
      explanationText.trim()
      || resolvedExplanationImageUrl
      || additionalNotes?.trim()
    );

    if (!hasExplanationContent) {
      return currentExplanation ? { delete: true } : null;
    }

    const payload = {
      explanationText,
      explanationImageUrl: resolvedExplanationImageUrl,
      explanationImagePublicId: resolvedExplanationImagePublicId,
      additionalNotes
    };

    if (currentExplanation) {
      return {
        update: payload
      };
    }

    return {
      create: payload
    };
  }

  private buildScalarQuestionUpdateData(input: UpdateQuestionInput): Record<string, unknown> {
    const data: Record<string, unknown> = {};

    for (const field of QUESTION_UPDATE_FIELDS) {
      if (hasOwn(input, field)) {
        data[field] = field === 'subject'
          ? normalizeSubjectLabel(input[field] as string)
          : input[field];
      }
    }

    return data;
  }

  private mapToResponse(q: any): QuestionResponse {
    return {
      id: q.id,
      institutionId: q.institutionId ?? null,
      institutionCode: q.institution?.code ?? null,
      questionText: q.questionText,
      hasImage: q.hasImage,
      imageUrl: q.imageUrl,
      imagePublicId: q.imagePublicId,

      optionA: q.optionA,
      optionB: q.optionB,
      optionC: q.optionC,
      optionD: q.optionD,
      optionE: q.optionE,

      optionAImageUrl: q.optionAImageUrl,
      optionAImagePublicId: q.optionAImagePublicId,
      optionBImageUrl: q.optionBImageUrl,
      optionBImagePublicId: q.optionBImagePublicId,
      optionCImageUrl: q.optionCImageUrl,
      optionCImagePublicId: q.optionCImagePublicId,
      optionDImageUrl: q.optionDImageUrl,
      optionDImagePublicId: q.optionDImagePublicId,
      optionEImageUrl: q.optionEImageUrl,
      optionEImagePublicId: q.optionEImagePublicId,

      correctAnswer: q.correctAnswer,

      subject: normalizeSubjectLabel(q.subject),
      topic: q.topic,
      difficultyLevel: q.difficultyLevel,
      questionType: q.questionType,
      questionPool: q.questionPool,
      isAiGenerated: q.isAiGenerated,
      isFeaturedFree: q.isFeaturedFree ?? false,
      year: q.year ?? null,

      parentQuestionId: q.parentQuestionId,
      parentQuestion: q.parentQuestion,

      explanation: q.explanation ? {
        explanationText: q.explanation.explanationText,
        explanationImageUrl: q.explanation.explanationImageUrl,
        explanationImagePublicId: q.explanation.explanationImagePublicId,
        additionalNotes: q.explanation.additionalNotes
      } : null,

      createdAt: q.createdAt?.toISOString() ?? new Date().toISOString(),
      updatedAt: q.updatedAt?.toISOString() ?? new Date().toISOString()
    };
  }
}
