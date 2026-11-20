-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'REGISTERED', 'WAITLISTED', 'OFFERED', 'DROPPED', 'WITHDRAWN', 'REJECTED', 'CANCELLED', 'EXPIRED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RegistrationRequestType" AS ENUM ('WITHDRAWAL');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('ENROLLMENT', 'TRANSFER', 'EXEMPTION');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('REGISTRATION', 'WAITLIST', 'ANNOUNCEMENT', 'MESSAGE', 'TICKET', 'FEEDBACK', 'SCHEDULE', 'SYSTEM');

-- CreateTable
CREATE TABLE "course_registrations" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "status" "RegistrationStatus" NOT NULL,
    "credits" DECIMAL(4,1) NOT NULL,
    "waitlisted_at" TIMESTAMPTZ(3),
    "offer_expires_at" TIMESTAMPTZ(3),
    "registered_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "idempotency_key" VARCHAR(100),
    "overrides" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "override_reason" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "course_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_events" (
    "id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "from_status" "RegistrationStatus",
    "to_status" "RegistrationStatus" NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "actor_id" UUID,
    "reason" VARCHAR(500),
    "details" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_requests" (
    "id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "type" "RegistrationRequestType" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" VARCHAR(1000),
    "decided_by_id" UUID,
    "decision_note" VARCHAR(500),
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_records" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "session_id" UUID,
    "registration_id" UUID,
    "source" "RecordSource" NOT NULL,
    "course_code_snapshot" VARCHAR(20) NOT NULL,
    "course_title_snapshot" VARCHAR(200) NOT NULL,
    "credits_attempted" DECIMAL(4,1) NOT NULL,
    "credits_earned" DECIMAL(4,1) NOT NULL,
    "grade_letter" VARCHAR(5),
    "grade_points" DECIMAL(4,2),
    "counts_in_gpa" BOOLEAN NOT NULL DEFAULT true,
    "passed" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "academic_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_plans" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "course_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_plan_items" (
    "plan_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "section_id" UUID,
    "position" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "course_plan_items_pkey" PRIMARY KEY ("plan_id","course_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "link" VARCHAR(500),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_registrations_section_id_status_idx" ON "course_registrations"("section_id", "status");

-- CreateIndex
CREATE INDEX "course_registrations_student_id_session_id_status_idx" ON "course_registrations"("student_id", "session_id", "status");

-- CreateIndex
CREATE INDEX "course_registrations_section_id_status_waitlisted_at_id_idx" ON "course_registrations"("section_id", "status", "waitlisted_at", "id");

-- CreateIndex
CREATE INDEX "course_registrations_status_offer_expires_at_idx" ON "course_registrations"("status", "offer_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "course_registrations_student_id_idempotency_key_key" ON "course_registrations"("student_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "registration_events_registration_id_created_at_idx" ON "registration_events"("registration_id", "created_at");

-- CreateIndex
CREATE INDEX "registration_requests_status_created_at_idx" ON "registration_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "registration_requests_registration_id_idx" ON "registration_requests"("registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_records_registration_id_key" ON "academic_records"("registration_id");

-- CreateIndex
CREATE INDEX "academic_records_student_id_course_id_idx" ON "academic_records"("student_id", "course_id");

-- CreateIndex
CREATE INDEX "academic_records_student_id_session_id_idx" ON "academic_records"("student_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_plans_student_id_session_id_name_key" ON "course_plans"("student_id", "session_id", "name");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "course_registrations" ADD CONSTRAINT "course_registrations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_registrations" ADD CONSTRAINT "course_registrations_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_registrations" ADD CONSTRAINT "course_registrations_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_registrations" ADD CONSTRAINT "course_registrations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_events" ADD CONSTRAINT "registration_events_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "course_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_events" ADD CONSTRAINT "registration_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "course_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_records" ADD CONSTRAINT "academic_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_records" ADD CONSTRAINT "academic_records_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_records" ADD CONSTRAINT "academic_records_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_records" ADD CONSTRAINT "academic_records_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "course_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_plans" ADD CONSTRAINT "course_plans_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_plans" ADD CONSTRAINT "course_plans_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_plan_items" ADD CONSTRAINT "course_plan_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "course_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_plan_items" ADD CONSTRAINT "course_plan_items_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_plan_items" ADD CONSTRAINT "course_plan_items_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (DATABASE.md §5, §8)
-- ---------------------------------------------------------------------------

-- One active attempt per student, course and session (BR-002).
CREATE UNIQUE INDEX "uq_active_registration"
  ON "course_registrations" ("student_id", "course_id", "session_id")
  WHERE "status" IN ('PENDING', 'REGISTERED', 'OFFERED', 'WAITLISTED');

ALTER TABLE "course_registrations"
  ADD CONSTRAINT "chk_registration_credits" CHECK ("credits" >= 0),
  ADD CONSTRAINT "chk_waitlisted_at" CHECK ("status" <> 'WAITLISTED' OR "waitlisted_at" IS NOT NULL),
  ADD CONSTRAINT "chk_offer_expiry" CHECK ("status" <> 'OFFERED' OR "offer_expires_at" IS NOT NULL);

-- One pending request of each type per registration.
CREATE UNIQUE INDEX "uq_pending_request"
  ON "registration_requests" ("registration_id", "type") WHERE "status" = 'PENDING';

ALTER TABLE "academic_records"
  ADD CONSTRAINT "chk_record_credits" CHECK ("credits_attempted" >= 0 AND "credits_earned" >= 0 AND "credits_earned" <= "credits_attempted");

-- The denormalised course/session must match the section (DATABASE.md §8).
CREATE OR REPLACE FUNCTION registration_matches_section() RETURNS trigger AS $$
DECLARE
  s RECORD;
BEGIN
  SELECT course_id, session_id INTO s FROM course_sections WHERE id = NEW.section_id;
  IF s.course_id IS DISTINCT FROM NEW.course_id OR s.session_id IS DISTINCT FROM NEW.session_id THEN
    RAISE EXCEPTION 'registration course/session must match its section' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "course_registrations_match_section"
  BEFORE INSERT OR UPDATE OF section_id, course_id, session_id ON "course_registrations"
  FOR EACH ROW EXECUTE FUNCTION registration_matches_section();
