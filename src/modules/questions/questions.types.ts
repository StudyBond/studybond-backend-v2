
// ============================================
// QUESTIONS MODULE TYPES
// ============================================
// Type definitions for question management

export interface CreateQuestionInput {
    questionText: string;
    hasImage?: boolean;
    imageUrl?: string | null;

    // Options
    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    optionE?: string | null;

    // Option Images
    optionAImageUrl?: string | null;
    optionBImageUrl?: string | null;
    optionCImageUrl?: string | null;
    optionDImageUrl?: string | null;
    optionEImageUrl?: string | null;

    correctAnswer: 'A' | 'B' | 'C' | 'D' | 'E';

    // Classification
    subject: string;
    topic?: string | null;
    difficultyLevel?: string | null;
    questionType: string; // 'REAL_PAST_QUESTION' | 'PRACTICE' | 'AI_GENERATED'

    // Parent Question (for Passages)
    parentQuestionId?: number | null;

    // Explanation
    explanationText?: string | null;
    explanationImageUrl?: string | null;
    additionalNotes?: string | null;
}

export interface UpdateQuestionInput extends Partial<CreateQuestionInput> { }

export interface QuestionFilterQuery {
    subject?: string;
    topic?: string;
    questionType?: string;
    year?: string; // Often stored in metadata or topic if not explicit
    search?: string;
    page?: number;
    limit?: number;
    hasImage?: boolean;
    isAiGenerated?: boolean;
}

export interface QuestionResponse {
    id: number;
    questionText: string;
    hasImage: boolean;
    imageUrl: string | null;

    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    optionE: string | null;

    optionAImageUrl: string | null;
    optionBImageUrl: string | null;
    optionCImageUrl: string | null;
    optionDImageUrl: string | null;
    optionEImageUrl: string | null;

    correctAnswer: string;

    subject: string;
    topic: string | null;
    difficultyLevel: string | null;
    questionType: string;

    parentQuestionId: number | null;
    parentQuestion?: {
        id: number;
        questionText: string;
        imageUrl: string | null;
    } | null;

    explanation?: {
        explanationText: string;
        explanationImageUrl: string | null;
        additionalNotes: string | null;
    } | null;

    createdAt: Date;
    updatedAt: Date;
}
