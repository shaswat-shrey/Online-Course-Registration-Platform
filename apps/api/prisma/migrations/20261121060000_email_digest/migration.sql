-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_digest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_digest_at" TIMESTAMPTZ(3);

