-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DegreeLevel" AS ENUM ('DIPLOMA', 'UNDERGRADUATE', 'POSTGRADUATE', 'DOCTORAL');

-- CreateEnum
CREATE TYPE "CourseCategory" AS ENUM ('CORE', 'ELECTIVE', 'GENERAL_EDUCATION', 'LABORATORY', 'SEMINAR', 'RESEARCH', 'PROJECT', 'INTERNSHIP', 'PRACTICAL');

-- CreateEnum
CREATE TYPE "RequirementKind" AS ENUM ('ALL_OF', 'CREDITS_FROM_LIST', 'CREDITS_FROM_CATEGORY', 'CREDITS_ANY');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('FALL', 'SPRING', 'SUMMER', 'WINTER', 'TRIMESTER_1', 'TRIMESTER_2', 'TRIMESTER_3', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ApprovalMode" AS ENUM ('NONE', 'ALL', 'CROSS_DEPARTMENT', 'LATE_ONLY');

-- CreateEnum
CREATE TYPE "WaitlistPromotionMode" AS ENUM ('AUTO_ENROLL', 'OFFER');

-- CreateTable
CREATE TABLE "campuses" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "address" VARCHAR(500),
    "city" VARCHAR(100),
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schools" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(2000),
    "campus_id" UUID,
    "contact_email" VARCHAR(255),
    "contact_phone" VARCHAR(50),
    "website" VARCHAR(255),
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(2000),
    "school_id" UUID NOT NULL,
    "campus_id" UUID,
    "contact_email" VARCHAR(255),
    "contact_phone" VARCHAR(50),
    "office_location" VARCHAR(200),
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "degrees" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "level" "DegreeLevel" NOT NULL,
    "description" VARCHAR(2000),
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "degrees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "degree_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "duration_years" DECIMAL(3,1) NOT NULL,
    "session_count" SMALLINT NOT NULL,
    "total_credits" DECIMAL(5,1) NOT NULL,
    "min_core_credits" DECIMAL(5,1),
    "min_elective_credits" DECIMAL(5,1),
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specializations" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "additional_credits" DECIMAL(5,1),
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "specializations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_groups" (
    "id" UUID NOT NULL,
    "program_id" UUID,
    "specialization_id" UUID,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(1000),
    "kind" "RequirementKind" NOT NULL,
    "min_credits" DECIMAL(5,1),
    "category" "CourseCategory",
    "position" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "requirement_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_years" (
    "id" UUID NOT NULL,
    "label" VARCHAR(20) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_sessions" (
    "id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "SessionType" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'PLANNED',
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "grading_scale_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "academic_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_policies" (
    "session_id" UUID NOT NULL,
    "min_credits" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "max_credits" DECIMAL(4,1) NOT NULL,
    "max_credits_with_override" DECIMAL(4,1),
    "approval_mode" "ApprovalMode" NOT NULL DEFAULT 'NONE',
    "waitlist_enabled" BOOLEAN NOT NULL DEFAULT true,
    "waitlist_max_per_section" INTEGER,
    "promotion_mode" "WaitlistPromotionMode" NOT NULL DEFAULT 'AUTO_ENROLL',
    "offer_window_hours" INTEGER NOT NULL DEFAULT 24,
    "count_waitlist_in_credits" BOOLEAN NOT NULL DEFAULT false,
    "allow_in_progress_prereqs" BOOLEAN NOT NULL DEFAULT true,
    "withdrawal_requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_policies_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "registration_periods" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "opens_at" TIMESTAMPTZ(3) NOT NULL,
    "closes_at" TIMESTAMPTZ(3) NOT NULL,
    "late_closes_at" TIMESTAMPTZ(3),
    "add_drop_deadline" TIMESTAMPTZ(3) NOT NULL,
    "withdrawal_deadline" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "registration_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "priority_windows" (
    "id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "opens_at" TIMESTAMPTZ(3) NOT NULL,
    "program_id" UUID,
    "year_of_study" SMALLINT,
    "cohort" VARCHAR(50),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "priority_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grading_scales" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(1000),
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "grading_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_scale_entries" (
    "id" UUID NOT NULL,
    "scale_id" UUID NOT NULL,
    "letter" VARCHAR(5) NOT NULL,
    "min_percent" DECIMAL(5,2) NOT NULL,
    "grade_points" DECIMAL(4,2),
    "is_passing" BOOLEAN NOT NULL,
    "counts_in_gpa" BOOLEAN NOT NULL DEFAULT true,
    "position" SMALLINT NOT NULL,

    CONSTRAINT "grade_scale_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campuses_code_key" ON "campuses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "schools_code_key" ON "schools"("code");

-- CreateIndex
CREATE INDEX "schools_status_idx" ON "schools"("status");

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE INDEX "departments_school_id_status_idx" ON "departments"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "degrees_code_key" ON "degrees"("code");

-- CreateIndex
CREATE UNIQUE INDEX "programs_code_key" ON "programs"("code");

-- CreateIndex
CREATE INDEX "programs_department_id_status_idx" ON "programs"("department_id", "status");

-- CreateIndex
CREATE INDEX "programs_degree_id_idx" ON "programs"("degree_id");

-- CreateIndex
CREATE INDEX "specializations_program_id_status_idx" ON "specializations"("program_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "specializations_program_id_code_key" ON "specializations"("program_id", "code");

-- CreateIndex
CREATE INDEX "requirement_groups_program_id_idx" ON "requirement_groups"("program_id");

-- CreateIndex
CREATE INDEX "requirement_groups_specialization_id_idx" ON "requirement_groups"("specialization_id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_label_key" ON "academic_years"("label");

-- CreateIndex
CREATE UNIQUE INDEX "academic_sessions_code_key" ON "academic_sessions"("code");

-- CreateIndex
CREATE INDEX "academic_sessions_academic_year_id_idx" ON "academic_sessions"("academic_year_id");

-- CreateIndex
CREATE INDEX "academic_sessions_status_idx" ON "academic_sessions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "registration_periods_session_id_key" ON "registration_periods"("session_id");

-- CreateIndex
CREATE INDEX "priority_windows_period_id_idx" ON "priority_windows"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "grading_scales_name_key" ON "grading_scales"("name");

-- CreateIndex
CREATE UNIQUE INDEX "grade_scale_entries_scale_id_letter_key" ON "grade_scale_entries"("scale_id", "letter");

-- AddForeignKey
ALTER TABLE "schools" ADD CONSTRAINT "schools_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_degree_id_fkey" FOREIGN KEY ("degree_id") REFERENCES "degrees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specializations" ADD CONSTRAINT "specializations_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_groups" ADD CONSTRAINT "requirement_groups_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_groups" ADD CONSTRAINT "requirement_groups_specialization_id_fkey" FOREIGN KEY ("specialization_id") REFERENCES "specializations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_sessions" ADD CONSTRAINT "academic_sessions_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_sessions" ADD CONSTRAINT "academic_sessions_grading_scale_id_fkey" FOREIGN KEY ("grading_scale_id") REFERENCES "grading_scales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_policies" ADD CONSTRAINT "session_policies_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_periods" ADD CONSTRAINT "registration_periods_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priority_windows" ADD CONSTRAINT "priority_windows_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "registration_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priority_windows" ADD CONSTRAINT "priority_windows_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_scale_entries" ADD CONSTRAINT "grade_scale_entries_scale_id_fkey" FOREIGN KEY ("scale_id") REFERENCES "grading_scales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (DATABASE.md §3.3–3.4)
-- ---------------------------------------------------------------------------
ALTER TABLE "programs"
  ADD CONSTRAINT "programs_duration_check" CHECK ("duration_years" > 0 AND "duration_years" <= 10),
  ADD CONSTRAINT "programs_session_count_check" CHECK ("session_count" BETWEEN 1 AND 30),
  ADD CONSTRAINT "programs_total_credits_check" CHECK ("total_credits" > 0 AND "total_credits" <= 1000),
  ADD CONSTRAINT "programs_min_credits_check" CHECK (
    COALESCE("min_core_credits", 0) >= 0 AND COALESCE("min_elective_credits", 0) >= 0
    AND COALESCE("min_core_credits", 0) + COALESCE("min_elective_credits", 0) <= "total_credits");

ALTER TABLE "specializations"
  ADD CONSTRAINT "specializations_additional_credits_check" CHECK ("additional_credits" IS NULL OR "additional_credits" >= 0);

-- A requirement group belongs to exactly one program or one specialization.
ALTER TABLE "requirement_groups"
  ADD CONSTRAINT "requirement_groups_owner_check" CHECK (("program_id" IS NULL) <> ("specialization_id" IS NULL)),
  ADD CONSTRAINT "requirement_groups_credits_check" CHECK ("min_credits" IS NULL OR "min_credits" > 0),
  ADD CONSTRAINT "requirement_groups_category_check" CHECK (("kind" = 'CREDITS_FROM_CATEGORY') = ("category" IS NOT NULL));

ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_dates_check" CHECK ("start_date" < "end_date");
ALTER TABLE "academic_sessions" ADD CONSTRAINT "academic_sessions_dates_check" CHECK ("start_date" < "end_date");
-- At most one current session per session type.
CREATE UNIQUE INDEX "academic_sessions_current_per_type" ON "academic_sessions" ("type") WHERE "is_current";

ALTER TABLE "session_policies"
  ADD CONSTRAINT "session_policies_credits_check" CHECK (
    "min_credits" >= 0 AND "max_credits" > 0 AND "min_credits" <= "max_credits"
    AND ("max_credits_with_override" IS NULL OR "max_credits_with_override" >= "max_credits")),
  ADD CONSTRAINT "session_policies_offer_window_check" CHECK ("offer_window_hours" BETWEEN 1 AND 336),
  ADD CONSTRAINT "session_policies_waitlist_max_check" CHECK ("waitlist_max_per_section" IS NULL OR "waitlist_max_per_section" >= 0);

ALTER TABLE "registration_periods"
  ADD CONSTRAINT "registration_periods_order_check" CHECK (
    "opens_at" < "closes_at"
    AND ("late_closes_at" IS NULL OR "late_closes_at" > "closes_at")
    AND "add_drop_deadline" >= "closes_at"
    AND "withdrawal_deadline" >= "add_drop_deadline");

ALTER TABLE "priority_windows"
  ADD CONSTRAINT "priority_windows_criteria_check" CHECK (
    "program_id" IS NOT NULL OR "year_of_study" IS NOT NULL OR "cohort" IS NOT NULL),
  ADD CONSTRAINT "priority_windows_year_check" CHECK ("year_of_study" IS NULL OR "year_of_study" BETWEEN 1 AND 10);

ALTER TABLE "grade_scale_entries"
  ADD CONSTRAINT "grade_scale_entries_percent_check" CHECK ("min_percent" >= 0 AND "min_percent" <= 100),
  ADD CONSTRAINT "grade_scale_entries_points_check" CHECK ("grade_points" IS NULL OR ("grade_points" >= 0 AND "grade_points" <= 10));

-- Case-insensitive search on names and codes.
CREATE INDEX "schools_name_trgm" ON "schools" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "departments_name_trgm" ON "departments" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "programs_name_trgm" ON "programs" USING GIN ("name" gin_trgm_ops);
