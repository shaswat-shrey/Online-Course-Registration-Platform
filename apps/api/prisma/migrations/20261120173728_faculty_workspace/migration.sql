-- CreateEnum
CREATE TYPE "MaterialKind" AS ENUM ('FILE', 'LINK');

-- CreateEnum
CREATE TYPE "AnnouncementPriority" AS ENUM ('NORMAL', 'IMPORTANT', 'URGENT');

-- CreateEnum
CREATE TYPE "AudienceType" AS ENUM ('SECTION');

-- CreateTable
CREATE TABLE "section_materials" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "folder" VARCHAR(100),
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "kind" "MaterialKind" NOT NULL,
    "file_id" UUID,
    "url" VARCHAR(1000),
    "position" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "section_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "priority" "AnnouncementPriority" NOT NULL DEFAULT 'NORMAL',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_audiences" (
    "announcement_id" UUID NOT NULL,
    "target_type" "AudienceType" NOT NULL,
    "target_id" UUID NOT NULL,

    CONSTRAINT "announcement_audiences_pkey" PRIMARY KEY ("announcement_id","target_type","target_id")
);

-- CreateIndex
CREATE INDEX "section_materials_section_id_folder_position_idx" ON "section_materials"("section_id", "folder", "position");

-- CreateIndex
CREATE INDEX "announcements_author_id_published_at_idx" ON "announcements"("author_id", "published_at");

-- CreateIndex
CREATE INDEX "announcement_audiences_target_type_target_id_idx" ON "announcement_audiences"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "section_materials" ADD CONSTRAINT "section_materials_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_materials" ADD CONSTRAINT "section_materials_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_materials" ADD CONSTRAINT "section_materials_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_audiences" ADD CONSTRAINT "announcement_audiences_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A material is either an uploaded file or a link (FR-FACULTY-007).
ALTER TABLE "section_materials"
  ADD CONSTRAINT "chk_material_source" CHECK (
    ("kind" = 'FILE' AND "file_id" IS NOT NULL AND "url" IS NULL) OR
    ("kind" = 'LINK' AND "url" IS NOT NULL AND "file_id" IS NULL)
  );
ALTER TABLE "announcements"
  ADD CONSTRAINT "chk_announcement_expiry" CHECK ("expires_at" IS NULL OR "expires_at" > "published_at");
