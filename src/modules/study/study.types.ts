// Study Mode types — the 'teaching' counterpart to exam's 'testing'

import { Subject } from '../exams/exams.constants';

// ─── Request Types ───

export interface StartStudySessionInput {
    subjects: Subject[];
    institutionCode?: string;
    mode?: 'random' | 'topic';
    selectedTopics?: string[];
}

export interface SubtopicInfo {
    name: string;
    questionCount: number;
    rawTopics: string[];
}

export interface TopicFamilyInfo {
    topicFamily: string;
    totalQuestions: number;
    subtopics: SubtopicInfo[];
}

export interface SubjectTopicTree {
    subject: string;
    totalQuestions: number;
    topicFamilies: TopicFamilyInfo[];
}

export interface GetTopicsResponse {
    subjects: SubjectTopicTree[];
}

export interface CompleteStudySessionInput {
    /** Number of questions the student answered correctly on first attempt */
    correctCount: number;
    /** Number of questions the student answered incorrectly */
    wrongCount: number;
    /** Number of questions where student used "Show Answer" without attempting */
    revealedCount: number;
    /** Number of questions the student skipped entirely */
    skippedCount: number;
    /** Best consecutive correct answer streak during the session */
    bestStreak: number;
    /** Total time spent studying in seconds */
    timeSpentSeconds: number;
    /** Per-subject mastery breakdown */
    subjectMastery: {
        subject: string;
        correct: number;
        total: number;
    }[];
}

// ─── Response Types ───

export interface StudyQuestionForClient {
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
    parentQuestionText: string | null;
    parentQuestionImageUrl: string | null;
    subject: string;
    topic: string | null;
    /** Included upfront — this is Study Mode, not exam */
    correctAnswer: string;
    /** Explanation text (if available) */
    explanation: {
        text: string;
        imageUrl: string | null;
        additionalNotes: string | null;
    } | null;
}

export interface StudySessionResponse {
    examId: number;
    subjects: string[];
    totalQuestions: number;
    isPremiumSession: boolean;
    questions: StudyQuestionForClient[];
}

export interface CompleteStudySessionResponse {
    examId: number;
    status: string;
    message: string;
}
