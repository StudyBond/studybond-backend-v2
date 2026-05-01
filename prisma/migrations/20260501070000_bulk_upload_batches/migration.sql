-- Bulk Upload Batch Tracking
-- Tracks upload history and enables duplicate file detection via SHA-256 hash.

-- CreateEnum
CREATE TYPE "BulkUploadStatus" AS ENUM ('COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "BulkUploadBatch" (
  "id" SERIAL NOT NULL,
  "institutionId" INTEGER NOT NULL,
  "uploadedById" INTEGER NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileHash" TEXT NOT NULL,
  "totalRows" INTEGER NOT NULL,
  "successCount" INTEGER NOT NULL,
  "errorCount" INTEGER NOT NULL,
  "questionIds" INTEGER[],
  "status" "BulkUploadStatus" NOT NULL DEFAULT 'COMPLETED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BulkUploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulkUploadBatch_institutionId_createdAt_idx" ON "BulkUploadBatch"("institutionId", "createdAt");

-- CreateIndex
CREATE INDEX "BulkUploadBatch_fileHash_idx" ON "BulkUploadBatch"("fileHash");

-- CreateIndex
CREATE INDEX "BulkUploadBatch_uploadedById_idx" ON "BulkUploadBatch"("uploadedById");

-- AddForeignKey
ALTER TABLE "BulkUploadBatch" ADD CONSTRAINT "BulkUploadBatch_institutionId_fkey"
  FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkUploadBatch" ADD CONSTRAINT "BulkUploadBatch_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
