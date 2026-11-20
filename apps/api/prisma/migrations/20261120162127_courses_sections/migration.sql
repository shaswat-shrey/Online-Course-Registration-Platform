-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CourseMappingType" AS ENUM ('CORE', 'ELECTIVE');

-- CreateEnum
CREATE TYPE "RestrictionMode" AS ENUM ('INCLUDE', 'EXCLUDE');

-- CreateEnum
CREATE TYPE "RestrictionTarget" AS ENUM ('DEPARTMENT', 'PROGRAM', 'SPECIALIZATION', 'YEAR_OF_STUDY');

-- CreateEnum
CREATE TYPE "ClassroomType" AS ENUM ('LECTURE_HALL', 'CLASSROOM', 'LABORATORY', 'SEMINAR_ROOM', 'COMPUTER_LAB', 'AUDITORIUM', 'STUDIO');

-- CreateEnum
CREATE TYPE "SectionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('LECTURE', 'LAB', 'TUTORIAL', 'SEMINAR', 'PRACTICAL');

-- CreateEnum
CREATE TYPE "InstructorRole" AS ENUM ('PRIMARY', 'SECONDARY', 'TA');

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000),
    "department_id" UUID NOT NULL,
    "credits" DECIMAL(4,1) NOT NULL,
    "level" SMALLINT NOT NULL,
    "category" "CourseCategory" NOT NULL,
    "recommended_year" SMALLINT,
    "recommended_session_type" "SessionType",
    "syllabus" TEXT,
    "default_capacity" INTEGER,
    "min_enrollment" INTEGER,
    "coordinator_id" UUID,
    "is_repeatable" BOOLEAN NOT NULL DEFAULT false,
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "search_vector" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce("code", '')), 'A') ||
        setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
        setweight(to_tsvector('english', coalesce("description", '')), 'C')
    ) STORED,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_outcomes" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "description" VARCHAR(1000) NOT NULL,

    CONSTRAINT "course_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_assessment_components" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "weight" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "course_assessment_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prerequisite_groups" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,

    CONSTRAINT "prerequisite_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prerequisite_items" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "required_course_id" UUID NOT NULL,
    "min_grade_letter" VARCHAR(5),

    CONSTRAINT "prerequisite_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_corequisites" (
    "course_id" UUID NOT NULL,
    "corequisite_id" UUID NOT NULL,

    CONSTRAINT "course_corequisites_pkey" PRIMARY KEY ("course_id","corequisite_id")
);

-- CreateTable
CREATE TABLE "course_programs" (
    "course_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "mapping_type" "CourseMappingType" NOT NULL,

    CONSTRAINT "course_programs_pkey" PRIMARY KEY ("course_id","program_id")
);

-- CreateTable
CREATE TABLE "course_specializations" (
    "course_id" UUID NOT NULL,
    "specialization_id" UUID NOT NULL,
    "mapping_type" "CourseMappingType" NOT NULL,

    CONSTRAINT "course_specializations_pkey" PRIMARY KEY ("course_id","specialization_id")
);

-- CreateTable
CREATE TABLE "course_restrictions" (
    "id" UUID NOT NULL,
    "course_id" UUID,
    "section_id" UUID,
    "mode" "RestrictionMode" NOT NULL,
    "target_type" "RestrictionTarget" NOT NULL,
    "target_id" UUID,
    "target_value" SMALLINT,

    CONSTRAINT "course_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_courses" (
    "requirement_group_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,

    CONSTRAINT "requirement_courses_pkey" PRIMARY KEY ("requirement_group_id","course_id")
);

-- CreateTable
CREATE TABLE "classrooms" (
    "id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "building" VARCHAR(100) NOT NULL,
    "room_number" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150),
    "capacity" INTEGER NOT NULL,
    "type" "ClassroomType" NOT NULL,
    "equipment" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_sections" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "section_code" VARCHAR(20) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "enrolled_count" INTEGER NOT NULL DEFAULT 0,
    "waitlist_capacity" INTEGER NOT NULL DEFAULT 0,
    "waitlist_count" INTEGER NOT NULL DEFAULT 0,
    "campus_id" UUID,
    "status" "SectionStatus" NOT NULL DEFAULT 'DRAFT',
    "registration_open" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(2000),
    "published_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "course_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_meetings" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "classroom_id" UUID,
    "day_of_week" SMALLINT NOT NULL,
    "start_minute" SMALLINT NOT NULL,
    "end_minute" SMALLINT NOT NULL,
    "type" "MeetingType" NOT NULL DEFAULT 'LECTURE',

    CONSTRAINT "section_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_instructors" (
    "section_id" UUID NOT NULL,
    "faculty_member_id" UUID NOT NULL,
    "role" "InstructorRole" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "section_instructors_pkey" PRIMARY KEY ("section_id","faculty_member_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "courses_code_key" ON "courses"("code");

-- CreateIndex
CREATE INDEX "courses_department_id_status_idx" ON "courses"("department_id", "status");

-- CreateIndex
CREATE INDEX "courses_search_vector" ON "courses" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "courses_title_trgm" ON "courses" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "courses_code_trgm" ON "courses" USING GIN ("code" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "course_outcomes_course_id_position_key" ON "course_outcomes"("course_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "course_assessment_components_course_id_position_key" ON "course_assessment_components"("course_id", "position");

-- CreateIndex
CREATE INDEX "prerequisite_groups_course_id_idx" ON "prerequisite_groups"("course_id");

-- CreateIndex
CREATE INDEX "prerequisite_items_required_course_id_idx" ON "prerequisite_items"("required_course_id");

-- CreateIndex
CREATE UNIQUE INDEX "prerequisite_items_group_id_required_course_id_key" ON "prerequisite_items"("group_id", "required_course_id");

-- CreateIndex
CREATE INDEX "course_corequisites_corequisite_id_idx" ON "course_corequisites"("corequisite_id");

-- CreateIndex
CREATE INDEX "course_programs_program_id_idx" ON "course_programs"("program_id");

-- CreateIndex
CREATE INDEX "course_specializations_specialization_id_idx" ON "course_specializations"("specialization_id");

-- CreateIndex
CREATE INDEX "course_restrictions_course_id_idx" ON "course_restrictions"("course_id");

-- CreateIndex
CREATE INDEX "course_restrictions_section_id_idx" ON "course_restrictions"("section_id");

-- CreateIndex
CREATE INDEX "requirement_courses_course_id_idx" ON "requirement_courses"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "classrooms_campus_id_building_room_number_key" ON "classrooms"("campus_id", "building", "room_number");

-- CreateIndex
CREATE INDEX "course_sections_session_id_status_idx" ON "course_sections"("session_id", "status");

-- CreateIndex
CREATE INDEX "course_sections_course_id_session_id_idx" ON "course_sections"("course_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_sections_course_id_session_id_section_code_key" ON "course_sections"("course_id", "session_id", "section_code");

-- CreateIndex
CREATE INDEX "section_meetings_section_id_idx" ON "section_meetings"("section_id");

-- CreateIndex
CREATE INDEX "section_meetings_classroom_id_day_of_week_idx" ON "section_meetings"("classroom_id", "day_of_week");

-- CreateIndex
CREATE INDEX "section_instructors_faculty_member_id_idx" ON "section_instructors"("faculty_member_id");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_coordinator_id_fkey" FOREIGN KEY ("coordinator_id") REFERENCES "faculty_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_outcomes" ADD CONSTRAINT "course_outcomes_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_assessment_components" ADD CONSTRAINT "course_assessment_components_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prerequisite_groups" ADD CONSTRAINT "prerequisite_groups_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prerequisite_items" ADD CONSTRAINT "prerequisite_items_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "prerequisite_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prerequisite_items" ADD CONSTRAINT "prerequisite_items_required_course_id_fkey" FOREIGN KEY ("required_course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_corequisites" ADD CONSTRAINT "course_corequisites_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_corequisites" ADD CONSTRAINT "course_corequisites_corequisite_id_fkey" FOREIGN KEY ("corequisite_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_programs" ADD CONSTRAINT "course_programs_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_programs" ADD CONSTRAINT "course_programs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_specializations" ADD CONSTRAINT "course_specializations_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_specializations" ADD CONSTRAINT "course_specializations_specialization_id_fkey" FOREIGN KEY ("specialization_id") REFERENCES "specializations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_restrictions" ADD CONSTRAINT "course_restrictions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_restrictions" ADD CONSTRAINT "course_restrictions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_courses" ADD CONSTRAINT "requirement_courses_requirement_group_id_fkey" FOREIGN KEY ("requirement_group_id") REFERENCES "requirement_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_courses" ADD CONSTRAINT "requirement_courses_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_sections" ADD CONSTRAINT "course_sections_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_sections" ADD CONSTRAINT "course_sections_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_sections" ADD CONSTRAINT "course_sections_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_meetings" ADD CONSTRAINT "section_meetings_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_meetings" ADD CONSTRAINT "section_meetings_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_instructors" ADD CONSTRAINT "section_instructors_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_instructors" ADD CONSTRAINT "section_instructors_faculty_member_id_fkey" FOREIGN KEY ("faculty_member_id") REFERENCES "faculty_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (DATABASE.md §5)
-- ---------------------------------------------------------------------------
ALTER TABLE "courses"
  ADD CONSTRAINT "chk_course_credits" CHECK ("credits" >= 0 AND "credits" <= 40),
  ADD CONSTRAINT "chk_course_level" CHECK ("level" BETWEEN 100 AND 900),
  ADD CONSTRAINT "chk_course_recommended_year" CHECK ("recommended_year" IS NULL OR "recommended_year" BETWEEN 1 AND 10),
  ADD CONSTRAINT "chk_course_enrollment" CHECK (
    ("default_capacity" IS NULL OR "default_capacity" > 0) AND
    ("min_enrollment" IS NULL OR "min_enrollment" >= 0) AND
    ("default_capacity" IS NULL OR "min_enrollment" IS NULL OR "min_enrollment" <= "default_capacity")
  );

ALTER TABLE "course_assessment_components"
  ADD CONSTRAINT "chk_assessment_weight" CHECK ("weight" > 0 AND "weight" <= 100);

ALTER TABLE "course_corequisites"
  ADD CONSTRAINT "chk_coreq_not_self" CHECK ("course_id" <> "corequisite_id");

ALTER TABLE "course_restrictions"
  ADD CONSTRAINT "chk_restriction_owner" CHECK (("course_id" IS NULL) <> ("section_id" IS NULL)),
  ADD CONSTRAINT "chk_restriction_target" CHECK (
    ("target_type" = 'YEAR_OF_STUDY' AND "target_value" BETWEEN 1 AND 10 AND "target_id" IS NULL) OR
    ("target_type" <> 'YEAR_OF_STUDY' AND "target_id" IS NOT NULL AND "target_value" IS NULL)
  );

ALTER TABLE "classrooms"
  ADD CONSTRAINT "chk_classroom_capacity" CHECK ("capacity" > 0);

ALTER TABLE "course_sections"
  ADD CONSTRAINT "chk_section_capacity" CHECK ("capacity" > 0 AND "enrolled_count" >= 0 AND "enrolled_count" <= "capacity"),
  ADD CONSTRAINT "chk_waitlist_count" CHECK ("waitlist_capacity" >= 0 AND "waitlist_count" >= 0);

ALTER TABLE "section_meetings"
  ADD CONSTRAINT "chk_meeting_time" CHECK ("start_minute" >= 0 AND "start_minute" < "end_minute" AND "end_minute" <= 1440),
  ADD CONSTRAINT "chk_meeting_day" CHECK ("day_of_week" BETWEEN 1 AND 7);

-- One primary instructor per section.
CREATE UNIQUE INDEX "uq_primary_instructor" ON "section_instructors" ("section_id") WHERE "role" = 'PRIMARY';
