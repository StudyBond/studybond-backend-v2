import { parse } from "csv-parse";
import * as XLSX from "xlsx";
import prisma from "../../config/database";
import { AUTH_CONFIG } from "../../config/constants";
import { AppError } from "../../shared/errors/AppError";
import { Readable } from "stream";
import {
  ensureFreeExamPoolCapacity,
  lockFreeExamSubjects,
} from "./question-pool";
import {
  normalizeQuestionSource,
  QUESTION_POOLS,
  QUESTION_TYPES,
} from "./questions.constants";
import {
  cleanupQuestionAssets,
  resolveManagedQuestionAsset,
} from "./question-assets";
import { institutionContextService } from "../../shared/institutions/context";
import { normalizeSubjectLabel } from "../../shared/utils/subjects";
import type { BulkQuestionUploadQuery } from "./questions.types";

export interface BulkUploadResult {
  success: boolean;
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors: Array<{
    row: number;
    field: string;
    message: string;
  }>;
  createdIds: number[];
}

export interface ParsedQuestion {
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  optionE?: string | null;
  correctAnswer: string;
  subject: string;
  topic?: string | null;
  difficultyLevel?: string | null;
  questionType: string;
  questionPool?: string | null;
  hasImage?: boolean;
  imageUrl?: string | null;
  optionAImageUrl?: string | null;
  optionBImageUrl?: string | null;
  optionCImageUrl?: string | null;
  optionDImageUrl?: string | null;
  optionEImageUrl?: string | null;
  explanationText?: string | null;
  explanationImageUrl?: string | null;
  additionalNotes?: string | null;
  parentQuestionId?: number | null;
  year?: number | null;
}

const BULK_UPLOAD_TX_OPTIONS = {
  maxWait: AUTH_CONFIG.TX_MAX_WAIT_MS,
  timeout: Math.max(AUTH_CONFIG.TX_TIMEOUT_MS, 60_000),
} as const;

interface PreparedQuestionInsert {
  institutionId: number;
  questionText: string;
  hasImage: boolean;
  imageUrl: string | null;
  imagePublicId: string | null;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  optionE: string | null;
  optionAImageUrl: string | null;
  optionAImagePublicId: string | null;
  optionBImageUrl: string | null;
  optionBImagePublicId: string | null;
  optionCImageUrl: string | null;
  optionCImagePublicId: string | null;
  optionDImageUrl: string | null;
  optionDImagePublicId: string | null;
  optionEImageUrl: string | null;
  optionEImagePublicId: string | null;
  correctAnswer: string;
  subject: string;
  topic: string | null;
  difficultyLevel: string | null;
  questionType: string;
  questionPool: string;
  isAiGenerated: boolean;
  parentQuestionId: number | null;
  year: number | null;
  explanation: {
    explanationText: string;
    explanationImageUrl: string | null;
    explanationImagePublicId: string | null;
    additionalNotes: string | null;
  } | null;
  uploadedPublicIds: string[];
}

export async function parseCSVStream(
  stream: Readable,
): Promise<ParsedQuestion[]> {
  return new Promise((resolve, reject) => {
    const results: any[] = [];
    const parser = stream.pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        cast: true,
      }),
    );

    parser.on("readable", () => {
      let record;
      while ((record = parser.read()) !== null) {
        results.push(record);
      }
    });

    parser.on("error", (err) => {
      reject(new AppError(`CSV Parsing Error: ${err.message}`, 400));
    });

    parser.on("end", () => {
      try {
        resolve(normalizeRows(results));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function parseExcel(buffer: Buffer): ParsedQuestion[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const records = XLSX.utils.sheet_to_json(sheet);
  return normalizeRows(records as any[]);
}

function normalizeRows(rows: any[]): ParsedQuestion[] {
  return rows.map((row) => {
    const normalized: any = {};

    for (const key of Object.keys(row)) {
      normalized[key.trim()] = row[key];
    }

    return {
      questionText: String(normalized.questionText || ""),
      optionA: String(normalized.optionA || ""),
      optionB: String(normalized.optionB || ""),
      optionC: String(normalized.optionC || ""),
      optionD: String(normalized.optionD || ""),
      optionE: normalized.optionE ? String(normalized.optionE) : null,
      correctAnswer: String(normalized.correctAnswer || "").toUpperCase(),
      subject: normalizeSubjectLabel(String(normalized.subject || "")),
      topic: normalized.topic ? String(normalized.topic) : null,
      difficultyLevel: normalized.difficultyLevel
        ? String(normalized.difficultyLevel)
        : null,
      questionType: String(normalized.questionType || "REAL_PAST_QUESTION"),
      questionPool: normalized.questionPool
        ? String(normalized.questionPool)
        : null,
      hasImage: Boolean(normalized.imageUrl),
      imageUrl: normalized.imageUrl ? String(normalized.imageUrl) : null,
      optionAImageUrl: normalized.optionAImageUrl
        ? String(normalized.optionAImageUrl)
        : null,
      optionBImageUrl: normalized.optionBImageUrl
        ? String(normalized.optionBImageUrl)
        : null,
      optionCImageUrl: normalized.optionCImageUrl
        ? String(normalized.optionCImageUrl)
        : null,
      optionDImageUrl: normalized.optionDImageUrl
        ? String(normalized.optionDImageUrl)
        : null,
      optionEImageUrl: normalized.optionEImageUrl
        ? String(normalized.optionEImageUrl)
        : null,
      explanationText: normalized.explanationText
        ? String(normalized.explanationText)
        : null,
      explanationImageUrl: normalized.explanationImageUrl
        ? String(normalized.explanationImageUrl)
        : null,
      additionalNotes: normalized.additionalNotes
        ? String(normalized.additionalNotes)
        : null,
      parentQuestionId: normalized.parentQuestionId
        ? Number(normalized.parentQuestionId)
        : null,
      year: normalized.year ? Number(normalized.year) : null,
    };
  });
}

function validateQuestion(
  question: ParsedQuestion,
  rowIndex: number,
): Array<{ row: number; field: string; message: string }> {
  const errors: Array<{ row: number; field: string; message: string }> = [];
  const row = rowIndex + 2;

  if (!question.questionText.trim()) {
    errors.push({
      row,
      field: "questionText",
      message: "Question text is required",
    });
  }
  if (!question.optionA.trim()) {
    errors.push({ row, field: "optionA", message: "Option A is required" });
  }
  if (!question.optionB.trim()) {
    errors.push({ row, field: "optionB", message: "Option B is required" });
  }
  if (!question.optionC.trim()) {
    errors.push({ row, field: "optionC", message: "Option C is required" });
  }
  if (!question.optionD.trim()) {
    errors.push({ row, field: "optionD", message: "Option D is required" });
  }
  if (!question.subject.trim()) {
    errors.push({ row, field: "subject", message: "Subject is required" });
  }
  if (!question.questionType.trim()) {
    errors.push({
      row,
      field: "questionType",
      message: "Question type is required",
    });
  }

  try {
    const normalizedSource = normalizeQuestionSource({
      questionType: question.questionType,
      questionPool: question.questionPool,
    });

    question.questionType = normalizedSource.questionType;
    question.questionPool = normalizedSource.questionPool;
  } catch (error: any) {
    const isTypeError = error?.message?.toLowerCase().includes("type");
    errors.push({
      row,
      field: isTypeError ? "questionType" : "questionPool",
      message: error?.message || "Invalid question pool or type",
    });
  }

  const validAnswers = question.optionE
    ? ["A", "B", "C", "D", "E"]
    : ["A", "B", "C", "D"];
  if (!validAnswers.includes(question.correctAnswer)) {
    errors.push({
      row,
      field: "correctAnswer",
      message: `Correct answer must be one of: ${validAnswers.join(", ")}`,
    });
  }

  const urlFields = [
    "imageUrl",
    "optionAImageUrl",
    "optionBImageUrl",
    "optionCImageUrl",
    "optionDImageUrl",
    "optionEImageUrl",
    "explanationImageUrl",
  ];

  for (const field of urlFields) {
    const value = (question as any)[field];
    if (value && !isValidUrl(value)) {
      errors.push({ row, field, message: "Invalid URL format" });
    }
  }

  if (question.year != null) {
    const yearNum = Number(question.year);
    if (
      !Number.isFinite(yearNum) ||
      yearNum < 1970 ||
      yearNum > 2100 ||
      !Number.isInteger(yearNum)
    ) {
      errors.push({
        row,
        field: "year",
        message: "Year must be an integer between 1970 and 2100",
      });
    }
  }

  return errors;
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

async function prepareQuestionInsert(
  question: ParsedQuestion,
  institutionId: number,
): Promise<PreparedQuestionInsert> {
  const uploadedPublicIds: string[] = [];

  const questionImage = await resolveManagedQuestionAsset(
    {
      url: question.imageUrl,
    },
    "question",
  );
  if (questionImage.uploadedAsset?.publicId)
    uploadedPublicIds.push(questionImage.uploadedAsset.publicId);

  const optionAImage = await resolveManagedQuestionAsset(
    { url: question.optionAImageUrl },
    "optionA",
  );
  if (optionAImage.uploadedAsset?.publicId)
    uploadedPublicIds.push(optionAImage.uploadedAsset.publicId);

  const optionBImage = await resolveManagedQuestionAsset(
    { url: question.optionBImageUrl },
    "optionB",
  );
  if (optionBImage.uploadedAsset?.publicId)
    uploadedPublicIds.push(optionBImage.uploadedAsset.publicId);

  const optionCImage = await resolveManagedQuestionAsset(
    { url: question.optionCImageUrl },
    "optionC",
  );
  if (optionCImage.uploadedAsset?.publicId)
    uploadedPublicIds.push(optionCImage.uploadedAsset.publicId);

  const optionDImage = await resolveManagedQuestionAsset(
    { url: question.optionDImageUrl },
    "optionD",
  );
  if (optionDImage.uploadedAsset?.publicId)
    uploadedPublicIds.push(optionDImage.uploadedAsset.publicId);

  const optionEImage = await resolveManagedQuestionAsset(
    { url: question.optionEImageUrl },
    "optionE",
  );
  if (optionEImage.uploadedAsset?.publicId)
    uploadedPublicIds.push(optionEImage.uploadedAsset.publicId);

  const explanationImage = await resolveManagedQuestionAsset(
    {
      url: question.explanationImageUrl,
    },
    "explanation",
  );
  if (explanationImage.uploadedAsset?.publicId)
    uploadedPublicIds.push(explanationImage.uploadedAsset.publicId);

  const hasExplanationContent = Boolean(
    question.explanationText?.trim() ||
    explanationImage.url ||
    question.additionalNotes?.trim(),
  );

  return {
    institutionId,
    questionText: question.questionText,
    hasImage: Boolean(questionImage.url),
    imageUrl: questionImage.url,
    imagePublicId: questionImage.publicId,
    optionA: question.optionA,
    optionB: question.optionB,
    optionC: question.optionC,
    optionD: question.optionD,
    optionE: question.optionE ?? null,
    optionAImageUrl: optionAImage.url,
    optionAImagePublicId: optionAImage.publicId,
    optionBImageUrl: optionBImage.url,
    optionBImagePublicId: optionBImage.publicId,
    optionCImageUrl: optionCImage.url,
    optionCImagePublicId: optionCImage.publicId,
    optionDImageUrl: optionDImage.url,
    optionDImagePublicId: optionDImage.publicId,
    optionEImageUrl: optionEImage.url,
    optionEImagePublicId: optionEImage.publicId,
    correctAnswer: question.correctAnswer,
    subject: normalizeSubjectLabel(question.subject),
    topic: question.topic ?? null,
    difficultyLevel: question.difficultyLevel ?? null,
    questionType: question.questionType,
    questionPool:
      question.questionPool ??
      (question.questionType === QUESTION_TYPES.REAL_PAST_QUESTION
        ? QUESTION_POOLS.REAL_BANK
        : QUESTION_POOLS.PRACTICE),
    isAiGenerated: question.questionType === QUESTION_TYPES.AI_GENERATED,
    parentQuestionId: question.parentQuestionId ?? null,
    year: question.year ?? null,
    explanation: hasExplanationContent
      ? {
          explanationText: question.explanationText || "",
          explanationImageUrl: explanationImage.url,
          explanationImagePublicId: explanationImage.publicId,
          additionalNotes: question.additionalNotes ?? null,
        }
      : null,
    uploadedPublicIds,
  };
}

export async function processBulkUpload(
  questions: ParsedQuestion[],
  query: BulkQuestionUploadQuery = {},
): Promise<BulkUploadResult> {
  const institution = await institutionContextService.resolveByCode(
    query.institutionCode,
  );
  const allErrors: Array<{ row: number; field: string; message: string }> = [];
  const validQuestions: ParsedQuestion[] = [];

  for (let index = 0; index < questions.length; index += 1) {
    const errors = validateQuestion(questions[index], index);
    if (errors.length > 0) {
      allErrors.push(...errors);
    } else {
      validQuestions.push(questions[index]);
    }
  }

  if (allErrors.length > 0) {
    return {
      success: false,
      totalRows: questions.length,
      successCount: 0,
      errorCount: allErrors.length,
      errors: allErrors,
      createdIds: [],
    };
  }

  const preparedQuestions: PreparedQuestionInsert[] = [];
  const uploadedPublicIds: string[] = [];
  for (const question of validQuestions) {
    const prepared = await prepareQuestionInsert(question, institution.id);
    preparedQuestions.push(prepared);
    uploadedPublicIds.push(...prepared.uploadedPublicIds);
  }

  const createdIds: number[] = [];

  try {
    await prisma.$transaction(async (tx: any) => {
      const incomingFreeCounts = preparedQuestions.reduce<
        Record<
          string,
          { institutionId: number; subject: string; count: number }
        >
      >((accumulator, question) => {
        if (question.questionPool === QUESTION_POOLS.FREE_EXAM) {
          const key = `${question.institutionId}:${question.subject.toLowerCase()}`;
          const current = accumulator[key];
          accumulator[key] = {
            institutionId: question.institutionId,
            subject: question.subject,
            count: (current?.count ?? 0) + 1,
          };
        }

        return accumulator;
      }, {});

      const freeSubjects = Object.values(incomingFreeCounts);
      if (freeSubjects.length > 0) {
        await lockFreeExamSubjects(
          tx,
          freeSubjects.map((entry) => ({
            institutionId: entry.institutionId,
            subject: entry.subject,
          })),
        );

        for (const entry of freeSubjects) {
          await ensureFreeExamPoolCapacity(
            tx,
            entry.institutionId,
            entry.subject,
            entry.count,
          );
        }
      }

      for (const question of preparedQuestions) {
        const created = await tx.question.create({
          data: {
            institutionId: question.institutionId,
            questionText: question.questionText,
            hasImage: question.hasImage,
            imageUrl: question.imageUrl,
            imagePublicId: question.imagePublicId,
            optionA: question.optionA,
            optionB: question.optionB,
            optionC: question.optionC,
            optionD: question.optionD,
            optionE: question.optionE,
            optionAImageUrl: question.optionAImageUrl,
            optionAImagePublicId: question.optionAImagePublicId,
            optionBImageUrl: question.optionBImageUrl,
            optionBImagePublicId: question.optionBImagePublicId,
            optionCImageUrl: question.optionCImageUrl,
            optionCImagePublicId: question.optionCImagePublicId,
            optionDImageUrl: question.optionDImageUrl,
            optionDImagePublicId: question.optionDImagePublicId,
            optionEImageUrl: question.optionEImageUrl,
            optionEImagePublicId: question.optionEImagePublicId,
            correctAnswer: question.correctAnswer,
            subject: question.subject,
            topic: question.topic,
            difficultyLevel: question.difficultyLevel,
            questionType: question.questionType,
            questionPool: question.questionPool as any,
            isAiGenerated: question.isAiGenerated,
            parentQuestionId: question.parentQuestionId,
            year: question.year,
          },
          select: {
            id: true,
          },
        });

        if (question.explanation) {
          await tx.explanation.create({
            data: {
              questionId: created.id,
              ...question.explanation,
            },
            select: {
              id: true,
            },
          });
        }

        createdIds.push(created.id);
      }
    }, BULK_UPLOAD_TX_OPTIONS);

    return {
      success: true,
      totalRows: questions.length,
      successCount: createdIds.length,
      errorCount: 0,
      errors: [],
      createdIds,
    };
  } catch (error: any) {
    await cleanupQuestionAssets(uploadedPublicIds);
    throw new AppError(`Bulk upload failed: ${error.message}`, 500);
  }
}
