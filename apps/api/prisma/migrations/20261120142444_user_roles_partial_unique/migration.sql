-- Replace the NULLS NOT DISTINCT unique index with two partial unique indexes.
-- Same guarantee (one assignment per user/role/scope), but Prisma's drift
-- detection ignores partial indexes, whereas it tried to drop the previous one
-- on every `prisma migrate dev`.
DROP INDEX "user_roles_user_role_scope_key";

CREATE UNIQUE INDEX "user_roles_global_key"
  ON "user_roles" ("user_id", "role_id") WHERE "scope_id" IS NULL;

CREATE UNIQUE INDEX "user_roles_scoped_key"
  ON "user_roles" ("user_id", "role_id", "scope_type", "scope_id") WHERE "scope_id" IS NOT NULL;
