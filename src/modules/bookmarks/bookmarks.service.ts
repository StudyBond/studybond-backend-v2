import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import {
  BOOKMARK_LIMITS,
  BookmarkListQuery,
  CreateBookmarkInput,
  UpdateBookmarkInput
} from './bookmarks.schema';

const bookmarkQuestionSelect = {
  id: true,
  questionText: true,
  subject: true,
  topic: true,
  hasImage: true,
  imageUrl: true
} satisfies Prisma.QuestionSelect;

const bookmarkInclude = {
  question: {
    select: bookmarkQuestionSelect
  }
} satisfies Prisma.BookmarkedQuestionInclude;

const bookmarkQuestionFullSelect = {
  id: true,
  questionText: true,
  subject: true,
  topic: true,
  hasImage: true,
  imageUrl: true,
  optionA: true,
  optionAImageUrl: true,
  optionB: true,
  optionBImageUrl: true,
  optionC: true,
  optionCImageUrl: true,
  optionD: true,
  optionDImageUrl: true,
  optionE: true,
  optionEImageUrl: true,
  correctAnswer: true,
  parentQuestionText: true,
  explanation: {
    select: {
      text: true,
      imageUrl: true,
      additionalNotes: true
    }
  }
} satisfies Prisma.QuestionSelect;

const bookmarkFullInclude = {
  question: {
    select: bookmarkQuestionFullSelect
  }
} satisfies Prisma.BookmarkedQuestionInclude;

type BookmarkWithQuestion = Prisma.BookmarkedQuestionGetPayload<{
  include: typeof bookmarkInclude;
}>;

type BookmarkFullWithQuestion = Prisma.BookmarkedQuestionGetPayload<{
  include: typeof bookmarkFullInclude;
}>;

type BookmarkTx = Prisma.TransactionClient;

function buildExpiryDate(now = new Date()): Date {
  return new Date(now.getTime() + BOOKMARK_LIMITS.EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

function isExpired(expiresAt: Date | null, now = new Date()): boolean {
  return Boolean(expiresAt && expiresAt <= now);
}

function serializeBookmark(bookmark: BookmarkWithQuestion) {
  return {
    id: bookmark.id,
    questionId: bookmark.questionId,
    examId: bookmark.examId,
    notes: bookmark.notes,
    createdAt: bookmark.createdAt.toISOString(),
    expiresAt: bookmark.expiresAt ? bookmark.expiresAt.toISOString() : null,
    question: {
      id: bookmark.question.id,
      questionText: bookmark.question.questionText,
      subject: bookmark.question.subject,
      topic: bookmark.question.topic,
      hasImage: bookmark.question.hasImage,
      imageUrl: bookmark.question.imageUrl
    }
  };
}

function serializeBookmarkFull(bookmark: BookmarkFullWithQuestion) {
  return {
    id: bookmark.id,
    questionId: bookmark.questionId,
    examId: bookmark.examId,
    notes: bookmark.notes,
    createdAt: bookmark.createdAt.toISOString(),
    expiresAt: bookmark.expiresAt ? bookmark.expiresAt.toISOString() : null,
    question: {
      id: bookmark.question.id,
      questionText: bookmark.question.questionText,
      subject: bookmark.question.subject,
      topic: bookmark.question.topic,
      hasImage: bookmark.question.hasImage,
      imageUrl: bookmark.question.imageUrl,
      optionA: bookmark.question.optionA,
      optionAImageUrl: bookmark.question.optionAImageUrl,
      optionB: bookmark.question.optionB,
      optionBImageUrl: bookmark.question.optionBImageUrl,
      optionC: bookmark.question.optionC,
      optionCImageUrl: bookmark.question.optionCImageUrl,
      optionD: bookmark.question.optionD,
      optionDImageUrl: bookmark.question.optionDImageUrl,
      optionE: bookmark.question.optionE,
      optionEImageUrl: bookmark.question.optionEImageUrl,
      correctAnswer: bookmark.question.correctAnswer,
      parentQuestionText: bookmark.question.parentQuestionText,
      explanation: bookmark.question.explanation
    }
  };
}

export class BookmarksService {
  private async runTransaction<T>(operation: (tx: BookmarkTx) => Promise<T>): Promise<T> {
    return prisma.$transaction(operation, {
      maxWait: BOOKMARK_LIMITS.TX_MAX_WAIT_MS,
      timeout: BOOKMARK_LIMITS.TX_TIMEOUT_MS
    });
  }

  private async purgeExpiredBookmarksTx(tx: BookmarkTx, userId: number, now = new Date()): Promise<number> {
    const deleted = await tx.bookmarkedQuestion.deleteMany({
      where: {
        userId,
        expiresAt: {
          lte: now
        }
      }
    });

    return deleted.count;
  }

  private activeBookmarkWhere(userId: number, subject?: string): Prisma.BookmarkedQuestionWhereInput {
    const now = new Date();
    return {
      userId,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } }
      ],
      ...(subject ? {
        question: {
          subject
        }
      } : {})
    };
  }

  async createBookmark(userId: number, data: CreateBookmarkInput) {
    const now = new Date();

    return this.runTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          isPremium: true
        }
      });

      if (!user) {
        throw new NotFoundError('User not found.');
      }

      const question = await tx.question.findUnique({
        where: { id: data.questionId },
        select: {
          id: true
        }
      });

      if (!question) {
        throw new NotFoundError('Question not found.');
      }

      if (data.examId) {
        const exam = await tx.exam.findUnique({
          where: { id: data.examId },
          select: {
            id: true,
            userId: true
          }
        });

        if (!exam || exam.userId !== userId) {
          throw new NotFoundError('Exam not found.');
        }

        const linkedAnswer = await tx.examAnswer.findUnique({
          where: {
            examId_questionId: {
              examId: exam.id,
              questionId: data.questionId
            }
          },
          select: {
            id: true
          }
        });

        if (!linkedAnswer) {
          throw new AppError(
            'This question is not part of the exam you selected.',
            400,
            'BOOKMARK_EXAM_QUESTION_MISMATCH'
          );
        }
      }

      await this.purgeExpiredBookmarksTx(tx, userId, now);

      const existingBookmark = await tx.bookmarkedQuestion.findUnique({
        where: {
          userId_questionId: {
            userId,
            questionId: data.questionId
          }
        },
        include: bookmarkInclude
      });

      if (existingBookmark && !isExpired(existingBookmark.expiresAt, now)) {
        throw new AppError(
          'This question is already saved in your bookmarks.',
          409,
          'BOOKMARK_ALREADY_EXISTS'
        );
      }

      const activeBookmarkCount = await tx.bookmarkedQuestion.count({
        where: this.activeBookmarkWhere(userId)
      });

      const maxBookmarks = user.isPremium
        ? BOOKMARK_LIMITS.PREMIUM_USER_MAX_BOOKMARKS
        : BOOKMARK_LIMITS.FREE_USER_MAX_BOOKMARKS;

      if (activeBookmarkCount >= maxBookmarks) {
        throw new AppError(
          user.isPremium
            ? `You already have ${maxBookmarks} active bookmarks. Remove one to save another question.`
            : `Free accounts can keep up to ${maxBookmarks} active bookmarks. Upgrade to premium for up to ${BOOKMARK_LIMITS.PREMIUM_USER_MAX_BOOKMARKS}.`,
          403,
          'BOOKMARK_LIMIT_REACHED'
        );
      }

      const bookmark = await tx.bookmarkedQuestion.create({
        data: {
          userId,
          questionId: data.questionId,
          examId: data.examId ?? null,
          notes: data.notes ?? null,
          expiresAt: buildExpiryDate(now)
        },
        include: bookmarkInclude
      });

      return serializeBookmark(bookmark);
    });
  }

  async getUserBookmarks(userId: number, query: BookmarkListQuery) {
    const page = query.page ?? BOOKMARK_LIMITS.DEFAULT_PAGE;
    const limit = query.limit ?? BOOKMARK_LIMITS.DEFAULT_PAGE_SIZE;
    const skip = (page - 1) * limit;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isPremium: true
      }
    });

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    const where = this.activeBookmarkWhere(userId, query.subject);

    const [total, bookmarks] = await Promise.all([
      prisma.bookmarkedQuestion.count({ where }),
      prisma.bookmarkedQuestion.findMany({
        where,
        include: bookmarkInclude,
        skip,
        take: limit,
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' }
        ]
      })
    ]);

    const maxBookmarks = user.isPremium
      ? BOOKMARK_LIMITS.PREMIUM_USER_MAX_BOOKMARKS
      : BOOKMARK_LIMITS.FREE_USER_MAX_BOOKMARKS;

    return {
      bookmarks: bookmarks.map(serializeBookmark),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      },
      limits: {
        activeBookmarks: total,
        maxBookmarks,
        remainingBookmarks: Math.max(0, maxBookmarks - total),
        expiryDays: BOOKMARK_LIMITS.EXPIRY_DAYS,
        accessTier: user.isPremium ? 'PREMIUM' : 'FREE'
      }
    };
  }

  async getBookmarkById(userId: number, bookmarkId: number) {
    const bookmark = await prisma.bookmarkedQuestion.findFirst({
      where: {
        id: bookmarkId,
        userId
      },
      include: bookmarkFullInclude
    });

    if (!bookmark) {
      throw new NotFoundError('Bookmark not found.');
    }

    if (isExpired(bookmark.expiresAt)) {
      throw new AppError(
        'This bookmark has expired. Save the question again if you still need it.',
        410,
        'BOOKMARK_EXPIRED'
      );
    }

    return serializeBookmarkFull(bookmark);
  }

  async updateBookmark(userId: number, bookmarkId: number, data: UpdateBookmarkInput) {
    const bookmark = await prisma.bookmarkedQuestion.findFirst({
      where: {
        id: bookmarkId,
        userId
      },
      select: {
        id: true,
        expiresAt: true
      }
    });

    if (!bookmark) {
      throw new NotFoundError('Bookmark not found.');
    }

    if (isExpired(bookmark.expiresAt)) {
      throw new AppError(
        'This bookmark has expired. Save the question again before updating its note.',
        410,
        'BOOKMARK_EXPIRED'
      );
    }

    const updatedBookmark = await prisma.bookmarkedQuestion.update({
      where: { id: bookmarkId },
      data: {
        notes: data.notes ?? null
      },
      include: bookmarkFullInclude
    });

    return serializeBookmarkFull(updatedBookmark);
  }

  async deleteBookmark(userId: number, bookmarkId: number) {
    const deleted = await prisma.bookmarkedQuestion.deleteMany({
      where: {
        id: bookmarkId,
        userId
      }
    });

    if (deleted.count !== 1) {
      throw new NotFoundError('Bookmark not found.');
    }

    return {
      success: true,
      message: 'Bookmark removed successfully.'
    };
  }
}

export const bookmarksService = new BookmarksService();
