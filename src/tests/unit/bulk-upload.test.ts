// Tests for CSV/Excel parsing and validation logic

import { describe, it, expect } from 'vitest';
import { parseCSVStream } from '../../modules/questions/bulk-upload';
import { Readable } from 'stream';

describe('Bulk Upload - CSV Parsing', () => {
    it('should parse valid CSV content', async () => {
        const csvContent = `questionText,optionA,optionB,optionC,optionD,correctAnswer,subject,questionType
"What is 2+2?","3","4","5","6","B","Mathematics","REAL_PAST_QUESTION"`;

        const stream = Readable.from([csvContent]);
        const result = await parseCSVStream(stream);

        expect(result).toHaveLength(1);
        expect(result[0].questionText).toBe('What is 2+2?');
        expect(result[0].correctAnswer).toBe('B');
        expect(result[0].subject).toBe('Mathematics');
    });

    it('should handle missing optional fields', async () => {
        const csvContent = `questionText,optionA,optionB,optionC,optionD,correctAnswer,subject,questionType
"Simple question","A","B","C","D","A","Physics","PRACTICE"`;

        const stream = Readable.from([csvContent]);
        const result = await parseCSVStream(stream);

        expect(result[0].optionE).toBeNull();
        expect(result[0].topic).toBeNull();
        expect(result[0].imageUrl).toBeNull();
    });

    it('should normalize correct answer to uppercase', async () => {
        const csvContent = `questionText,optionA,optionB,optionC,optionD,correctAnswer,subject,questionType
"Test","A","B","C","D","c","English","PRACTICE"`;

        const stream = Readable.from([csvContent]);
        const result = await parseCSVStream(stream);

        expect(result[0].correctAnswer).toBe('C');
    });

    it('should parse multiple rows', async () => {
        const csvContent = `questionText,optionA,optionB,optionC,optionD,correctAnswer,subject,questionType
"Q1","A1","B1","C1","D1","A","Math","REAL_PAST_QUESTION"
"Q2","A2","B2","C2","D2","B","Physics","PRACTICE"
"Q3","A3","B3","C3","D3","C","Chemistry","MOCK"`;

        const stream = Readable.from([csvContent]);
        const result = await parseCSVStream(stream);

        expect(result).toHaveLength(3);
        expect(result[0].questionText).toBe('Q1');
        expect(result[1].questionText).toBe('Q2');
        expect(result[2].questionText).toBe('Q3');
    });
});

describe('Bulk Upload - Validation', () => {
    it('should parse empty question text (validation happens later)', async () => {
        const csvContent = `questionText,optionA,optionB,optionC,optionD,correctAnswer,subject,questionType
"","A","B","C","D","A","Math","REAL_PAST_QUESTION"`;

        const stream = Readable.from([csvContent]);
        const result = await parseCSVStream(stream);

        // Empty string should be parsed, validation happens in processBulkUpload
        expect(result[0].questionText).toBe('');
    });

    it('should preserve content within quoted fields', async () => {
        const csvContent = `questionText,optionA,optionB,optionC,optionD,correctAnswer,subject,questionType
"  Trimmed Question  ","  A  ","  B  ","  C  ","  D  ","A","Math","REAL_PAST_QUESTION"`;

        const stream = Readable.from([csvContent]);
        const result = await parseCSVStream(stream);

        // csv-parse preserves content within quotes (intentional - allows formatted text)
        expect(result[0].questionText).toBe('  Trimmed Question  ');
    });
});

describe('Bulk Upload - Option E Support', () => {
    it('should parse optionE when provided', async () => {
        const csvContent = `questionText,optionA,optionB,optionC,optionD,optionE,correctAnswer,subject,questionType
"Five options","A","B","C","D","E","E","Chemistry","REAL_PAST_QUESTION"`;

        const stream = Readable.from([csvContent]);
        const result = await parseCSVStream(stream);

        expect(result[0].optionE).toBe('E');
        expect(result[0].correctAnswer).toBe('E');
    });

    it('should handle optionE as null when empty', async () => {
        const csvContent = `questionText,optionA,optionB,optionC,optionD,optionE,correctAnswer,subject,questionType
"Four options","A","B","C","D","","A","Chemistry","REAL_PAST_QUESTION"`;

        const stream = Readable.from([csvContent]);
        const result = await parseCSVStream(stream);

        expect(result[0].optionE).toBeNull();
    });
});

describe('Bulk Upload - Explanation image support', () => {
    it('should parse explanation image URLs and notes when provided', async () => {
        const csvContent = `questionText,optionA,optionB,optionC,optionD,correctAnswer,subject,questionType,explanationText,explanationImageUrl,additionalNotes
"Image question","A","B","C","D","A","Biology","REAL_PAST_QUESTION","Because it is correct","https://example.com/explanation.png","Review diagram"`; 

        const stream = Readable.from([csvContent]);
        const result = await parseCSVStream(stream);

        expect(result[0].explanationText).toBe('Because it is correct');
        expect(result[0].explanationImageUrl).toBe('https://example.com/explanation.png');
        expect(result[0].additionalNotes).toBe('Review diagram');
    });
});

describe('Bulk Upload - Performance', () => {
    it('should handle 100 rows efficiently', async () => {
        const maxDurationMs = Number.parseInt(process.env.BULK_UPLOAD_PERF_BUDGET_MS || '500', 10);
        const header = 'questionText,optionA,optionB,optionC,optionD,correctAnswer,subject,questionType';
        const rows = Array.from({ length: 100 }, (_, i) =>
            `"Question ${i}","A","B","C","D","A","Math","REAL_PAST_QUESTION"`
        ).join('\n');

        const csvContent = `${header}\n${rows}`;

        const start = performance.now();
        const stream = Readable.from([csvContent]);
        const result = await parseCSVStream(stream);
        const duration = performance.now() - start;

        expect(result).toHaveLength(100);
        // Keep a performance guard, but avoid flaky failures across local/CI hosts.
        expect(duration).toBeLessThan(maxDurationMs);
    });
});
