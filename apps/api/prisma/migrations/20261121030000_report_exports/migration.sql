-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "report_key" VARCHAR(60) NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "params" JSONB NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "row_count" INTEGER,
    "file_id" UUID,
    "error" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "export_jobs_file_id_key" ON "export_jobs"("file_id");

-- CreateIndex
CREATE INDEX "export_jobs_requested_by_id_created_at_idx" ON "export_jobs"("requested_by_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "export_jobs_status_idx" ON "export_jobs"("status");

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_completed"
  CHECK (("status" = 'COMPLETED') = ("file_id" IS NOT NULL AND "completed_at" IS NOT NULL));
