-- Collaboration v1 hardening
-- Adds strict enums, participant state, optimistic versioning, and scale indexes.

-- 1) Enums
CREATE TYPE "CollaborationSessionType" AS ENUM ('ONE_V_ONE_DUEL', 'GROUP_COLLAB');
CREATE TYPE "CollaborationQuestionSource" AS ENUM ('REAL_PAST_QUESTION', 'PRACTICE');
CREATE TYPE "ParticipantState" AS ENUM ('JOINED', 'READY', 'DISCONNECTED', 'FINISHED');

-- 2) CollaborationSession columns and enum conversion
ALTER TABLE "CollaborationSession"
  ADD COLUMN "sessionType_new" "CollaborationSessionType",
  ADD COLUMN "questionSource_new" "CollaborationQuestionSource",
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

UPDATE "CollaborationSession"
SET
  "sessionType_new" = CASE
    WHEN "sessionType" = 'GROUP_COLLAB' THEN 'GROUP_COLLAB'::"CollaborationSessionType"
    ELSE 'ONE_V_ONE_DUEL'::"CollaborationSessionType"
  END,
  "questionSource_new" = CASE
    WHEN "questionSource" = 'practice' THEN 'PRACTICE'::"CollaborationQuestionSource"
    ELSE 'REAL_PAST_QUESTION'::"CollaborationQuestionSource"
  END;

ALTER TABLE "CollaborationSession"
  ALTER COLUMN "sessionType_new" SET NOT NULL,
  ALTER COLUMN "questionSource_new" SET NOT NULL;

ALTER TABLE "CollaborationSession"
  DROP COLUMN "sessionType",
  DROP COLUMN "questionSource";

ALTER TABLE "CollaborationSession"
  RENAME COLUMN "sessionType_new" TO "sessionType";

ALTER TABLE "CollaborationSession"
  RENAME COLUMN "questionSource_new" TO "questionSource";

-- 3) SessionParticipant columns + unique/index strategy
ALTER TABLE "SessionParticipant"
  ADD COLUMN "participantState" "ParticipantState" NOT NULL DEFAULT 'JOINED',
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "SessionParticipant_sessionId_userId_key";
CREATE UNIQUE INDEX "SessionParticipant_userId_sessionId_key" ON "SessionParticipant"("userId", "sessionId");

CREATE INDEX "CollaborationSession_status_createdAt_idx"
  ON "CollaborationSession"("status", "createdAt");

CREATE INDEX "SessionParticipant_userId_sessionId_idx"
  ON "SessionParticipant"("userId", "sessionId");

CREATE INDEX "SessionParticipant_sessionId_participantState_idx"
  ON "SessionParticipant"("sessionId", "participantState");
