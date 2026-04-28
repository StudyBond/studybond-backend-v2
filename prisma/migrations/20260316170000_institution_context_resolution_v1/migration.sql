ALTER TABLE "User"
  ADD COLUMN "targetInstitutionId" INTEGER;

CREATE INDEX "User_targetInstitutionId_idx" ON "User"("targetInstitutionId");

ALTER TABLE "User"
  ADD CONSTRAINT "User_targetInstitutionId_fkey"
  FOREIGN KEY ("targetInstitutionId") REFERENCES "Institution"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

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
    RAISE EXCEPTION 'Cannot backfill user target institution: Institution code UI does not exist.';
  END IF;

  UPDATE "User"
  SET "targetInstitutionId" = ui_institution_id
  WHERE "targetInstitutionId" IS NULL;
END $$;

CREATE OR REPLACE FUNCTION "set_default_user_target_institution"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  ui_institution_id INTEGER;
BEGIN
  IF NEW."targetInstitutionId" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT "id"
  INTO ui_institution_id
  FROM "Institution"
  WHERE "code" = 'UI'
  LIMIT 1;

  IF ui_institution_id IS NULL THEN
    RAISE EXCEPTION 'Cannot assign default target institution: Institution code UI does not exist.';
  END IF;

  NEW."targetInstitutionId" = ui_institution_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "User_set_default_target_institution" ON "User";
CREATE TRIGGER "User_set_default_target_institution"
BEFORE INSERT ON "User"
FOR EACH ROW
EXECUTE FUNCTION "set_default_user_target_institution"();
