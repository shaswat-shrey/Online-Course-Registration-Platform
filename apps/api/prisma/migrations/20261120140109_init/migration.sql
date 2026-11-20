-- Extensions used by later phases (DATABASE.md §5). Trusted extensions: owner can create.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "universities" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "short_name" VARCHAR(50) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "website" VARCHAR(255),
    "contact_email" VARCHAR(255),
    "contact_phone" VARCHAR(50),
    "address" VARCHAR(500),
    "school_label" VARCHAR(30) NOT NULL DEFAULT 'Faculty',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "universities_pkey" PRIMARY KEY ("id")
);
