CREATE OR REPLACE FUNCTION "set_default_ui_institution_scope"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  ui_institution_id INTEGER;
BEGIN
  IF NEW."institutionId" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT "id"
  INTO ui_institution_id
  FROM "Institution"
  WHERE "code" = 'UI'
  LIMIT 1;

  IF ui_institution_id IS NULL THEN
    RAISE EXCEPTION 'Cannot assign default institution scope: Institution code UI does not exist.';
  END IF;

  NEW."institutionId" = ui_institution_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Question_set_default_ui_institution_scope" ON "Question";
CREATE TRIGGER "Question_set_default_ui_institution_scope"
BEFORE INSERT OR UPDATE ON "Question"
FOR EACH ROW
EXECUTE FUNCTION "set_default_ui_institution_scope"();

DROP TRIGGER IF EXISTS "Exam_set_default_ui_institution_scope" ON "Exam";
CREATE TRIGGER "Exam_set_default_ui_institution_scope"
BEFORE INSERT OR UPDATE ON "Exam"
FOR EACH ROW
EXECUTE FUNCTION "set_default_ui_institution_scope"();

DROP TRIGGER IF EXISTS "CollaborationSession_set_default_ui_institution_scope" ON "CollaborationSession";
CREATE TRIGGER "CollaborationSession_set_default_ui_institution_scope"
BEFORE INSERT OR UPDATE ON "CollaborationSession"
FOR EACH ROW
EXECUTE FUNCTION "set_default_ui_institution_scope"();

DROP TRIGGER IF EXISTS "WeeklyLeaderboard_set_default_ui_institution_scope" ON "WeeklyLeaderboard";
CREATE TRIGGER "WeeklyLeaderboard_set_default_ui_institution_scope"
BEFORE INSERT OR UPDATE ON "WeeklyLeaderboard"
FOR EACH ROW
EXECUTE FUNCTION "set_default_ui_institution_scope"();

DROP TRIGGER IF EXISTS "LeaderboardProjectionEvent_set_default_ui_institution_scope" ON "LeaderboardProjectionEvent";
CREATE TRIGGER "LeaderboardProjectionEvent_set_default_ui_institution_scope"
BEFORE INSERT OR UPDATE ON "LeaderboardProjectionEvent"
FOR EACH ROW
EXECUTE FUNCTION "set_default_ui_institution_scope"();

DROP TRIGGER IF EXISTS "LeaderboardIntegritySignal_set_default_ui_institution_scope" ON "LeaderboardIntegritySignal";
CREATE TRIGGER "LeaderboardIntegritySignal_set_default_ui_institution_scope"
BEFORE INSERT OR UPDATE ON "LeaderboardIntegritySignal"
FOR EACH ROW
EXECUTE FUNCTION "set_default_ui_institution_scope"();

DO $$
DECLARE
  ui_institution_id INTEGER;
BEGIN
  SELECT "id"
  INTO ui_institution_id
  FROM "Institution"
  WHERE "code" = 'UI'
  LIMIT 1;

  IF ui_institution_id IS NULL THEN
    RAISE EXCEPTION 'Cannot backfill institution scope: Institution code UI does not exist.';
  END IF;

  UPDATE "Question"
  SET "institutionId" = ui_institution_id
  WHERE "institutionId" IS NULL;

  UPDATE "Exam"
  SET "institutionId" = ui_institution_id
  WHERE "institutionId" IS NULL;

  UPDATE "CollaborationSession"
  SET "institutionId" = ui_institution_id
  WHERE "institutionId" IS NULL;

  UPDATE "WeeklyLeaderboard"
  SET "institutionId" = ui_institution_id
  WHERE "institutionId" IS NULL;

  UPDATE "LeaderboardProjectionEvent"
  SET "institutionId" = ui_institution_id
  WHERE "institutionId" IS NULL;

  UPDATE "LeaderboardIntegritySignal"
  SET "institutionId" = ui_institution_id
  WHERE "institutionId" IS NULL;

  IF EXISTS (SELECT 1 FROM "Question" WHERE "institutionId" IS NULL) THEN
    RAISE EXCEPTION 'Institution backfill failed: Question still contains NULL institutionId values.';
  END IF;

  IF EXISTS (SELECT 1 FROM "Exam" WHERE "institutionId" IS NULL) THEN
    RAISE EXCEPTION 'Institution backfill failed: Exam still contains NULL institutionId values.';
  END IF;

  IF EXISTS (SELECT 1 FROM "CollaborationSession" WHERE "institutionId" IS NULL) THEN
    RAISE EXCEPTION 'Institution backfill failed: CollaborationSession still contains NULL institutionId values.';
  END IF;

  IF EXISTS (SELECT 1 FROM "WeeklyLeaderboard" WHERE "institutionId" IS NULL) THEN
    RAISE EXCEPTION 'Institution backfill failed: WeeklyLeaderboard still contains NULL institutionId values.';
  END IF;

  IF EXISTS (SELECT 1 FROM "LeaderboardProjectionEvent" WHERE "institutionId" IS NULL) THEN
    RAISE EXCEPTION 'Institution backfill failed: LeaderboardProjectionEvent still contains NULL institutionId values.';
  END IF;

  IF EXISTS (SELECT 1 FROM "LeaderboardIntegritySignal" WHERE "institutionId" IS NULL) THEN
    RAISE EXCEPTION 'Institution backfill failed: LeaderboardIntegritySignal still contains NULL institutionId values.';
  END IF;
END $$;
