import { AppError } from '../../shared/errors/AppError';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { EXAM_STATUS } from '../exams/exams.constants';
import { COLLAB_SESSION_STATUS, PARTICIPANT_STATE } from './collaboration.constants';

type TxClient = any;

export interface CollaborationCompletionStanding {
  userId: number;
  fullName: string;
  score: number;
  spEarned: number;
  rank: number;
}

export interface CollaborationSubmissionFinalizationResult {
  participantFinishedNow: boolean;
  sessionCompletedNow: boolean;
  standings: CollaborationCompletionStanding[];
}

export async function finalizeCollaborationSubmission(
  tx: TxClient,
  input: {
    sessionId: number;
    userId: number;
    finishedAt: Date;
    score: number | null;
    spEarned: number | null;
  }
): Promise<CollaborationSubmissionFinalizationResult> {
  const session = await tx.collaborationSession.findUnique({
    where: { id: input.sessionId },
    select: {
      id: true,
      status: true
    }
  });

  if (!session) {
    throw new NotFoundError('Collaboration session not found.');
  }

  if (session.status === COLLAB_SESSION_STATUS.CANCELLED) {
    throw new AppError('This collaboration session is no longer active.', 409, 'COLLAB_SESSION_NOT_ACTIVE');
  }

  if (
    session.status !== COLLAB_SESSION_STATUS.IN_PROGRESS &&
    session.status !== COLLAB_SESSION_STATUS.COMPLETED
  ) {
    throw new AppError('This collaboration session is not in progress.', 409, 'COLLAB_SESSION_NOT_ACTIVE');
  }

  const participant = await tx.sessionParticipant.findUnique({
    where: {
      userId_sessionId: {
        userId: input.userId,
        sessionId: input.sessionId
      }
    },
    select: {
      participantState: true
    }
  });

  if (!participant) {
    throw new NotFoundError('You are not part of this collaboration session.');
  }

  if (participant.participantState === PARTICIPANT_STATE.FINISHED) {
    return {
      participantFinishedNow: false,
      sessionCompletedNow: false,
      standings: []
    };
  }

  await tx.sessionParticipant.update({
    where: {
      userId_sessionId: {
        userId: input.userId,
        sessionId: input.sessionId
      }
    },
    data: {
      participantState: PARTICIPANT_STATE.FINISHED as any,
      finishedAt: input.finishedAt,
      score: input.score ?? 0,
      spEarned: input.spEarned ?? 0
    }
  });

  const participants = await tx.sessionParticipant.findMany({
    where: { sessionId: input.sessionId },
    include: {
      user: {
        select: {
          fullName: true
        }
      }
    },
    orderBy: {
      joinedAt: 'asc'
    }
  });

  const allFinished = participants.every((entry: any) => entry.participantState === PARTICIPANT_STATE.FINISHED);
  if (!allFinished) {
    return {
      participantFinishedNow: true,
      sessionCompletedNow: false,
      standings: []
    };
  }

  const exams = await tx.exam.findMany({
    where: {
      collaborationSessionId: input.sessionId,
      status: EXAM_STATUS.COMPLETED as any
    },
    select: {
      userId: true,
      score: true,
      spEarned: true
    }
  });

  const scoreByUser = new Map<number, { score: number; spEarned: number }>(
    exams.map((exam: any) => [
      exam.userId,
      {
        score: exam.score ?? 0,
        spEarned: exam.spEarned ?? 0
      }
    ])
  );

  const standings = participants
    .map((entry: any) => {
      const score = scoreByUser.get(entry.userId);
      return {
        userId: entry.userId,
        fullName: entry.user.fullName,
        score: score?.score ?? 0,
        spEarned: score?.spEarned ?? 0,
        rank: 0
      };
    })
    .sort((a: CollaborationCompletionStanding, b: CollaborationCompletionStanding) =>
      b.score - a.score || b.spEarned - a.spEarned || a.userId - b.userId
    );

  let currentRank = 0;
  let previous: { score: number; spEarned: number } | null = null;
  for (let index = 0; index < standings.length; index += 1) {
    const standing = standings[index];
    if (!previous || standing.score !== previous.score || standing.spEarned !== previous.spEarned) {
      currentRank = index + 1;
    }
    standing.rank = currentRank;
    previous = {
      score: standing.score,
      spEarned: standing.spEarned
    };
  }

  for (const standing of standings) {
    await tx.sessionParticipant.update({
      where: {
        userId_sessionId: {
          userId: standing.userId,
          sessionId: input.sessionId
        }
      },
      data: {
        finalRank: standing.rank,
        score: standing.score,
        spEarned: standing.spEarned
      }
    });
  }

  let sessionCompletedNow = false;
  if (session.status !== COLLAB_SESSION_STATUS.COMPLETED) {
    await tx.collaborationSession.update({
      where: { id: input.sessionId },
      data: {
        status: COLLAB_SESSION_STATUS.COMPLETED as any,
        endedAt: input.finishedAt,
        version: { increment: 1 }
      }
    });
    sessionCompletedNow = true;
  }

  return {
    participantFinishedNow: true,
    sessionCompletedNow,
    standings
  };
}
