CREATE TYPE "ProjectRole" AS ENUM ('MANAGER', 'MEMBER');
CREATE TYPE "ProjectMemberAction" AS ENUM ('ADD', 'REMOVE');

CREATE TABLE "projects" (
  "id" UUID NOT NULL PRIMARY KEY,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "creator_id" UUID NOT NULL REFERENCES "users"("id"),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "projects_name_valid" CHECK (char_length(btrim("name")) BETWEEN 1 AND 120)
);

CREATE TABLE "project_memberships" (
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id"),
  "role" "ProjectRole" NOT NULL,
  "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_memberships_pkey" PRIMARY KEY ("project_id", "user_id")
);
CREATE INDEX "project_memberships_user_id_idx" ON "project_memberships"("user_id");

CREATE TABLE "project_member_events" (
  "id" UUID NOT NULL PRIMARY KEY,
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "target_id" UUID NOT NULL REFERENCES "users"("id"),
  "actor_id" UUID NOT NULL REFERENCES "users"("id"),
  "action" "ProjectMemberAction" NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "project_member_events_project_id_created_at_idx" ON "project_member_events"("project_id", "created_at");
