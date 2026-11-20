-- AlterTable
ALTER TABLE "academic_records" ADD COLUMN     "entered_by_id" UUID,
ADD COLUMN     "external_institution" VARCHAR(200),
ADD COLUMN     "note" VARCHAR(500);


-- Transfers and exemptions have no session; enrollment records always do.
ALTER TABLE "academic_records" ADD CONSTRAINT "academic_records_source_session"
  CHECK (("source" = 'ENROLLMENT') = ("session_id" IS NOT NULL));
