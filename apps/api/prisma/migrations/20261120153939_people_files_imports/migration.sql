-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN', 'DISMISSED');

-- CreateEnum
CREATE TYPE "FacultyDesignation" AS ENUM ('PROFESSOR', 'ASSOCIATE_PROFESSOR', 'ASSISTANT_PROFESSOR', 'LECTURER', 'SENIOR_LECTURER', 'ADJUNCT', 'VISITING', 'EMERITUS');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "HoldType" AS ENUM ('FINANCIAL', 'ACADEMIC', 'DISCIPLINARY', 'ADMINISTRATIVE', 'DOCUMENTATION');

-- CreateEnum
CREATE TYPE "FileContext" AS ENUM ('AVATAR', 'MATERIAL', 'SYLLABUS', 'MESSAGE', 'TICKET', 'ANNOUNCEMENT', 'DOCUMENT', 'EXPORT', 'IMPORT');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PENDING', 'READY', 'REJECTED');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('STUDENTS', 'FACULTY');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEW', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'INVALID', 'CREATED', 'FAILED');

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "head_id" UUID;

-- AlterTable
ALTER TABLE "schools" ADD COLUMN     "dean_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_file_id" UUID;

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "student_number" VARCHAR(30) NOT NULL,
    "program_id" UUID NOT NULL,
    "specialization_id" UUID,
    "admission_session_id" UUID,
    "admission_date" DATE,
    "expected_graduation_year" SMALLINT,
    "year_of_study" SMALLINT NOT NULL DEFAULT 1,
    "cohort" VARCHAR(50),
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "phone" VARCHAR(50),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_contacts" (
    "student_id" UUID NOT NULL,
    "personal_email" VARCHAR(255),
    "date_of_birth" DATE,
    "address_line" VARCHAR(300),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "postal_code" VARCHAR(20),
    "country" VARCHAR(100),
    "emergency_contact_name" VARCHAR(150),
    "emergency_contact_phone" VARCHAR(50),
    "emergency_contact_relation" VARCHAR(50),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "student_contacts_pkey" PRIMARY KEY ("student_id")
);

-- CreateTable
CREATE TABLE "student_program_history" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "from_program_id" UUID,
    "to_program_id" UUID NOT NULL,
    "from_specialization_id" UUID,
    "to_specialization_id" UUID,
    "effective_session_id" UUID,
    "reason" VARCHAR(500) NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_program_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_holds" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "type" "HoldType" NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "placed_by_id" UUID NOT NULL,
    "placed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(3),
    "released_by_id" UUID,
    "release_note" VARCHAR(500),

    CONSTRAINT "registration_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_members" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "employee_number" VARCHAR(30) NOT NULL,
    "department_id" UUID NOT NULL,
    "designation" "FacultyDesignation" NOT NULL,
    "employment_status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "qualifications" VARCHAR(1000),
    "specialization" VARCHAR(200),
    "research_interests" VARCHAR(1000),
    "office_location" VARCHAR(200),
    "office_hours" VARCHAR(300),
    "phone" VARCHAR(50),
    "max_load_credits" DECIMAL(4,1),
    "joined_on" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "faculty_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_secondary_departments" (
    "faculty_member_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,

    CONSTRAINT "faculty_secondary_departments_pkey" PRIMARY KEY ("faculty_member_id","department_id")
);

-- CreateTable
CREATE TABLE "admin_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "employee_number" VARCHAR(30),
    "job_title" VARCHAR(150),
    "office_department_id" UUID,
    "phone" VARCHAR(50),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "id_sequences" (
    "key" VARCHAR(60) NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "id_sequences_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "context" "FileContext" NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "file_name" VARCHAR(255) NOT NULL,
    "send_invites" BOOLEAN NOT NULL DEFAULT true,
    "total_rows" INTEGER NOT NULL,
    "valid_rows" INTEGER NOT NULL,
    "created_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "error_message" VARCHAR(500),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job_rows" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "status" "ImportRowStatus" NOT NULL,
    "errors" JSONB,
    "user_id" UUID,

    CONSTRAINT "import_job_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "students_user_id_key" ON "students"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_student_number_key" ON "students"("student_number");

-- CreateIndex
CREATE INDEX "students_program_id_status_idx" ON "students"("program_id", "status");

-- CreateIndex
CREATE INDEX "students_status_idx" ON "students"("status");

-- CreateIndex
CREATE INDEX "student_program_history_student_id_created_at_idx" ON "student_program_history"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "registration_holds_student_id_released_at_idx" ON "registration_holds"("student_id", "released_at");

-- CreateIndex
CREATE UNIQUE INDEX "faculty_members_user_id_key" ON "faculty_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "faculty_members_employee_number_key" ON "faculty_members"("employee_number");

-- CreateIndex
CREATE INDEX "faculty_members_department_id_employment_status_idx" ON "faculty_members"("department_id", "employment_status");

-- CreateIndex
CREATE INDEX "faculty_secondary_departments_department_id_idx" ON "faculty_secondary_departments"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_profiles_user_id_key" ON "admin_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_profiles_employee_number_key" ON "admin_profiles"("employee_number");

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_storage_key_key" ON "stored_files"("storage_key");

-- CreateIndex
CREATE INDEX "stored_files_owner_id_context_idx" ON "stored_files"("owner_id", "context");

-- CreateIndex
CREATE INDEX "stored_files_status_created_at_idx" ON "stored_files"("status", "created_at");

-- CreateIndex
CREATE INDEX "import_jobs_created_by_id_created_at_idx" ON "import_jobs"("created_by_id", "created_at");

-- CreateIndex
CREATE INDEX "import_job_rows_job_id_status_idx" ON "import_job_rows"("job_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "import_job_rows_job_id_row_number_key" ON "import_job_rows"("job_id", "row_number");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_file_id_fkey" FOREIGN KEY ("avatar_file_id") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schools" ADD CONSTRAINT "schools_dean_id_fkey" FOREIGN KEY ("dean_id") REFERENCES "faculty_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_id_fkey" FOREIGN KEY ("head_id") REFERENCES "faculty_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_specialization_id_fkey" FOREIGN KEY ("specialization_id") REFERENCES "specializations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_admission_session_id_fkey" FOREIGN KEY ("admission_session_id") REFERENCES "academic_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_contacts" ADD CONSTRAINT "student_contacts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_program_history" ADD CONSTRAINT "student_program_history_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_program_history" ADD CONSTRAINT "student_program_history_from_program_id_fkey" FOREIGN KEY ("from_program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_program_history" ADD CONSTRAINT "student_program_history_to_program_id_fkey" FOREIGN KEY ("to_program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_program_history" ADD CONSTRAINT "student_program_history_effective_session_id_fkey" FOREIGN KEY ("effective_session_id") REFERENCES "academic_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_program_history" ADD CONSTRAINT "student_program_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_holds" ADD CONSTRAINT "registration_holds_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_holds" ADD CONSTRAINT "registration_holds_placed_by_id_fkey" FOREIGN KEY ("placed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_holds" ADD CONSTRAINT "registration_holds_released_by_id_fkey" FOREIGN KEY ("released_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_members" ADD CONSTRAINT "faculty_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_members" ADD CONSTRAINT "faculty_members_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_secondary_departments" ADD CONSTRAINT "faculty_secondary_departments_faculty_member_id_fkey" FOREIGN KEY ("faculty_member_id") REFERENCES "faculty_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_secondary_departments" ADD CONSTRAINT "faculty_secondary_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_office_department_id_fkey" FOREIGN KEY ("office_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (DATABASE.md §3.2, §8)
-- ---------------------------------------------------------------------------
ALTER TABLE "students"
  ADD CONSTRAINT "students_year_of_study_check" CHECK ("year_of_study" BETWEEN 1 AND 10),
  ADD CONSTRAINT "students_graduation_year_check" CHECK ("expected_graduation_year" IS NULL OR "expected_graduation_year" BETWEEN 1950 AND 2200);

-- A student's specialization must belong to the student's program.
CREATE FUNCTION "students_check_specialization"() RETURNS trigger AS $$
BEGIN
  IF NEW."specialization_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "specializations" s WHERE s."id" = NEW."specialization_id" AND s."program_id" = NEW."program_id"
  ) THEN
    RAISE EXCEPTION 'specialization % does not belong to program %', NEW."specialization_id", NEW."program_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "students_specialization_belongs_to_program"
  BEFORE INSERT OR UPDATE OF "program_id", "specialization_id" ON "students"
  FOR EACH ROW EXECUTE FUNCTION "students_check_specialization"();

ALTER TABLE "faculty_members"
  ADD CONSTRAINT "faculty_members_max_load_check" CHECK ("max_load_credits" IS NULL OR ("max_load_credits" >= 0 AND "max_load_credits" <= 60));

ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_size_check" CHECK ("size_bytes" >= 0);

-- Active holds per student (the registration engine checks these on every attempt).
CREATE INDEX "registration_holds_active_idx" ON "registration_holds" ("student_id") WHERE "released_at" IS NULL;
