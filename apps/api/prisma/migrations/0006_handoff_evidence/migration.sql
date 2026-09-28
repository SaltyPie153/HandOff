CREATE TYPE "EvidenceKind" AS ENUM ('LOCAL', 'GITHUB');

ALTER TABLE "handoff_versions" ADD COLUMN "verification_claim" VARCHAR(500);

CREATE TABLE "evidence_sources" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "local_path" VARCHAR(1024),
    "github_owner" VARCHAR(100),
    "github_repo" VARCHAR(100),
    "github_path" VARCHAR(1024),
    "github_ref" VARCHAR(255),
    "sync_token_hash" CHAR(64),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evidence_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evidence_snapshots" (
    "source_id" UUID NOT NULL,
    "encrypted_content" TEXT NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL,
    "dirty_at" TIMESTAMPTZ(6),
    CONSTRAINT "evidence_snapshots_pkey" PRIMARY KEY ("source_id")
);

CREATE UNIQUE INDEX "evidence_sources_sync_token_hash_key" ON "evidence_sources"("sync_token_hash");
CREATE INDEX "evidence_sources_owner_id_project_id_idx" ON "evidence_sources"("owner_id","project_id");
ALTER TABLE "evidence_sources" ADD CONSTRAINT "evidence_sources_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evidence_sources" ADD CONSTRAINT "evidence_sources_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence_snapshots" ADD CONSTRAINT "evidence_snapshots_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "evidence_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
