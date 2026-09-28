CREATE TABLE "mcp_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    CONSTRAINT "mcp_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_grants_token_hash_key" ON "mcp_grants"("token_hash");
CREATE INDEX "mcp_grants_user_id_project_id_idx" ON "mcp_grants"("user_id","project_id");
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
