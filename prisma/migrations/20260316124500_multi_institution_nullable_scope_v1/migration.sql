ALTER TABLE "Question"
  ADD COLUMN "institutionId" INTEGER;

ALTER TABLE "Exam"
  ADD COLUMN "institutionId" INTEGER;

ALTER TABLE "WeeklyLeaderboard"
  ADD COLUMN "institutionId" INTEGER;

ALTER TABLE "CollaborationSession"
  ADD COLUMN "institutionId" INTEGER;

ALTER TABLE "LeaderboardProjectionEvent"
  ADD COLUMN "institutionId" INTEGER;

ALTER TABLE "LeaderboardIntegritySignal"
  ADD COLUMN "institutionId" INTEGER;

CREATE INDEX "Question_institutionId_idx" ON "Question"("institutionId");
CREATE INDEX "Question_institutionId_subject_questionPool_idx" ON "Question"("institutionId", "subject", "questionPool");

CREATE INDEX "Exam_institutionId_idx" ON "Exam"("institutionId");
CREATE INDEX "Exam_institutionId_examType_startedAt_idx" ON "Exam"("institutionId", "examType", "startedAt");

CREATE INDEX "WeeklyLeaderboard_institutionId_weekStartDate_idx" ON "WeeklyLeaderboard"("institutionId", "weekStartDate");

CREATE INDEX "CollaborationSession_institutionId_idx" ON "CollaborationSession"("institutionId");
CREATE INDEX "CollaborationSession_institutionId_status_createdAt_idx" ON "CollaborationSession"("institutionId", "status", "createdAt");

CREATE INDEX "LeaderboardProjectionEvent_institutionId_processedAt_createdAt_idx"
  ON "LeaderboardProjectionEvent"("institutionId", "processedAt", "createdAt");

CREATE INDEX "LeaderboardIntegritySignal_institutionId_signalType_createdAt_idx"
  ON "LeaderboardIntegritySignal"("institutionId", "signalType", "createdAt");

ALTER TABLE "Question"
  ADD CONSTRAINT "Question_institutionId_fkey"
  FOREIGN KEY ("institutionId") REFERENCES "Institution"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Exam"
  ADD CONSTRAINT "Exam_institutionId_fkey"
  FOREIGN KEY ("institutionId") REFERENCES "Institution"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WeeklyLeaderboard"
  ADD CONSTRAINT "WeeklyLeaderboard_institutionId_fkey"
  FOREIGN KEY ("institutionId") REFERENCES "Institution"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CollaborationSession"
  ADD CONSTRAINT "CollaborationSession_institutionId_fkey"
  FOREIGN KEY ("institutionId") REFERENCES "Institution"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LeaderboardProjectionEvent"
  ADD CONSTRAINT "LeaderboardProjectionEvent_institutionId_fkey"
  FOREIGN KEY ("institutionId") REFERENCES "Institution"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LeaderboardIntegritySignal"
  ADD CONSTRAINT "LeaderboardIntegritySignal_institutionId_fkey"
  FOREIGN KEY ("institutionId") REFERENCES "Institution"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
