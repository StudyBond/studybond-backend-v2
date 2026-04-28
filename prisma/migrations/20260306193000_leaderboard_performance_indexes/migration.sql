CREATE INDEX IF NOT EXISTS "User_weeklySp_totalSp_id_idx"
ON "User" ("weeklySp" DESC, "totalSp" DESC, "id" ASC);

CREATE INDEX IF NOT EXISTS "User_totalSp_weeklySp_id_idx"
ON "User" ("totalSp" DESC, "weeklySp" DESC, "id" ASC);
