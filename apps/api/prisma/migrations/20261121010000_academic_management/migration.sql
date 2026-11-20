-- CreateEnum
CREATE TYPE "GpaRepeatPolicy" AS ENUM ('ALL', 'LATEST', 'BEST');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateEnum
CREATE TYPE "AssessmentType" AS ENUM ('ASSIGNMENT', 'QUIZ', 'EXAM', 'PROJECT', 'LAB', 'OTHER');

-- CreateEnum
CREATE TYPE "GradeSubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'POSTED');

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'GRADES';

-- AlterTable
ALTER TABLE "course_sections" ADD COLUMN     "attendance_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "universities" ADD COLUMN     "gpa_repeat_policy" "GpaRepeatPolicy" NOT NULL DEFAULT 'ALL';

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_minute" SMALLINT,
    "topic" VARCHAR(200),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "attendance_session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "note" VARCHAR(300),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "academicSessionId" UUID,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("attendance_session_id","student_id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "type" "AssessmentType" NOT NULL,
    "weight" DECIMAL(5,2) NOT NULL,
    "max_score" DECIMAL(6,2) NOT NULL,
    "due_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "position" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_scores" (
    "assessment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "score" DECIMAL(6,2),
    "excused" BOOLEAN NOT NULL DEFAULT false,
    "feedback" VARCHAR(1000),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "academicSessionId" UUID,

    CONSTRAINT "assessment_scores_pkey" PRIMARY KEY ("assessment_id","student_id")
);

-- CreateTable
CREATE TABLE "final_grade_submissions" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "status" "GradeSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "return_reason" VARCHAR(1000),
    "posted_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "final_grade_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_grade_entries" (
    "registration_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "grade_letter" VARCHAR(5) NOT NULL,
    "percent" DECIMAL(5,2),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "final_grade_entries_pkey" PRIMARY KEY ("registration_id")
);

-- CreateTable
CREATE TABLE "grade_changes" (
    "id" UUID NOT NULL,
    "academic_record_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "from_letter" VARCHAR(5),
    "to_letter" VARCHAR(5) NOT NULL,
    "from_points" DECIMAL(4,2),
    "to_points" DECIMAL(4,2),
    "reason" VARCHAR(1000) NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_sessions_section_id_date_idx" ON "attendance_sessions"("section_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_section_id_date_start_minute_key" ON "attendance_sessions"("section_id", "date", "start_minute");

-- CreateIndex
CREATE INDEX "attendance_records_student_id_idx" ON "attendance_records"("student_id");

-- CreateIndex
CREATE INDEX "assessments_section_id_position_idx" ON "assessments"("section_id", "position");

-- CreateIndex
CREATE INDEX "assessment_scores_student_id_idx" ON "assessment_scores"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "final_grade_submissions_section_id_key" ON "final_grade_submissions"("section_id");

-- CreateIndex
CREATE INDEX "final_grade_submissions_status_idx" ON "final_grade_submissions"("status");

-- CreateIndex
CREATE INDEX "final_grade_entries_submission_id_idx" ON "final_grade_entries"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_changes_academic_record_id_version_key" ON "grade_changes"("academic_record_id", "version");

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_attendance_session_id_fkey" FOREIGN KEY ("attendance_session_id") REFERENCES "attendance_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "academic_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_scores" ADD CONSTRAINT "assessment_scores_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_scores" ADD CONSTRAINT "assessment_scores_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_scores" ADD CONSTRAINT "assessment_scores_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "academic_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_grade_submissions" ADD CONSTRAINT "final_grade_submissions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_grade_submissions" ADD CONSTRAINT "final_grade_submissions_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_grade_submissions" ADD CONSTRAINT "final_grade_submissions_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_grade_entries" ADD CONSTRAINT "final_grade_entries_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "course_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_grade_entries" ADD CONSTRAINT "final_grade_entries_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "final_grade_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_changes" ADD CONSTRAINT "grade_changes_academic_record_id_fkey" FOREIGN KEY ("academic_record_id") REFERENCES "academic_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_changes" ADD CONSTRAINT "grade_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity rules Prisma cannot express (DATABASE.md §3.7)
-- ---------------------------------------------------------------------------

ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_start_minute"
  CHECK ("start_minute" IS NULL OR "start_minute" BETWEEN 0 AND 1439);

ALTER TABLE "assessments" ADD CONSTRAINT "assessments_weight" CHECK ("weight" > 0 AND "weight" <= 100);
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_max_score" CHECK ("max_score" > 0);

ALTER TABLE "assessment_scores" ADD CONSTRAINT "assessment_scores_score"
  CHECK ("score" IS NULL OR "score" >= 0);
ALTER TABLE "assessment_scores" ADD CONSTRAINT "assessment_scores_excused"
  CHECK (NOT "excused" OR "score" IS NULL);

ALTER TABLE "final_grade_entries" ADD CONSTRAINT "final_grade_entries_percent"
  CHECK ("percent" IS NULL OR "percent" BETWEEN 0 AND 100);

ALTER TABLE "final_grade_submissions" ADD CONSTRAINT "final_grade_submissions_posted"
  CHECK (("status" = 'POSTED') = ("posted_at" IS NOT NULL));

ALTER TABLE "grade_changes" ADD CONSTRAINT "grade_changes_version" CHECK ("version" >= 2);
