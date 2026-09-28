ALTER TABLE "handoff_requests" ADD COLUMN "grant_id" UUID;
ALTER TABLE "handoff_jobs" ADD COLUMN "execution_id" UUID,
ADD COLUMN "evidence_refs" JSONB;
CREATE INDEX "handoff_requests_grant_id_idx" ON "handoff_requests"("grant_id");
ALTER TABLE "handoff_requests" ADD CONSTRAINT "handoff_requests_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "mcp_grants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
