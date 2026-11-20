-- CreateEnum
CREATE TYPE "RoleScopeMode" AS ENUM ('ORGANIZATIONAL', 'RELATIONSHIP');

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "scope_mode" "RoleScopeMode" NOT NULL DEFAULT 'ORGANIZATIONAL';
