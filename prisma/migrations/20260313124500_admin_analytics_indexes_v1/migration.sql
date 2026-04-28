CREATE INDEX IF NOT EXISTS "User_createdAt_idx"
ON "User"("createdAt");

CREATE INDEX IF NOT EXISTS "QuestionReport_status_createdAt_idx"
ON "QuestionReport"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "Exam_status_startedAt_idx"
ON "Exam"("status", "startedAt");

CREATE INDEX IF NOT EXISTS "Exam_status_completedAt_idx"
ON "Exam"("status", "completedAt");

CREATE INDEX IF NOT EXISTS "AdminStepUpChallenge_verifiedAt_otpExpiresAt_idx"
ON "AdminStepUpChallenge"("verifiedAt", "otpExpiresAt");

CREATE INDEX IF NOT EXISTS "SubscriptionPayment_status_paidAt_idx"
ON "SubscriptionPayment"("status", "paidAt");

CREATE INDEX IF NOT EXISTS "PremiumEntitlement_status_createdAt_idx"
ON "PremiumEntitlement"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "EmailLog_status_sentAt_idx"
ON "EmailLog"("status", "sentAt");
