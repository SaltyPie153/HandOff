CREATE TYPE "MemberStatus" AS ENUM ('PENDING', 'APPROVED');
CREATE TYPE "IdentityProvider" AS ENUM ('GOOGLE', 'DISCORD');
CREATE TYPE "AttemptIntent" AS ENUM ('LOGIN', 'LINK');

CREATE TABLE "users" (
  "id" UUID NOT NULL PRIMARY KEY,
  "status" "MemberStatus" NOT NULL DEFAULT 'PENDING',
  "is_service_admin" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_at" TIMESTAMPTZ(6)
);
CREATE TABLE "provider_identities" (
  "id" UUID NOT NULL PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" "IdentityProvider" NOT NULL,
  "provider_subject" VARCHAR(255) NOT NULL,
  "display_name" VARCHAR(255),
  "email" VARCHAR(320),
  "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_identities_provider_provider_subject_key" UNIQUE ("provider", "provider_subject")
);
CREATE INDEX "provider_identities_user_id_idx" ON "provider_identities"("user_id");
CREATE TABLE "auth_sessions" (
  "token_hash" CHAR(64) NOT NULL PRIMARY KEY,
  "csrf_hash" CHAR(64) NOT NULL,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL
);
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");
CREATE TABLE "oauth_attempts" (
  "state_hash" CHAR(64) NOT NULL PRIMARY KEY,
  "provider" "IdentityProvider" NOT NULL,
  "intent" "AttemptIntent" NOT NULL,
  "browser_session_id" VARCHAR(64) NOT NULL,
  "member_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "nonce" VARCHAR(64),
  "code_verifier" VARCHAR(128)
);
CREATE INDEX "oauth_attempts_expires_at_idx" ON "oauth_attempts"("expires_at");
CREATE TABLE "membership_approvals" (
  "id" UUID NOT NULL PRIMARY KEY,
  "target_id" UUID NOT NULL UNIQUE REFERENCES "users"("id"),
  "actor_id" UUID NOT NULL REFERENCES "users"("id"),
  "approved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "admin_grants" (
  "id" UUID NOT NULL PRIMARY KEY,
  "target_id" UUID NOT NULL UNIQUE REFERENCES "users"("id"),
  "actor_id" UUID REFERENCES "users"("id"),
  "source" VARCHAR(16) NOT NULL CHECK ("source" IN ('BOOTSTRAP', 'ADMIN')),
  "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
