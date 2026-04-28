-- Add streak freezer inventory for milestone rewards and streak recovery.
ALTER TABLE "User"
ADD COLUMN "streakFreezesAvailable" INTEGER NOT NULL DEFAULT 0;
