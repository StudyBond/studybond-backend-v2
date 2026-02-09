// ============================================
// BULK UPLOAD SERVICE
// ============================================
// Handles CSV and Excel file parsing for bulk question uploads
// Validates each row and provides detailed error reporting

import { parse } from 'csv-parse';
import * as XLSX from 'xlsx';
import prisma from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { Readable } from 'stream';

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
    hasImage?: boolean;
    imageUrl?: string | null;
    optionAImageUrl?: string | null;
    optionBImageUrl?: string | null;
    optionCImageUrl?: string | null;
    optionDImageUrl?: string | null;
    optionEImageUrl?: string | null;
    explanationText?: string | null;
    parentQuestionId?: number | null;
}

/**
 * Parse CSV stream into structured question data
 * Uses stream API to avoid loading entire file into memory
 */
export async function parseCSVStream(stream: Readable): Promise<ParsedQuestion[]> {
    return new Promise((resolve, reject) => {
        const results: any[] = [];
        const parser = stream.pipe(parse({
            columns: true,
            skip_empty_lines: true,
            trim: true,
            cast: true
        }));

        parser.on('readable', () => {
            let record;
            while ((record = parser.read()) !== null) {
                results.push(record);
            }
        });

        parser.on('error', (err) => {
            reject(new AppError(`CSV Parsing Error: ${err.message}`, 400));
        });

        parser.on('end', () => {
            try {
                const normalized = normalizeRows(results);
                resolve(normalized);
            } catch (err) {
                reject(err);
            }
        });
    });
}


/**
 * Parse Excel file buffer into structured question data
 * Excel parsing is memory-intensive by nature with xlsx, 
 * but controlled by file size limits in app.ts
 */
export function parseExcel(buffer: Buffer): ParsedQuestion[] {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const records = XLSX.utils.sheet_to_json(sheet);
    return normalizeRows(records as any[]);
}

/**
 * Normalize column names (handle case differences, trim spaces)
 */
function normalizeRows(rows: any[]): ParsedQuestion[] {
    return rows.map(row => {
        const normalized: any = {};

        for (const key of Object.keys(row)) {
            const normalizedKey = key.trim();
            normalized[normalizedKey] = row[key];
        }

        return {
            questionText: String(normalized.questionText || ''),
            optionA: String(normalized.optionA || ''),
            optionB: String(normalized.optionB || ''),
            optionC: String(normalized.optionC || ''),
            optionD: String(normalized.optionD || ''),
            optionE: normalized.optionE ? String(normalized.optionE) : null,
            correctAnswer: String(normalized.correctAnswer || '').toUpperCase(),
            subject: String(normalized.subject || ''),
            topic: normalized.topic ? String(normalized.topic) : null,
            difficultyLevel: normalized.difficultyLevel ? String(normalized.difficultyLevel) : null,
            questionType: String(normalized.questionType || 'REAL_PAST_QUESTION'),
            hasImage: Boolean(normalized.imageUrl),
            imageUrl: normalized.imageUrl ? String(normalized.imageUrl) : null,
            optionAImageUrl: normalized.optionAImageUrl ? String(normalized.optionAImageUrl) : null,
            optionBImageUrl: normalized.optionBImageUrl ? String(normalized.optionBImageUrl) : null,
            optionCImageUrl: normalized.optionCImageUrl ? String(normalized.optionCImageUrl) : null,
            optionDImageUrl: normalized.optionDImageUrl ? String(normalized.optionDImageUrl) : null,
            optionEImageUrl: normalized.optionEImageUrl ? String(normalized.optionEImageUrl) : null,
            explanationText: normalized.explanationText ? String(normalized.explanationText) : null,
            parentQuestionId: normalized.parentQuestionId ? Number(normalized.parentQuestionId) : null
        };
    });
}

/**
 * Validate a single question row
 */
function validateQuestion(question: ParsedQuestion, rowIndex: number): Array<{ row: number; field: string; message: string }> {
    const errors: Array<{ row: number; field: string; message: string }> = [];
    const row = rowIndex + 2; // +2 because row 1 is header, and we're 0-indexed

    // Required field checks
    if (!question.questionText.trim()) {
        errors.push({ row, field: 'questionText', message: 'Question text is required' });
    }
    if (!question.optionA.trim()) {
        errors.push({ row, field: 'optionA', message: 'Option A is required' });
    }
    if (!question.optionB.trim()) {
        errors.push({ row, field: 'optionB', message: 'Option B is required' });
    }
    if (!question.optionC.trim()) {
        errors.push({ row, field: 'optionC', message: 'Option C is required' });
    }
    if (!question.optionD.trim()) {
        errors.push({ row, field: 'optionD', message: 'Option D is required' });
    }
    if (!question.subject.trim()) {
        errors.push({ row, field: 'subject', message: 'Subject is required' });
    }
    if (!question.questionType.trim()) {
        errors.push({ row, field: 'questionType', message: 'Question type is required' });
    }

    // Correct answer validation
    const validAnswers = question.optionE ? ['A', 'B', 'C', 'D', 'E'] : ['A', 'B', 'C', 'D'];
    if (!validAnswers.includes(question.correctAnswer)) {
        errors.push({
            row,
            field: 'correctAnswer',
            message: `Correct answer must be one of: ${validAnswers.join(', ')}`
        });
    }

    // URL validation (basic check)
    const urlFields = ['imageUrl', 'optionAImageUrl', 'optionBImageUrl', 'optionCImageUrl', 'optionDImageUrl', 'optionEImageUrl'];
    for (const field of urlFields) {
        const value = (question as any)[field];
        if (value && !isValidUrl(value)) {
            errors.push({ row, field, message: `Invalid URL format` });
        }
    }

    return errors;
}

function isValidUrl(str: string): boolean {
    try {
        new URL(str);
        return true;
    } catch {
        return false;
    }
}

/**
 * Process bulk upload - validates all rows first, then inserts
 */
export async function processBulkUpload(questions: ParsedQuestion[]): Promise<BulkUploadResult> {
    const allErrors: Array<{ row: number; field: string; message: string }> = [];
    const validQuestions: ParsedQuestion[] = [];

    // Phase 1: Validate all questions
    for (let i = 0; i < questions.length; i++) {
        const errors = validateQuestion(questions[i], i);
        if (errors.length > 0) {
            allErrors.push(...errors);
        } else {
            validQuestions.push(questions[i]);
        }
    }

    // If any validation errors, return early with details
    if (allErrors.length > 0) {
        return {
            success: false,
            totalRows: questions.length,
            successCount: 0,
            errorCount: allErrors.length,
            errors: allErrors,
            createdIds: []
        };
    }

    // Phase 2: Insert all valid questions in a transaction
    const createdIds: number[] = [];

    try {
        // Use a much larger transaction, but be careful of limits. 
        // For very large files, we might batch this.
        await prisma.$transaction(async (tx) => {
            for (const q of validQuestions) {
                const created = await tx.question.create({
                    data: {
                        questionText: q.questionText,
                        hasImage: q.hasImage ?? false,
                        imageUrl: q.imageUrl,
                        optionA: q.optionA,
                        optionB: q.optionB,
                        optionC: q.optionC,
                        optionD: q.optionD,
                        optionE: q.optionE,
                        optionAImageUrl: q.optionAImageUrl,
                        optionBImageUrl: q.optionBImageUrl,
                        optionCImageUrl: q.optionCImageUrl,
                        optionDImageUrl: q.optionDImageUrl,
                        optionEImageUrl: q.optionEImageUrl,
                        correctAnswer: q.correctAnswer,
                        subject: q.subject,
                        topic: q.topic,
                        difficultyLevel: q.difficultyLevel,
                        questionType: q.questionType,
                        parentQuestionId: q.parentQuestionId,
                        // Create explanation if provided
                        explanation: q.explanationText ? {
                            create: {
                                explanationText: q.explanationText,
                                explanationImageUrl: null,
                                additionalNotes: null
                            }
                        } : undefined
                    }
                });
                createdIds.push(created.id);
            }
        });

        return {
            success: true,
            totalRows: questions.length,
            successCount: createdIds.length,
            errorCount: 0,
            errors: [],
            createdIds
        };
    } catch (error: any) {
        throw new AppError(`Bulk upload failed: ${error.message}`, 500);
    }
}
