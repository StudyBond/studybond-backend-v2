// Atomic score and Study Points (SP) calc (keeps things consistent during races)
import { AchievementKey, NotificationKind } from '@prisma/client';
import { SP_MULTIPLIERS, EXAM_TYPES } from './exams.constants';
import { SPCalculation } from './exams.types';
import { awardAchievementIfMissingTx } from '../../shared/achievements/service';
import { ACHIEVEMENT_CATALOG } from '../../shared/achievements/catalog';
import { upsertUserInstitutionStatsTx } from '../../shared/institutions/user-stats';
import { queueLeaderboardProjectionEventTx } from '../../shared/leaderboard/projection';
import { calculateNextStreakValues, getLagosDateValue } from '../../shared/streaks/domain';
import {
    notificationsService,
    type CreatedActivityNotificationEvent
} from '../notifications/notifications.service';


// Figure out the SP multiplier based on exam type and if they're retaking
export function getSPMultiplier(
    examType: string,
    isRetake: boolean,
    isCollaboration: boolean
): number {
    // Retakes always get 0.5x regardless of exam type
    if (isRetake) {
        return SP_MULTIPLIERS.RETAKE;
    }

    // Collaboration bonus (1v1 or group)
    if (isCollaboration) {
        return SP_MULTIPLIERS.COLLABORATION;
    }

    // Practice and bookmark exam questions get 0.5x
    if (examType === EXAM_TYPES.PRACTICE || examType === EXAM_TYPES.BOOKMARK_EXAM) {
        return SP_MULTIPLIERS.PRACTICE;
    }

    if (examType === EXAM_TYPES.MIXED) {
        return 0.75;
    }

    // Real past questions (first attempt, solo) get 1x
    return SP_MULTIPLIERS.REAL_SOLO;
}

function getBaseQuestionMultiplier(questionType?: string | null): number {
    return questionType === 'real_past_question'
        ? SP_MULTIPLIERS.REAL_SOLO
        : SP_MULTIPLIERS.PRACTICE;
}

// Just counts how many they got right
export function calculateRawScore(
    answers: Array<{ isCorrect: boolean }>
): number {
    return answers.filter(a => a.isCorrect).length;
}

// Get % rounded to 1 decimal place
export function calculatePercentage(
    score: number,
    totalQuestions: number
): number {
    if (totalQuestions === 0) return 0;
    return Math.round((score / totalQuestions) * 100 * 10) / 10; // 1 decimal place
}

// The actual SP calc
export function calculateSP(
    score: number,
    multiplier: number
): number {
    return Math.round(score * multiplier);
}

// Runs the full scoring logic in one go
export function calculateExamScore(
    answers: Array<{ isCorrect: boolean; questionType?: string | null }>,
    totalQuestions: number,
    examType: string,
    isRetake: boolean,
    isCollaboration: boolean
): SPCalculation {
    const rawScore = calculateRawScore(answers);
    const percentage = calculatePercentage(rawScore, totalQuestions);
    let spEarned = 0;

    // Daily challenge grants fixed SP regardless of score
    if (examType === EXAM_TYPES.DAILY_CHALLENGE) {
        spEarned = SP_MULTIPLIERS.DAILY_CHALLENGE_FIXED_SP;
        return {
            rawScore,
            percentage,
            multiplier: 0,
            spEarned
        };
    }

    if (isRetake) {
        const multiplier = getSPMultiplier(examType, true, false);
        spEarned = calculateSP(rawScore, multiplier);
    } else if (isCollaboration || examType === EXAM_TYPES.MIXED) {
        const weightedScore = answers.reduce((total, answer) => {
            if (!answer.isCorrect) return total;

            const questionMultiplier = getBaseQuestionMultiplier(answer.questionType);
            return total + (isCollaboration ? questionMultiplier * SP_MULTIPLIERS.COLLABORATION : questionMultiplier);
        }, 0);
        spEarned = Math.round(weightedScore);
    } else {
        const multiplier = getSPMultiplier(examType, false, false);
        spEarned = calculateSP(rawScore, multiplier);
    }

    const multiplier = rawScore > 0
        ? Math.round((spEarned / rawScore) * 100) / 100
        : getSPMultiplier(examType, isRetake, isCollaboration);

    return {
        rawScore,
        percentage,
        multiplier,
        spEarned
    };
}

// Compares user answers against the correct ones
export function gradeAnswers(
    userAnswers: Array<{ questionId: number; answer: string | null; timeSpentSeconds?: number }>,
    questions: Array<{ id: number; correctAnswer: string; questionType?: string | null }>
): Array<{
    questionId: number;
    userAnswer: string | null;
    isCorrect: boolean;
    timeSpentSeconds: number;
    questionType: string | null;
}> {
    const questionMap = new Map(questions.map(q => [q.id, {
        correctAnswer: q.correctAnswer,
        questionType: q.questionType ?? null
    }]));

    return userAnswers.map(answer => {
        const question = questionMap.get(answer.questionId);
        const correctAnswer = question?.correctAnswer;
        const isCorrect = answer.answer !== null && answer.answer === correctAnswer;

        return {
            questionId: answer.questionId,
            userAnswer: answer.answer,
            isCorrect,
            timeSpentSeconds: answer.timeSpentSeconds || 0,
            questionType: question?.questionType ?? null
        };
    });
}

// Update user's Study Points (SP) stats atomically so this is called within a transaction to ensure consistency
export async function updateUserStats(
    tx: any,
    userId: number,
    spEarned: number,
    examType: string,
    isCollaboration: boolean,
    institutionId?: number | null
): Promise<{
    totalSp: number;
    weeklySp: number;
    currentStreak: number;
    notificationEvents: CreatedActivityNotificationEvent[];
}> {
    const now = new Date();
    const today = getLagosDateValue(now);

    // Get current user data
    const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
            totalSp: true,
            weeklySp: true,
            currentStreak: true,
            longestStreak: true,
            lastActivityDate: true,
            streakFreezesAvailable: true,
            realExamsCompleted: true,
            completedCollaborationExams: true
        }
    });

    if (!user) {
        throw new Error('User not found');
    }

    const streakUpdate = calculateNextStreakValues(
        user.currentStreak,
        user.longestStreak,
        user.lastActivityDate ? new Date(user.lastActivityDate) : null,
        user.streakFreezesAvailable,
        now
    );
    const notificationInputs: Parameters<typeof notificationsService.createActivityNotificationsTx>[1] = [];

    // Update realExamsCompleted if this is a real past question exam
    const realExamsIncrement = examType === EXAM_TYPES.REAL_PAST_QUESTION ? 1 : 0;
    const collaborationCompletionsIncrement = isCollaboration ? 1 : 0;

    // Update user stats
    const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
            totalSp: { increment: spEarned },
            weeklySp: { increment: spEarned },
            currentStreak: streakUpdate.currentStreak,
            longestStreak: streakUpdate.longestStreak,
            streakFreezesAvailable: streakUpdate.streakFreezesAvailable,
            lastActivityDate: today,
            realExamsCompleted: { increment: realExamsIncrement },
            completedCollaborationExams: { increment: collaborationCompletionsIncrement }
        },
        select: {
            totalSp: true,
            weeklySp: true,
            currentStreak: true,
            completedCollaborationExams: true
        }
    });

    const institutionStats = await upsertUserInstitutionStatsTx(tx, {
        userId,
        institutionId,
        spEarned,
        examType,
        isCollaboration,
        occurredAt: now
    });

    if (streakUpdate.milestonesUnlocked.includes(7)) {
        const existingStarterAchievement = await tx.userAchievement.findUnique({
            where: {
                userId_key: {
                    userId,
                    key: AchievementKey.STREAK_7_DAY_STARTER
                }
            },
            select: { id: true }
        });
        await awardAchievementIfMissingTx(tx, userId, AchievementKey.STREAK_7_DAY_STARTER, {
            unlockedBy: 'STREAK_MILESTONE',
            milestoneDays: 7,
            longestStreak: streakUpdate.longestStreak
        });

        if (!existingStarterAchievement) {
            const definition = ACHIEVEMENT_CATALOG[AchievementKey.STREAK_7_DAY_STARTER];
            notificationInputs.push({
                userId,
                kind: NotificationKind.ACHIEVEMENT_UNLOCKED,
                title: `Achievement unlocked: ${definition.title}`,
                body: definition.description,
                deeplink: '/dashboard/settings',
                payload: {
                    achievementKey: definition.key,
                    title: definition.title,
                    category: definition.category
                },
                dedupKey: `achievement:${definition.key}`,
                sourceType: 'ACHIEVEMENT',
                sourceId: definition.key
            });
        }
    }

    if (isCollaboration && updatedUser.completedCollaborationExams >= 30) {
        const existingCollabAchievement = await tx.userAchievement.findUnique({
            where: {
                userId_key: {
                    userId,
                    key: AchievementKey.COLLABORATION_30_COMPLETIONS
                }
            },
            select: { id: true }
        });
        await awardAchievementIfMissingTx(tx, userId, AchievementKey.COLLABORATION_30_COMPLETIONS, {
            unlockedBy: 'COLLABORATION_COMPLETION_COUNT',
            completedCollaborationExams: updatedUser.completedCollaborationExams
        });

        if (!existingCollabAchievement) {
            const definition = ACHIEVEMENT_CATALOG[AchievementKey.COLLABORATION_30_COMPLETIONS];
            notificationInputs.push({
                userId,
                kind: NotificationKind.ACHIEVEMENT_UNLOCKED,
                title: `Achievement unlocked: ${definition.title}`,
                body: definition.description,
                deeplink: '/dashboard/settings',
                payload: {
                    achievementKey: definition.key,
                    title: definition.title,
                    category: definition.category
                },
                dedupKey: `achievement:${definition.key}`,
                sourceType: 'ACHIEVEMENT',
                sourceId: definition.key
            });
        }
    }

    for (const milestoneDays of streakUpdate.milestonesUnlocked) {
        notificationInputs.push({
            userId,
            kind: NotificationKind.STREAK_MILESTONE,
            title: `You hit a ${milestoneDays}-day streak`,
            body: milestoneDays >= 30
                ? 'Consistency like this compounds fast. Keep the streak moving.'
                : 'Your study rhythm is real now. Keep showing up for yourself.',
            deeplink: '/dashboard',
            payload: {
                milestoneDays,
                currentStreak: streakUpdate.currentStreak,
                longestStreak: streakUpdate.longestStreak
            },
            dedupKey: `streak-milestone:${milestoneDays}`,
            sourceType: 'STREAK',
            sourceId: String(milestoneDays)
        });
    }

    if (streakUpdate.streakFreezesAvailable > user.streakFreezesAvailable) {
        notificationInputs.push({
            userId,
            kind: NotificationKind.STREAK_FREEZER_AWARDED,
            title: 'Streak freezer awarded',
            body: 'You earned a streak freezer. One rough day no longer has to end your run.',
            deeplink: '/dashboard',
            payload: {
                streakFreezesAvailable: streakUpdate.streakFreezesAvailable
            },
            dedupKey: `streak-freezer:${streakUpdate.currentStreak}`,
            sourceType: 'STREAK',
            sourceId: String(streakUpdate.currentStreak)
        });
    }

    // Update or create study activity for today
    await tx.studyActivity.upsert({
        where: {
            userId_activityDate: {
                userId,
                activityDate: today
            }
        },
        create: {
            userId,
            activityDate: today,
            examsTaken: 1,
            spEarnedToday: spEarned
        },
        update: {
            examsTaken: { increment: 1 },
            spEarnedToday: { increment: spEarned }
        }
    });

    await queueLeaderboardProjectionEventTx(tx, {
        userId,
        institutionId: institutionStats.institutionId,
        weeklySp: institutionStats.weeklySp,
        totalSp: institutionStats.totalSp,
        source: 'EXAM_SUBMIT'
    });

    const notificationEvents = await notificationsService.createActivityNotificationsTx(
        tx,
        notificationInputs
    );

    return {
        totalSp: updatedUser.totalSp,
        weeklySp: updatedUser.weeklySp,
        currentStreak: updatedUser.currentStreak,
        notificationEvents
    };
}

// Track how many times questions are attempted/passed
export async function updateQuestionStats(
    tx: any,
    gradedAnswers: Array<{ questionId: number; isCorrect: boolean }>
): Promise<void> {
    if (gradedAnswers.length === 0) {
        return;
    }

    const groupedIncrements = new Map<number, { attempted: number; correct: number }>();

    for (const answer of gradedAnswers) {
        const existing = groupedIncrements.get(answer.questionId) ?? { attempted: 0, correct: 0 };
        existing.attempted += 1;
        if (answer.isCorrect) existing.correct += 1;
        groupedIncrements.set(answer.questionId, existing);
    }

    const entries = Array.from(groupedIncrements.entries());
    const valuesClause = entries
        .map((_, index) => {
            const base = index * 3;
            return `($${base + 1}, $${base + 2}, $${base + 3})`;
        })
        .join(', ');

    const params: Array<number> = [];
    for (const [questionId, increments] of entries) {
        params.push(questionId, increments.attempted, increments.correct);
    }

    await tx.$executeRawUnsafe(
        `
        UPDATE "Question" AS q
        SET
            "timesAttempted" = q."timesAttempted" + v."attempted"::integer,
            "timesCorrect" = q."timesCorrect" + v."correct"::integer
        FROM (VALUES ${valuesClause}) AS v("questionId", "attempted", "correct")
        WHERE q."id" = v."questionId"::integer
        `,
        ...params
    );
}
