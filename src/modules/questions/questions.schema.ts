import { z } from "zod";
import { QUESTION_ASSET_KINDS } from "./question-assets";
import { optionalInstitutionCodeSchema } from "../../shared/institutions/schema";

const publicIdSchema = z.string().min(1).max(512).nullable().optional();

function isFilledString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateImagePair(
  payload: Record<string, unknown>,
  ctx: z.RefinementCtx,
  urlField: string,
  publicIdField: string,
) {
  const urlValue = payload[urlField];
  const publicIdValue = payload[publicIdField];

  if (
    publicIdField in payload &&
    typeof urlValue !== "string" &&
    urlValue !== null
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [publicIdField],
      message: `${publicIdField} must be sent together with ${urlField}.`,
    });
    return;
  }

  if (
    publicIdValue !== undefined &&
    publicIdValue !== null &&
    typeof urlValue !== "string"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [publicIdField],
      message: `${publicIdField} requires ${urlField} to be provided as a URL string.`,
    });
  }
}

function withImagePairValidation<T extends z.ZodObject<any>>(schema: T): T {
  return schema.superRefine((payload, ctx) => {
    validateImagePair(payload, ctx, "imageUrl", "imagePublicId");
    validateImagePair(payload, ctx, "optionAImageUrl", "optionAImagePublicId");
    validateImagePair(payload, ctx, "optionBImageUrl", "optionBImagePublicId");
    validateImagePair(payload, ctx, "optionCImageUrl", "optionCImagePublicId");
    validateImagePair(payload, ctx, "optionDImageUrl", "optionDImagePublicId");
    validateImagePair(payload, ctx, "optionEImageUrl", "optionEImagePublicId");
    validateImagePair(
      payload,
      ctx,
      "explanationImageUrl",
      "explanationImagePublicId",
    );
  }) as T;
}

function validateQuestionOptions(
  payload: Record<string, unknown>,
  ctx: z.RefinementCtx,
) {
  const optionFields = ["optionA", "optionB", "optionC", "optionD"] as const;
  const hasVisibleOption = optionFields.some((field) =>
    isFilledString(payload[field]),
  );
  const hasCorrectAnswer = isFilledString(payload.correctAnswer);
  const isChildQuestion = payload.parentQuestionId != null;

  if (!isChildQuestion && !hasVisibleOption && !hasCorrectAnswer) {
    return;
  }

  if (!hasVisibleOption && !isChildQuestion && hasCorrectAnswer) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["correctAnswer"],
      message:
        "Correct answer should be omitted when no answer options are provided.",
    });
    return;
  }

  for (const field of optionFields) {
    if (!isFilledString(payload[field])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `${field} is required when this question has answer choices or is a child question.`,
      });
    }
  }

  if (!hasCorrectAnswer) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["correctAnswer"],
      message:
        "Correct answer is required when this question has answer choices or is a child question.",
    });
  }
}

export const createQuestionSchema = withImagePairValidation(
  z
    .object({
      institutionCode: optionalInstitutionCodeSchema,
      questionText: z.string().min(1, "Question text is required"),
      hasImage: z.boolean().optional().default(false),
      imageUrl: z.string().url().nullable().optional(),
      imagePublicId: publicIdSchema,

      optionA: z.string().optional(),
      optionB: z.string().optional(),
      optionC: z.string().optional(),
      optionD: z.string().optional(),
      optionE: z.string().nullable().optional(),

      optionAImageUrl: z.string().url().nullable().optional(),
      optionAImagePublicId: publicIdSchema,
      optionBImageUrl: z.string().url().nullable().optional(),
      optionBImagePublicId: publicIdSchema,
      optionCImageUrl: z.string().url().nullable().optional(),
      optionCImagePublicId: publicIdSchema,
      optionDImageUrl: z.string().url().nullable().optional(),
      optionDImagePublicId: publicIdSchema,
      optionEImageUrl: z.string().url().nullable().optional(),
      optionEImagePublicId: publicIdSchema,

      correctAnswer: z
        .enum(["A", "B", "C", "D", "E"], {
          message: "Correct answer must be A, B, C, D, or E",
        })
        .optional(),

      subject: z.string().min(1, "Subject is required"),
      topic: z.string().nullable().optional(),
      difficultyLevel: z.string().nullable().optional(),
      questionType: z
        .string()
        .min(1, "Question type is required")
        .default("REAL_PAST_QUESTION"),
      questionPool: z
        .string()
        .min(1, "Question pool is required")
        .default("REAL_BANK"),
      year: z.number().int().min(1970).max(2100).nullable().optional(),

      parentQuestionId: z.number().int().positive().nullable().optional(),

      explanationText: z.string().nullable().optional(),
      explanationImageUrl: z.string().url().nullable().optional(),
      explanationImagePublicId: publicIdSchema,
      additionalNotes: z.string().nullable().optional(),
    })
    .superRefine(validateQuestionOptions),
);

export const updateQuestionSchema = withImagePairValidation(
  z
    .object({
      institutionCode: optionalInstitutionCodeSchema,
      questionText: z.string().min(1, "Question text is required").optional(),
      hasImage: z.boolean().optional(),
      imageUrl: z.string().url().nullable().optional(),
      imagePublicId: publicIdSchema,

      optionA: z.string().optional(),
      optionB: z.string().optional(),
      optionC: z.string().optional(),
      optionD: z.string().optional(),
      optionE: z.string().nullable().optional(),

      optionAImageUrl: z.string().url().nullable().optional(),
      optionAImagePublicId: publicIdSchema,
      optionBImageUrl: z.string().url().nullable().optional(),
      optionBImagePublicId: publicIdSchema,
      optionCImageUrl: z.string().url().nullable().optional(),
      optionCImagePublicId: publicIdSchema,
      optionDImageUrl: z.string().url().nullable().optional(),
      optionDImagePublicId: publicIdSchema,
      optionEImageUrl: z.string().url().nullable().optional(),
      optionEImagePublicId: publicIdSchema,

      correctAnswer: z
        .enum(["A", "B", "C", "D", "E"], {
          message: "Correct answer must be A, B, C, D, or E",
        })
        .optional(),

      subject: z.string().min(1, "Subject is required").optional(),
      topic: z.string().nullable().optional(),
      difficultyLevel: z.string().nullable().optional(),
      questionType: z.string().min(1, "Question type is required").optional(),
      questionPool: z.string().min(1, "Question pool is required").optional(),
      year: z.number().int().min(1970).max(2100).nullable().optional(),

      parentQuestionId: z.number().int().positive().nullable().optional(),

      explanationText: z.string().nullable().optional(),
      explanationImageUrl: z.string().url().nullable().optional(),
      explanationImagePublicId: publicIdSchema,
      additionalNotes: z.string().nullable().optional(),
    })
    .superRefine(validateQuestionOptions)
    .refine((payload) => Object.keys(payload).length > 0, {
      message: "Provide at least one field to update.",
    }),
);

export const questionFilterSchema = z.object({
  institutionCode: optionalInstitutionCodeSchema,
  subject: z.string().optional(),
  topic: z.string().optional(),
  questionType: z.string().optional(),
  questionPool: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  hasImage: z.coerce.boolean().optional(),
  isAiGenerated: z.coerce.boolean().optional(),
  year: z.coerce.number().int().min(1970).max(2100).optional(),
});

export const questionIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const bulkUploadQuerySchema = z
  .object({
    institutionCode: optionalInstitutionCodeSchema,
    fileHash: z.string().min(1).max(128).optional(),
  })
  .strict();

export const bulkUploadHistoryQuerySchema = z
  .object({
    institutionCode: optionalInstitutionCodeSchema,
    limit: z.coerce.number().int().positive().max(50).default(20),
  })
  .strict();

export const bulkUploadDuplicateCheckQuerySchema = z
  .object({
    fileHash: z.string().min(1, "fileHash is required").max(128),
  })
  .strict();

export const questionAssetKindParamSchema = z.object({
  kind: z.enum(QUESTION_ASSET_KINDS),
});
