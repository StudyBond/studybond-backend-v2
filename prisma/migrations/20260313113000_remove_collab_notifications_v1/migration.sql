DROP TABLE IF EXISTS "CollaborationNotification";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'NotificationType'
  ) THEN
    DROP TYPE "NotificationType";
  END IF;
END $$;
