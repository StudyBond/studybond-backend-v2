import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { BOOKMARK_LIMITS } from '../../modules/bookmarks/bookmarks.schema';
import { hashPassword } from '../../shared/utils/hash';
import { generateTokens } from '../../shared/utils/jwt';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;

interface BookmarkFixture {
  userIds: number[];
  questionIds: number[];
  examIds: number[];
  sessionIds: string[];
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function createUserFixture(
  fixture: BookmarkFixture,
  input: Partial<{
    email: string;
    password: string;
    isPremium: boolean;
    deviceAccessMode: 'FREE' | 'PREMIUM';
  }> = {}
) {
  const password = input.password || 'SecurePass123!';
  const user = await prisma.user.create({
    data: {
      email: input.email || `${uniqueToken('bookmark-user')}@example.com`,
      passwordHash: await hashPassword(password),
      fullName: uniqueToken('Bookmark User'),
      isVerified: true,
      isPremium: input.isPremium ?? false,
      deviceAccessMode: input.deviceAccessMode ?? (input.isPremium ? 'PREMIUM' : 'FREE')
    }
  });

  fixture.userIds.push(user.id);
  return { user, password };
}

async function createAuthenticatedSession(
  fixture: BookmarkFixture,
  user: { id: number; email: string; role: string },
  deviceId = uniqueToken('bookmark-device')
) {
  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      deviceId,
      isActive: true,
      authPolicyVersion: 0,
      tokenVersion: 0,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    }
  });

  fixture.sessionIds.push(session.id);

  const tokens = generateTokens(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    session.id,
    deviceId,
    session.tokenVersion
  );

  return {
    authorization: `Bearer ${tokens.accessToken}`,
    sessionId: session.id
  };
}

async function createQuestionFixture(fixture: BookmarkFixture, subject = 'Biology') {
  const question = await prisma.question.create({
    data: {
      questionText: `Question ${uniqueToken('bookmark-question')}`,
      optionA: 'Option A',
      optionB: 'Option B',
      optionC: 'Option C',
      optionD: 'Option D',
      correctAnswer: 'A',
      subject,
      topic: 'Genetics',
      questionType: 'MULTIPLE_CHOICE'
    }
  });

  fixture.questionIds.push(question.id);
  return question;
}

async function createManyQuestions(fixture: BookmarkFixture, count: number, subject = 'Biology') {
  const questions = [];
  for (let index = 0; index < count; index += 1) {
    questions.push(await createQuestionFixture(fixture, subject));
  }
  return questions;
}

async function createExamFixture(
  fixture: BookmarkFixture,
  userId: number,
  questionIds: number[]
) {
  const exam = await prisma.exam.create({
    data: {
      userId,
      examType: 'PRACTICE',
      nameScopeKey: `PRACTICE:BOOKMARK:${uniqueToken('scope')}`,
      sessionNumber: 1,
      subjectsIncluded: ['Biology'],
      totalQuestions: questionIds.length,
      score: 0,
      percentage: null,
      spEarned: 0,
      status: 'IN_PROGRESS'
    }
  });

  fixture.examIds.push(exam.id);

  await prisma.examAnswer.createMany({
    data: questionIds.map((questionId) => ({
      examId: exam.id,
      questionId,
      userAnswer: null,
      isCorrect: false
    }))
  });

  return exam;
}

async function cleanupFixture(fixture: BookmarkFixture): Promise<void> {
  if (fixture.examIds.length > 0) {
    await prisma.bookmarkedQuestion.deleteMany({
      where: {
        OR: [
          { examId: { in: fixture.examIds } },
          { userId: { in: fixture.userIds } }
        ]
      }
    });
  } else {
    await prisma.bookmarkedQuestion.deleteMany({
      where: { userId: { in: fixture.userIds } }
    });
  }

  if (fixture.examIds.length > 0) {
    await prisma.examAnswer.deleteMany({
      where: { examId: { in: fixture.examIds } }
    });
  }

  await prisma.exam.deleteMany({
    where: { id: { in: fixture.examIds } }
  });

  await prisma.userSession.deleteMany({
    where: { id: { in: fixture.sessionIds } }
  });

  await prisma.user.deleteMany({
    where: { id: { in: fixture.userIds } }
  });

  await prisma.question.deleteMany({
    where: { id: { in: fixture.questionIds } }
  });
}

describeE2E('Bookmarks module (HTTP e2e)', () => {
  it('creates, lists, updates, and deletes bookmarks for the authenticated user', async () => {
    const fixture: BookmarkFixture = { userIds: [], questionIds: [], examIds: [], sessionIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createUserFixture(fixture);
      const auth = await createAuthenticatedSession(fixture, user);
      const question = await createQuestionFixture(fixture, 'Biology');
      const exam = await createExamFixture(fixture, user.id, [question.id]);

      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/bookmarks',
        headers: {
          authorization: auth.authorization
        },
        payload: {
          questionId: question.id,
          examId: exam.id,
          notes: 'Revise meiosis before the next mock.'
        }
      });

      expect(createResponse.statusCode).toBe(201);
      expect(createResponse.json().data).toEqual(expect.objectContaining({
        questionId: question.id,
        examId: exam.id,
        notes: 'Revise meiosis before the next mock.',
        question: expect.objectContaining({
          id: question.id,
          subject: 'Biology'
        })
      }));

      const bookmarkId = createResponse.json().data.id as number;

      const listResponse = await app.inject({
        method: 'GET',
        url: '/api/bookmarks?page=1&limit=10&subject=Biology',
        headers: {
          authorization: auth.authorization
        }
      });

      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json().data.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1
      });
      expect(listResponse.json().data.limits).toEqual(expect.objectContaining({
        activeBookmarks: 1,
        maxBookmarks: BOOKMARK_LIMITS.FREE_USER_MAX_BOOKMARKS,
        remainingBookmarks: BOOKMARK_LIMITS.FREE_USER_MAX_BOOKMARKS - 1,
        accessTier: 'FREE'
      }));

      const getResponse = await app.inject({
        method: 'GET',
        url: `/api/bookmarks/${bookmarkId}`,
        headers: {
          authorization: auth.authorization
        }
      });

      expect(getResponse.statusCode).toBe(200);
      expect(getResponse.json().data.id).toBe(bookmarkId);

      const updateResponse = await app.inject({
        method: 'PATCH',
        url: `/api/bookmarks/${bookmarkId}`,
        headers: {
          authorization: auth.authorization
        },
        payload: {
          notes: null
        }
      });

      expect(updateResponse.statusCode).toBe(200);
      expect(updateResponse.json().data).toEqual(expect.objectContaining({
        id: bookmarkId,
        notes: null
      }));

      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/api/bookmarks/${bookmarkId}`,
        headers: {
          authorization: auth.authorization
        }
      });

      expect(deleteResponse.statusCode).toBe(200);
      expect(deleteResponse.json().data).toEqual({
        success: true,
        message: 'Bookmark removed successfully.'
      });

      const emptyListResponse = await app.inject({
        method: 'GET',
        url: '/api/bookmarks',
        headers: {
          authorization: auth.authorization
        }
      });

      expect(emptyListResponse.statusCode).toBe(200);
      expect(emptyListResponse.json().data.pagination.total).toBe(0);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('rejects duplicate active bookmarks for the same user and question', async () => {
    const fixture: BookmarkFixture = { userIds: [], questionIds: [], examIds: [], sessionIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createUserFixture(fixture);
      const auth = await createAuthenticatedSession(fixture, user);
      const question = await createQuestionFixture(fixture);

      await prisma.bookmarkedQuestion.create({
        data: {
          userId: user.id,
          questionId: question.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/bookmarks',
        headers: {
          authorization: auth.authorization
        },
        payload: {
          questionId: question.id
        }
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual(expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'BOOKMARK_ALREADY_EXISTS'
        })
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('does not count expired bookmarks toward the free-user cap and allows re-bookmarking the same question', async () => {
    const fixture: BookmarkFixture = { userIds: [], questionIds: [], examIds: [], sessionIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createUserFixture(fixture);
      const auth = await createAuthenticatedSession(fixture, user);
      const questions = await createManyQuestions(fixture, BOOKMARK_LIMITS.FREE_USER_MAX_BOOKMARKS, 'Chemistry');
      const activeQuestions = questions.slice(0, BOOKMARK_LIMITS.FREE_USER_MAX_BOOKMARKS - 1);
      const expiredQuestion = questions[questions.length - 1];

      await prisma.bookmarkedQuestion.createMany({
        data: activeQuestions.map((question) => ({
          userId: user.id,
          questionId: question.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }))
      });

      await prisma.bookmarkedQuestion.create({
        data: {
          userId: user.id,
          questionId: expiredQuestion.id,
          expiresAt: new Date(Date.now() - 60 * 1000)
        }
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/bookmarks',
        headers: {
          authorization: auth.authorization
        },
        payload: {
          questionId: expiredQuestion.id,
          notes: 'Reactivated after expiry'
        }
      });

      expect(response.statusCode).toBe(201);

      const refreshedBookmarks = await prisma.bookmarkedQuestion.findMany({
        where: {
          userId: user.id
        }
      });
      const activeBookmarkCount = refreshedBookmarks.filter((bookmark) =>
        bookmark.expiresAt ? bookmark.expiresAt > new Date() : true
      ).length;
      const matchingQuestionBookmarks = refreshedBookmarks.filter(
        (bookmark) => bookmark.questionId === expiredQuestion.id
      );

      expect(activeBookmarkCount).toBe(BOOKMARK_LIMITS.FREE_USER_MAX_BOOKMARKS);
      expect(matchingQuestionBookmarks).toHaveLength(1);
      expect(matchingQuestionBookmarks[0].notes).toBe('Reactivated after expiry');
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('enforces the premium bookmark cap at fifty active bookmarks', async () => {
    const fixture: BookmarkFixture = { userIds: [], questionIds: [], examIds: [], sessionIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createUserFixture(fixture, {
        isPremium: true,
        deviceAccessMode: 'PREMIUM'
      });
      const auth = await createAuthenticatedSession(fixture, user);
      const questions = await createManyQuestions(fixture, BOOKMARK_LIMITS.PREMIUM_USER_MAX_BOOKMARKS + 1, 'Physics');

      await prisma.bookmarkedQuestion.createMany({
        data: questions.slice(0, BOOKMARK_LIMITS.PREMIUM_USER_MAX_BOOKMARKS).map((question) => ({
          userId: user.id,
          questionId: question.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }))
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/bookmarks',
        headers: {
          authorization: auth.authorization
        },
        payload: {
          questionId: questions[BOOKMARK_LIMITS.PREMIUM_USER_MAX_BOOKMARKS].id
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual(expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'BOOKMARK_LIMIT_REACHED'
        })
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('rejects bookmark creation when the provided exam does not actually contain the question', async () => {
    const fixture: BookmarkFixture = { userIds: [], questionIds: [], examIds: [], sessionIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createUserFixture(fixture);
      const auth = await createAuthenticatedSession(fixture, user);
      const examQuestion = await createQuestionFixture(fixture, 'Mathematics');
      const otherQuestion = await createQuestionFixture(fixture, 'Mathematics');
      const exam = await createExamFixture(fixture, user.id, [examQuestion.id]);

      const response = await app.inject({
        method: 'POST',
        url: '/api/bookmarks',
        headers: {
          authorization: auth.authorization
        },
        payload: {
          questionId: otherQuestion.id,
          examId: exam.id
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual(expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'BOOKMARK_EXAM_QUESTION_MISMATCH'
        })
      }));
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);
});
