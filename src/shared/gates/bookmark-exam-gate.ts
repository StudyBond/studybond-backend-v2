/**
 * Bookmark Exam Gate — Single source of truth for access control.
 *
 * Evaluates whether a user can start a bookmark exam based on:
 * 1. Premium subscription status
 * 2. Minimum bookmark count threshold
 *
 * Pure function — no DB calls, no side effects.
 * Used by both the API route (server-side enforcement) and
 * the frontend component (UI state rendering).
 */

export const BOOKMARK_EXAM_MIN_QUESTIONS = 20;

export type BookmarkExamGateResult =
  | { status: 'LOCKED_PREMIUM'; bookmarkCount: number }
  | { status: 'LOCKED_INSUFFICIENT'; bookmarkCount: number; required: number }
  | { status: 'UNLOCKED'; bookmarkCount: number };

export function evaluateBookmarkExamGate(
  bookmarkCount: number,
  isPremium: boolean
): BookmarkExamGateResult {
  if (!isPremium) {
    return { status: 'LOCKED_PREMIUM', bookmarkCount };
  }

  if (bookmarkCount < BOOKMARK_EXAM_MIN_QUESTIONS) {
    return {
      status: 'LOCKED_INSUFFICIENT',
      bookmarkCount,
      required: BOOKMARK_EXAM_MIN_QUESTIONS
    };
  }

  return { status: 'UNLOCKED', bookmarkCount };
}
