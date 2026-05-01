export interface CreateQuestionInput {
    questionText: string;
    institutionCode?: string;
    hasImage?: boolean;
    imageUrl?: string | null;
    imagePublicId?: string | null;

    
    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    optionE?: string | null;

    
    optionAImageUrl?: string | null;
    optionAImagePublicId?: string | null;
    optionBImageUrl?: string | null;
    optionBImagePublicId?: string | null;
    optionCImageUrl?: string | null;
    optionCImagePublicId?: string | null;
    optionDImageUrl?: string | null;
    optionDImagePublicId?: string | null;
    optionEImageUrl?: string | null;
    optionEImagePublicId?: string | null;

    correctAnswer: 'A' | 'B' | 'C' | 'D' | 'E';

    
    subject: string;
    topic?: string | null;
    difficultyLevel?: string | null;
    questionType: string; // Canonical DB values: 'real_past_question' | 'practice' | 'ai_generated'
    questionPool?: string; // FREE_EXAM | REAL_BANK | PRACTICE
    year?: number | null;

    // Parent Question (for Passages)
    parentQuestionId?: number | null;

    
    explanationText?: string | null;
    explanationImageUrl?: string | null;
    explanationImagePublicId?: string | null;
    additionalNotes?: string | null;
}

export interface UpdateQuestionInput extends Partial<CreateQuestionInput> { }

export interface QuestionFilterQuery {
    institutionCode?: string;
    subject?: string;
    topic?: string;
    questionType?: string;
    questionPool?: string;
    search?: string;
    page?: number;
    limit?: number;
    hasImage?: boolean;
    isAiGenerated?: boolean;
    year?: number;
}

export interface QuestionResponse {
    id: number;
    institutionId?: number | null;
    institutionCode?: string | null;
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
    isFeaturedFree: boolean;
    year: number | null;

    parentQuestionId: number | null;
    parentQuestion?: {
        id: number;
        questionText: string;
        imageUrl: string | null;
    } | null;

    explanation?: {
        explanationText: string;
        explanationImageUrl: string | null;
        explanationImagePublicId: string | null;
        additionalNotes: string | null;
    } | null;

    createdAt: string;
    updatedAt: string;
}

export interface QuestionAssetUploadResponse {
    provider: 'CLOUDINARY';
    kind: string;
    url: string;
    publicId: string;
    bytes: number | null;
    width: number | null;
    height: number | null;
    format: string | null;
    originalFilename: string | null;
}

export interface BulkQuestionUploadQuery {
    institutionCode?: string;
    fileHash?: string;
}
