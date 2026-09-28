CREATE TYPE "HandoffReplySource" AS ENUM ('HUMAN', 'CODEX_AUTO');
CREATE TYPE "HandoffJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'REVIEW_REQUIRED', 'COMPLETED');

CREATE TABLE "handoff_requests" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "public_title" VARCHAR(160) NOT NULL,
    "send_key" VARCHAR(128) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "handoff_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "handoff_versions" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "private_body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "handoff_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "handoff_replies" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "source" "HandoffReplySource" NOT NULL,
    "reply_key" VARCHAR(128) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "handoff_replies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "handoff_jobs" (
    "request_id" UUID NOT NULL,
    "status" "HandoffJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_until" TIMESTAMPTZ(6),
    "review_reason" VARCHAR(255),
    "review_draft" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "handoff_jobs_pkey" PRIMARY KEY ("request_id")
);

CREATE UNIQUE INDEX "handoff_requests_sender_id_send_key_key" ON "handoff_requests"("sender_id","send_key");
CREATE INDEX "handoff_requests_project_id_created_at_idx" ON "handoff_requests"("project_id","created_at");
CREATE INDEX "handoff_requests_recipient_id_created_at_idx" ON "handoff_requests"("recipient_id","created_at");
CREATE UNIQUE INDEX "handoff_versions_request_id_version_key" ON "handoff_versions"("request_id","version");
CREATE UNIQUE INDEX "handoff_replies_request_id_actor_id_reply_key_key" ON "handoff_replies"("request_id","actor_id","reply_key");
CREATE INDEX "handoff_replies_request_id_created_at_idx" ON "handoff_replies"("request_id","created_at");
CREATE INDEX "handoff_jobs_status_lease_until_idx" ON "handoff_jobs"("status","lease_until");

ALTER TABLE "handoff_requests" ADD CONSTRAINT "handoff_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "handoff_requests" ADD CONSTRAINT "handoff_requests_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "handoff_requests" ADD CONSTRAINT "handoff_requests_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "handoff_versions" ADD CONSTRAINT "handoff_versions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "handoff_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "handoff_replies" ADD CONSTRAINT "handoff_replies_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "handoff_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "handoff_replies" ADD CONSTRAINT "handoff_replies_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "handoff_jobs" ADD CONSTRAINT "handoff_jobs_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "handoff_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
