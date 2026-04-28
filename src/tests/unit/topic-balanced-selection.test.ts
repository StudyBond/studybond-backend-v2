import { describe, it, expect } from 'vitest';
import { stratifiedTopicSelect } from '../../modules/exams/question-selector';
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

function countTopics(questions: MockQuestion[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const q of questions) {
        const key = q.topic ?? '__null__';
        counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
}


// ============================================================
// TEST SUITES
// ============================================================

describe('stratifiedTopicSelect — Uniform Mode (no blueprint)', () => {
    it('returns empty array for empty input', () => {
        const result = stratifiedTopicSelect([], 25);
        expect(result).toEqual([]);
    });

    it('returns empty array when desiredCount is 0', () => {
        const candidates = makeQuestions({ Concord: 10 });
        const result = stratifiedTopicSelect(candidates, 0);
        expect(result).toEqual([]);
    });

    it('returns all candidates when fewer than desired', () => {
        const candidates = makeQuestions({ Concord: 5, Vowels: 3 });
        const result = stratifiedTopicSelect(candidates, 25);
        expect(result).toHaveLength(8);
    });

    it('returns exactly desiredCount questions', () => {
        const candidates = makeQuestions({ Concord: 30, Vowels: 30, Grammar: 30 });
        const result = stratifiedTopicSelect(candidates, 25);
        expect(result).toHaveLength(25);
    });

    it('distributes evenly across 5 topics for 25 questions', () => {
        const candidates = makeQuestions({
            Concord: 20,
            Comprehension: 20,
            Vowels: 20,
            Grammar: 20,
            Register: 20
        });

        const result = stratifiedTopicSelect(candidates, 25);
        const counts = countTopics(result);

        expect(result).toHaveLength(25);
        // Each topic should get exactly 5 (25 / 5 = 5)
        for (const topic of Object.keys(counts)) {
            expect(counts[topic]).toBe(5);
        }
    });

    it('prevents topic dominance with heavily skewed data', () => {
        const candidates = makeQuestions({
            Concord: 500,
            Comprehension: 50,
            Vowels: 30,
            Grammar: 20,
            Register: 15
        });

        const result = stratifiedTopicSelect(candidates, 25);
        const counts = countTopics(result);

        expect(result).toHaveLength(25);
        // Concord must NOT dominate — should get ~5 (its fair share), never more than ~10
        expect(counts['Concord']).toBeLessThanOrEqual(10);
        // Every topic should appear at least once
        expect(Object.keys(counts).length).toBe(5);
    });

    it('handles single-topic gracefully (passthrough mode)', () => {
        const candidates = makeQuestions({ Concord: 100 });
        const result = stratifiedTopicSelect(candidates, 25);
        expect(result).toHaveLength(25);
        expect(countTopics(result)['Concord']).toBe(25);
    });

    it('handles all null topics gracefully (passthrough mode)', () => {
        const candidates = makeQuestions({ __null__: 100 });
        const result = stratifiedTopicSelect(candidates, 25);
        expect(result).toHaveLength(25);
    });

    it('groups null topics into __other__ bucket alongside named topics', () => {
        const candidates = makeQuestions({
            Concord: 20,
            __null__: 20
        });

        const result = stratifiedTopicSelect(candidates, 10);
        const counts = countTopics(result);

        expect(result).toHaveLength(10);
        // Both buckets should get a fair share
        expect(counts['Concord']).toBeGreaterThanOrEqual(3);
        expect(counts['__null__']).toBeGreaterThanOrEqual(3);
    });

    it('redistributes from short topics to remaining topics', () => {
        const candidates = makeQuestions({
            Concord: 50,
            Vocabulary: 2, // Not enough for full quota
            Grammar: 50
        });

        const result = stratifiedTopicSelect(candidates, 25);
        const counts = countTopics(result);

        expect(result).toHaveLength(25);
        // Vocabulary should contribute its 2 questions
        expect(counts['Vocabulary']).toBe(2);
        // Remaining 23 should be split between Concord and Grammar
        expect((counts['Concord'] ?? 0) + (counts['Grammar'] ?? 0)).toBe(23);
    });

    it('produces different selections across multiple runs (randomness)', () => {
        const candidates = makeQuestions({ A: 50, B: 50, C: 50 });
        const runs = new Set<string>();

        for (let i = 0; i < 10; i++) {
            const result = stratifiedTopicSelect(candidates, 15);
            runs.add(result.map(q => q.id).join(','));
        }

        // With 150 candidates selecting 15, statistical likelihood of duplicates is near zero
        expect(runs.size).toBeGreaterThan(1);
    });
});


describe('stratifiedTopicSelect — Blueprint Mode', () => {
    it('respects explicit topic quotas', () => {
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

        const result = stratifiedTopicSelect(candidates, 25, blueprint);
        const counts = countTopics(result);

        expect(result).toHaveLength(25);
        expect(counts['Comprehension']).toBe(5);
        expect(counts['Concord']).toBe(3);
        expect(counts['Grammar']).toBe(4);

        // Vowels + Register fall into __other__ bucket
        const otherCount = (counts['Vowels'] ?? 0) + (counts['Register'] ?? 0);
        expect(otherCount).toBe(13);
    });

    it('caps topic quota when bucket has fewer questions than quota', () => {
        const blueprint: Record<string, TopicBlueprintEntry> = {
            Comprehension: { quota: 10 },
            Concord: { quota: 3 },
            __other__: { quota: 12 }
        };

        const candidates = makeQuestions({
            Comprehension: 5, // Fewer than quota of 10
            Concord: 20,
            Grammar: 50
        });

        const result = stratifiedTopicSelect(candidates, 25, blueprint);
        const counts = countTopics(result);

        expect(result).toHaveLength(25);
        // Capped at available 5, not quota of 10
        expect(counts['Comprehension']).toBe(5);
        expect(counts['Concord']).toBe(3);
    });

    it('fills remaining slots from __other__ when quotas underflow', () => {
        const blueprint: Record<string, TopicBlueprintEntry> = {
            Concord: { quota: 3 },
            // Small total quota (3), but desiredCount is 10
            __other__: { quota: 2 }
        };

        const candidates = makeQuestions({
            Concord: 20,
            Grammar: 50,
            Vocabulary: 30
        });

        const result = stratifiedTopicSelect(candidates, 10, blueprint);
        expect(result).toHaveLength(10);

        const counts = countTopics(result);
        expect(counts['Concord']).toBe(3);
    });

    it('handles empty blueprint topic gracefully (no candidates match named topic)', () => {
        const blueprint: Record<string, TopicBlueprintEntry> = {
            Phonetics: { quota: 5 }, // No candidates have this topic
            __other__: { quota: 20 }
        };

        const candidates = makeQuestions({
            Concord: 30,
            Grammar: 30
        });

        const result = stratifiedTopicSelect(candidates, 25, blueprint);
        expect(result).toHaveLength(25);
    });

    it('handles passage groups with requirePassageGroup', () => {
        const blueprint: Record<string, TopicBlueprintEntry> = {
            Comprehension: { quota: 5, requirePassageGroup: true },
            __other__: { quota: 20 }
        };

        // Create a passage group: 5 questions sharing parentQuestionId=100
        const passageQuestions: MockQuestion[] = [];
        for (let i = 0; i < 5; i++) {
            passageQuestions.push(makeQuestion(1000 + i, 'Comprehension', null, 100));
        }
        // Another passage group: 3 questions sharing parentQuestionId=200
        for (let i = 0; i < 3; i++) {
            passageQuestions.push(makeQuestion(2000 + i, 'Comprehension', null, 200));
        }

        const otherQuestions = makeQuestions({ Grammar: 30, Vocabulary: 30 }, 3000);
        const candidates = [...passageQuestions, ...otherQuestions];

        const result = stratifiedTopicSelect(candidates, 25, blueprint);
        expect(result).toHaveLength(25);

        // Comprehension should have exactly 5 (one complete passage group)
        const comprehensionIds = result
            .filter(q => q.topic === 'Comprehension')
            .map(q => q.id);

        expect(comprehensionIds).toHaveLength(5);

        // All 5 should be from the same passage group
        const parentIds = new Set(
            result
                .filter(q => q.topic === 'Comprehension')
                .map(q => q.parentQuestionId)
        );
        expect(parentIds.size).toBe(1);
    });

    it('handles mixed passage and standalone comprehension questions', () => {
        const blueprint: Record<string, TopicBlueprintEntry> = {
            Comprehension: { quota: 7, requirePassageGroup: true },
            __other__: { quota: 18 }
        };

        // Passage group of 5
        const passageQuestions: MockQuestion[] = [];
        for (let i = 0; i < 5; i++) {
            passageQuestions.push(makeQuestion(1000 + i, 'Comprehension', null, 100));
        }
        // Standalone comprehension questions
        for (let i = 0; i < 10; i++) {
            passageQuestions.push(makeQuestion(2000 + i, 'Comprehension', null, null));
        }

        const otherQuestions = makeQuestions({ Grammar: 50 }, 3000);
        const candidates = [...passageQuestions, ...otherQuestions];

        const result = stratifiedTopicSelect(candidates, 25, blueprint);
        const comprehensionCount = result.filter(q => q.topic === 'Comprehension').length;

        // Should get 5 from passage + 2 standalone = 7
        expect(comprehensionCount).toBe(7);
    });
});


describe('stratifiedTopicSelect — Difficulty Sub-Stratification', () => {
    it('mixes difficulty levels within topic selections', () => {
        const candidates: MockQuestion[] = [
            ...Array.from({ length: 30 }, (_, i) =>
                makeQuestion(i + 1, 'Grammar', 'easy')
            ),
            ...Array.from({ length: 30 }, (_, i) =>
                makeQuestion(i + 31, 'Grammar', 'medium')
            ),
            ...Array.from({ length: 30 }, (_, i) =>
                makeQuestion(i + 61, 'Grammar', 'hard')
            )
        ];

        const result = stratifiedTopicSelect(candidates, 15);
        const difficultyCounts: Record<string, number> = {};

        for (const q of result) {
            const d = q.difficultyLevel ?? 'unset';
            difficultyCounts[d] = (difficultyCounts[d] ?? 0) + 1;
        }

        // Each difficulty should get exactly 5 (15 / 3 = 5)
        expect(difficultyCounts['easy']).toBe(5);
        expect(difficultyCounts['medium']).toBe(5);
        expect(difficultyCounts['hard']).toBe(5);
    });

    it('handles questions with no difficulty level set gracefully', () => {
        const candidates = makeQuestions({
            Grammar: 30,
            Vocabulary: 30
        });
        // All have null difficulty — should still work
        const result = stratifiedTopicSelect(candidates, 10);
        expect(result).toHaveLength(10);
    });

    it('handles mixed difficulty with some having null', () => {
        const candidates: MockQuestion[] = [
            ...Array.from({ length: 20 }, (_, i) =>
                makeQuestion(i + 1, 'Grammar', 'easy')
            ),
            ...Array.from({ length: 20 }, (_, i) =>
                makeQuestion(i + 21, 'Grammar', null)
            ),
            ...Array.from({ length: 20 }, (_, i) =>
                makeQuestion(i + 41, 'Grammar', 'hard')
            )
        ];

        const result = stratifiedTopicSelect(candidates, 15);
        expect(result).toHaveLength(15);

        const difficultyCounts: Record<string, number> = {};
        for (const q of result) {
            const d = q.difficultyLevel ?? '__unset__';
            difficultyCounts[d] = (difficultyCounts[d] ?? 0) + 1;
        }

        // 3 groups × 5 = 15 — each should get 5
        expect(difficultyCounts['easy']).toBe(5);
        expect(difficultyCounts['__unset__']).toBe(5);
        expect(difficultyCounts['hard']).toBe(5);
    });
});


describe('stratifiedTopicSelect — Statistical Balance', () => {
    it('no single topic exceeds 2× its fair share over many runs', () => {
        const candidates = makeQuestions({
            Concord: 200,
            Comprehension: 50,
            Vowels: 30,
            Grammar: 30,
            Register: 20
        });
        const desiredCount = 25;
        const topicCount = 5;
        const fairShare = desiredCount / topicCount; // 5

        const topicSums: Record<string, number> = {};
        const iterations = 100;

        for (let i = 0; i < iterations; i++) {
            const result = stratifiedTopicSelect(candidates, desiredCount);
            const counts = countTopics(result);
            for (const [topic, count] of Object.entries(counts)) {
                topicSums[topic] = (topicSums[topic] ?? 0) + count;
            }
        }

        for (const [topic, sum] of Object.entries(topicSums)) {
            const avg = sum / iterations;
            expect(avg).toBeLessThanOrEqual(fairShare * 2);
        }
    });

    it('total selected always equals desiredCount with sufficient data', () => {
        const candidates = makeQuestions({
            A: 100, B: 100, C: 100, D: 100, E: 100
        });

        for (let i = 0; i < 50; i++) {
            const result = stratifiedTopicSelect(candidates, 25);
            expect(result).toHaveLength(25);
        }
    });

    it('never produces duplicate question IDs', () => {
        const candidates = makeQuestions({
            A: 50, B: 50, C: 50, D: 50
        });

        for (let i = 0; i < 50; i++) {
            const result = stratifiedTopicSelect(candidates, 25);
            const ids = result.map(q => q.id);
            expect(new Set(ids).size).toBe(ids.length);
        }
    });
});
