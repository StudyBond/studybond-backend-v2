import { describe, it, expect } from 'vitest';
import { randomSelect, stratifiedTopicSelect } from '../../modules/exams/question-selector';
import type { TopicBlueprintEntry } from '../../modules/exams/exams.types';

// ---- Helpers ----

interface MockQuestion {
    id: number;
    topic: string | null;
    difficultyLevel: string | null;
    parentQuestionId: number | null;
}

function makeQuestion(
    id: number,
    topic: string | null,
    difficulty: string | null = null,
    parentQuestionId: number | null = null
): MockQuestion {
    return { id, topic, difficultyLevel: difficulty, parentQuestionId };
}

function makeQuestions(
    topicDistribution: Record<string, number>,
    startId: number = 1,
    difficulty: string | null = null
): MockQuestion[] {
    const questions: MockQuestion[] = [];
    let id = startId;
    for (const [topic, count] of Object.entries(topicDistribution)) {
        const topicValue = topic === '__null__' ? null : topic;
        for (let i = 0; i < count; i++) {
            questions.push(makeQuestion(id++, topicValue, difficulty));
        }
    }
    return questions;
}


// ============================================================
// TEST SUITES
// ============================================================

describe('randomSelect — Core Behavior', () => {
    it('returns empty array for empty input', () => {
        const result = randomSelect([], 25);
        expect(result).toEqual([]);
    });

    it('returns empty array when desiredCount is 0', () => {
        const candidates = makeQuestions({ Concord: 10 });
        const result = randomSelect(candidates, 0);
        expect(result).toEqual([]);
    });

    it('returns all candidates (shuffled) when fewer than desired', () => {
        const candidates = makeQuestions({ Concord: 5, Vowels: 3 });
        const result = randomSelect(candidates, 25);
        expect(result).toHaveLength(8);
        // Should contain exactly the same IDs
        const inputIds = new Set(candidates.map(q => q.id));
        const outputIds = new Set(result.map(q => q.id));
        expect(outputIds).toEqual(inputIds);
    });

    it('returns exactly desiredCount questions', () => {
        const candidates = makeQuestions({ Concord: 30, Vowels: 30, Grammar: 30 });
        const result = randomSelect(candidates, 25);
        expect(result).toHaveLength(25);
    });

    it('handles single-topic gracefully', () => {
        const candidates = makeQuestions({ Concord: 100 });
        const result = randomSelect(candidates, 25);
        expect(result).toHaveLength(25);
    });

    it('handles all null topics gracefully', () => {
        const candidates = makeQuestions({ __null__: 100 });
        const result = randomSelect(candidates, 25);
        expect(result).toHaveLength(25);
    });
});


describe('randomSelect — Randomness Guarantees', () => {
    it('produces different selections across multiple runs', () => {
        const candidates = makeQuestions({ A: 50, B: 50, C: 50 });
        const runs = new Set<string>();

        for (let i = 0; i < 10; i++) {
            const result = randomSelect(candidates, 15);
            runs.add(result.map(q => q.id).sort((a, b) => a - b).join(','));
        }

        // With 150 candidates selecting 15, statistical likelihood of duplicate sets is near zero
        expect(runs.size).toBeGreaterThan(1);
    });

    it('draws from the ENTIRE pool, not a subset', () => {
        // Create a large pool — pure random should touch many different IDs across runs
        const candidates = makeQuestions({ Subject: 500 });
        const seenIds = new Set<number>();

        for (let i = 0; i < 50; i++) {
            const result = randomSelect(candidates, 20);
            for (const q of result) {
                seenIds.add(q.id);
            }
        }

        // Over 50 runs × 20 questions from 500, we should see a significant portion
        // of the pool (well over 50%). This is the key property that was broken
        // with stratified selection.
        expect(seenIds.size).toBeGreaterThan(250);
    });

    it('total selected always equals desiredCount with sufficient data', () => {
        const candidates = makeQuestions({
            A: 100, B: 100, C: 100, D: 100, E: 100
        });

        for (let i = 0; i < 50; i++) {
            const result = randomSelect(candidates, 25);
            expect(result).toHaveLength(25);
        }
    });

    it('never produces duplicate question IDs', () => {
        const candidates = makeQuestions({
            A: 50, B: 50, C: 50, D: 50
        });

        for (let i = 0; i < 50; i++) {
            const result = randomSelect(candidates, 25);
            const ids = result.map(q => q.id);
            expect(new Set(ids).size).toBe(ids.length);
        }
    });
});


describe('randomSelect — Blueprint parameter ignored', () => {
    it('ignores blueprint and still returns correct count', () => {
        const blueprint: Record<string, TopicBlueprintEntry> = {
            Comprehension: { quota: 5 },
            Concord: { quota: 3 },
            Grammar: { quota: 4 },
            __other__: { quota: 13 }
        };

        const candidates = makeQuestions({
            Comprehension: 30,
            Concord: 20,
            Grammar: 25,
            Vowels: 50,
            Register: 30
        });

        const result = randomSelect(candidates, 25, blueprint);
        expect(result).toHaveLength(25);
    });
});


describe('stratifiedTopicSelect — Deprecated Alias', () => {
    it('is an alias for randomSelect', () => {
        expect(stratifiedTopicSelect).toBe(randomSelect);
    });

    it('still works through the alias', () => {
        const candidates = makeQuestions({ A: 50, B: 50 });
        const result = stratifiedTopicSelect(candidates, 10);
        expect(result).toHaveLength(10);
    });
});
