-- CreateEnum
CREATE TYPE "AudienceRole" AS ENUM ('ANY', 'STUDENT', 'FACULTY');

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('DIRECT', 'SECTION', 'SUPPORT');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('MEMBER', 'MODERATOR');

-- CreateEnum
CREATE TYPE "DiscussionThreadType" AS ENUM ('QUESTION', 'DISCUSSION');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "CasePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('ACADEMIC', 'COURSE', 'FACULTY', 'REGISTRATION', 'FACILITIES', 'TECHNICAL', 'ADMINISTRATIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('REGISTRATION', 'ACADEMIC', 'FACULTY', 'TECHNICAL', 'ACCOUNT', 'DEPARTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'PRIORITY_CHANGED', 'REOPENED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AudienceType" ADD VALUE 'ALL_USERS';
ALTER TYPE "AudienceType" ADD VALUE 'ALL_STUDENTS';
ALTER TYPE "AudienceType" ADD VALUE 'ALL_FACULTY';
ALTER TYPE "AudienceType" ADD VALUE 'ALL_ADMINS';
ALTER TYPE "AudienceType" ADD VALUE 'USER';
ALTER TYPE "AudienceType" ADD VALUE 'SCHOOL';
ALTER TYPE "AudienceType" ADD VALUE 'DEPARTMENT';
ALTER TYPE "AudienceType" ADD VALUE 'PROGRAM';
ALTER TYPE "AudienceType" ADD VALUE 'SPECIALIZATION';
ALTER TYPE "AudienceType" ADD VALUE 'COURSE';
ALTER TYPE "AudienceType" ADD VALUE 'YEAR_OF_STUDY';

-- AlterTable
ALTER TABLE "announcement_audiences" DROP CONSTRAINT "announcement_audiences_pkey",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD COLUMN     "role_filter" "AudienceRole" NOT NULL DEFAULT 'ANY',
ADD COLUMN     "target_value" SMALLINT,
ALTER COLUMN "target_id" DROP NOT NULL,
ADD CONSTRAINT "announcement_audiences_pkey" PRIMARY KEY ("id");

ALTER TABLE "announcement_audiences" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "announcements" ADD COLUMN     "notified_at" TIMESTAMPTZ(3);
-- Announcements published before Phase 9 were fanned out synchronously.
UPDATE "announcements" SET "notified_at" = "published_at";

-- CreateTable
CREATE TABLE "announcement_reads" (
    "announcement_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("announcement_id","user_id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "type" "ConversationType" NOT NULL,
    "section_id" UUID,
    "direct_key" VARCHAR(80),
    "support_owner_id" UUID,
    "announcement_only" BOOLEAN NOT NULL DEFAULT false,
    "last_message_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ParticipantRole" NOT NULL DEFAULT 'MEMBER',
    "last_read_message_id" UUID,
    "last_read_at" TIMESTAMPTZ(3),
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(3),
    "muted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("body", ''))) STORED,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "message_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("message_id","file_id")
);

-- CreateTable
CREATE TABLE "discussion_threads" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "type" "DiscussionThreadType" NOT NULL DEFAULT 'DISCUSSION',
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "answer_post_id" UUID,
    "reply_count" INTEGER NOT NULL DEFAULT 0,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discussion_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discussion_posts" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discussion_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","category","channel")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" UUID NOT NULL,
    "to_address" VARCHAR(254) NOT NULL,
    "subject" VARCHAR(300) NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(1000),
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL,
    "submitted_by_id" UUID NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "category" "FeedbackCategory" NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "department_id" UUID,
    "course_id" UUID,
    "priority" "CasePriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "FeedbackStatus" NOT NULL DEFAULT 'OPEN',
    "assignee_id" UUID,
    "resolution_note" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_responses" (
    "id" UUID NOT NULL,
    "feedback_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "ticket_number" VARCHAR(20) NOT NULL,
    "owner_id" UUID NOT NULL,
    "department_id" UUID,
    "category" "TicketCategory" NOT NULL,
    "priority" "CasePriority" NOT NULL DEFAULT 'MEDIUM',
    "subject" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "assignee_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_responses" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_events" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "actor_id" UUID,
    "type" "TicketEventType" NOT NULL,
    "from_value" VARCHAR(60),
    "to_value" VARCHAR(60),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_attachments" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "response_id" UUID,
    "file_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcement_reads_user_id_idx" ON "announcement_reads"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_section_id_key" ON "conversations"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_direct_key_key" ON "conversations"("direct_key");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_support_owner_id_key" ON "conversations"("support_owner_id");

-- CreateIndex
CREATE INDEX "conversations_type_last_message_at_idx" ON "conversations"("type", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_left_at_idx" ON "conversation_participants"("user_id", "left_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "messages_search_vector" ON "messages" USING GIN ("search_vector");

-- CreateIndex
CREATE UNIQUE INDEX "message_attachments_file_id_key" ON "message_attachments"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "discussion_threads_answer_post_id_key" ON "discussion_threads"("answer_post_id");

-- CreateIndex
CREATE INDEX "discussion_threads_section_id_last_activity_at_idx" ON "discussion_threads"("section_id", "last_activity_at" DESC);

-- CreateIndex
CREATE INDEX "discussion_posts_thread_id_created_at_idx" ON "discussion_posts"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "email_logs_status_created_at_idx" ON "email_logs"("status", "created_at");

-- CreateIndex
CREATE INDEX "feedback_status_priority_idx" ON "feedback"("status", "priority");

-- CreateIndex
CREATE INDEX "feedback_submitted_by_id_idx" ON "feedback"("submitted_by_id");

-- CreateIndex
CREATE INDEX "feedback_department_id_status_idx" ON "feedback"("department_id", "status");

-- CreateIndex
CREATE INDEX "feedback_responses_feedback_id_created_at_idx" ON "feedback_responses"("feedback_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_ticket_number_key" ON "support_tickets"("ticket_number");

-- CreateIndex
CREATE INDEX "support_tickets_status_assignee_id_idx" ON "support_tickets"("status", "assignee_id");

-- CreateIndex
CREATE INDEX "support_tickets_owner_id_idx" ON "support_tickets"("owner_id");

-- CreateIndex
CREATE INDEX "support_tickets_department_id_status_idx" ON "support_tickets"("department_id", "status");

-- CreateIndex
CREATE INDEX "ticket_responses_ticket_id_created_at_idx" ON "ticket_responses"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "ticket_events_ticket_id_created_at_idx" ON "ticket_events"("ticket_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_attachments_file_id_key" ON "ticket_attachments"("file_id");

-- CreateIndex
CREATE INDEX "ticket_attachments_ticket_id_idx" ON "ticket_attachments"("ticket_id");

-- CreateIndex
CREATE INDEX "announcement_audiences_announcement_id_idx" ON "announcement_audiences"("announcement_id");

-- CreateIndex
CREATE INDEX "announcements_published_at_idx" ON "announcements"("published_at");

-- CreateIndex
CREATE INDEX "announcements_expires_at_idx" ON "announcements"("expires_at");

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_support_owner_id_fkey" FOREIGN KEY ("support_owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussion_threads" ADD CONSTRAINT "discussion_threads_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussion_threads" ADD CONSTRAINT "discussion_threads_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussion_threads" ADD CONSTRAINT "discussion_threads_answer_post_id_fkey" FOREIGN KEY ("answer_post_id") REFERENCES "discussion_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "discussion_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_responses" ADD CONSTRAINT "feedback_responses_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_responses" ADD CONSTRAINT "feedback_responses_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_responses" ADD CONSTRAINT "ticket_responses_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_responses" ADD CONSTRAINT "ticket_responses_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "ticket_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity rules Prisma cannot express (DATABASE.md §3.8)
-- ---------------------------------------------------------------------------

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_type_keys" CHECK (
  (("type" = 'SECTION') = ("section_id" IS NOT NULL)) AND
  (("type" = 'DIRECT') = ("direct_key" IS NOT NULL)) AND
  (("type" = 'SUPPORT') = ("support_owner_id" IS NOT NULL))
);
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_announcement_only_section"
  CHECK (NOT "announcement_only" OR "type" = 'SECTION');

ALTER TABLE "messages" ADD CONSTRAINT "messages_body_length" CHECK (char_length("body") <= 4000);

-- Audience targets: ALL_* have no target, YEAR_OF_STUDY carries a year (and optionally a department),
-- every other type names exactly one entity. Compared as text: the new enum values cannot be used
-- in the transaction that adds them.
ALTER TABLE "announcement_audiences" ADD CONSTRAINT "announcement_audiences_target" CHECK (
  CASE
    WHEN "target_type"::text LIKE 'ALL\_%' THEN "target_id" IS NULL AND "target_value" IS NULL
    WHEN "target_type"::text = 'YEAR_OF_STUDY' THEN "target_value" BETWEEN 1 AND 10
    ELSE "target_id" IS NOT NULL AND "target_value" IS NULL
  END
);

ALTER TABLE "discussion_threads" ADD CONSTRAINT "discussion_threads_reply_count" CHECK ("reply_count" >= 0);

ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_number_format"
  CHECK ("ticket_number" ~ '^TCK-[0-9]{4}-[0-9]{6,}$');
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_resolution" CHECK (
  ("status" IN ('RESOLVED', 'CLOSED')) = ("resolved_at" IS NOT NULL OR "closed_at" IS NOT NULL)
);
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_resolution"
  CHECK ("status" NOT IN ('RESOLVED', 'CLOSED') OR "resolved_at" IS NOT NULL);
