-- AlterEnum
ALTER TYPE "LoginOutcome" ADD VALUE 'MFA_FAILED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_last_step" INTEGER,
ADD COLUMN     "mfa_pending_secret_enc" VARCHAR(200),
ADD COLUMN     "mfa_secret_enc" VARCHAR(200);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" BYTEA NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mfa_recovery_codes_user_id_code_hash_key" ON "mfa_recovery_codes"("user_id", "code_hash");

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "users" ADD CONSTRAINT "users_mfa_secret" CHECK (NOT "mfa_enabled" OR "mfa_secret_enc" IS NOT NULL);
