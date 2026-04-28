export type SessionLifecycleStatus = 'WAITING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type ParticipantLifecycleState = 'JOINED' | 'READY' | 'DISCONNECTED' | 'FINISHED';
export type CollaborationSessionType = 'ONE_V_ONE_DUEL';
export type CollaborationQuestionSource = 'REAL_PAST_QUESTION' | 'PRACTICE' | 'MIXED';

export interface CreateSessionInput {
  sessionType: CollaborationSessionType;
  institutionCode?: string;
  subjects: string[];
  questionSource?: CollaborationQuestionSource;
  maxParticipants?: number;
  customName?: string;
}

export interface JoinSessionInput {
  code: string;
}

export interface IdempotentContext {
  userId: number;
  routeKey: string;
  idempotencyKey: string;
  payload: unknown;
}

export interface ParticipantView {
  userId: number;
  fullName: string;
  participantState: ParticipantLifecycleState;
  joinedAt: string;
  finishedAt: string | null;
  score: number | null;
  spEarned: number | null;
  finalRank: number | null;
}

export interface SessionView {
  id: number;
  code: string;
  sessionType: CollaborationSessionType;
  status: SessionLifecycleStatus;
  sessionNumber: number;
  displayNameLong: string;
  displayNameShort: string;
  customName: string | null;
  effectiveDisplayName: string;
  questionSource: CollaborationQuestionSource;
  subjects: string[];
  totalQuestions: number;
  maxParticipants: number;
  hostUserId: number;
  startedAt: string | null;
  endedAt: string | null;
  participants: ParticipantView[];
}

export interface SessionSnapshotResponse {
  session: SessionView;
  myExamId?: number | null;
}

export interface StartSessionResponse extends SessionSnapshotResponse {
  questions: Array<{
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
  }>;
  examAssignments: Array<{ userId: number; examId: number }>;
  timeAllowedSeconds: number;
  startedAt: string;
  expiresAt: string;
}

export type ClientSocketEventType =
  | 'ready'
  | 'heartbeat'
  | 'progress_update'
  | 'time_alert'
  | 'emoji_reaction'
  | 'finished';

export interface ClientSocketEvent {
  type: ClientSocketEventType;
  eventId?: string;
  payload?: Record<string, unknown>;
}

export interface SocketIdentity {
  sessionId: number;
  userId: number;
  connectionId: string;
}

export interface UpdateSessionNameInput {
  customName: string | null;
}
