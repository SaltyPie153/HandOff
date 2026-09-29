-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('UNCONFIRMED', 'ACTIVE');

-- CreateEnum
CREATE TYPE "ContractVersionStatus" AS ENUM ('IN_REVIEW', 'CHANGES_REQUESTED', 'SUPERSEDED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "ContractParticipantRole" AS ENUM ('SENDER', 'RECIPIENT', 'REQUIRED_PM', 'REFERENCE_PM');

-- CreateEnum
CREATE TYPE "ContractResponseAction" AS ENUM ('AGREE', 'REQUEST_CHANGES');

-- CreateEnum
CREATE TYPE "ContractNotificationKind" AS ENUM ('PROPOSAL_RECEIVED', 'REVISION_RECEIVED', 'CHANGES_REQUESTED', 'CONFIRMED');

-- CreateTable
CREATE TABLE "development_contracts" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "public_title" VARCHAR(160) NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'UNCONFIRMED',
    "current_version_id" UUID,
    "confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "development_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_proposals" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "send_key" VARCHAR(128) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_proposal_versions" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ContractVersionStatus" NOT NULL DEFAULT 'IN_REVIEW',
    "proposed_body" TEXT NOT NULL,
    "send_key" VARCHAR(128) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_proposal_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_participants" (
    "version_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ContractParticipantRole" NOT NULL,

    CONSTRAINT "contract_participants_pkey" PRIMARY KEY ("version_id","user_id")
);

-- CreateTable
CREATE TABLE "contract_responses" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" "ContractResponseAction" NOT NULL,
    "comment" VARCHAR(10000),
    "response_key" VARCHAR(128) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_notifications" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "kind" "ContractNotificationKind" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),

    CONSTRAINT "contract_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_read_audits" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "grant_id" UUID,
    "version_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_read_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "development_contracts_current_version_id_key" ON "development_contracts"("current_version_id");

-- CreateIndex
CREATE INDEX "development_contracts_project_id_created_at_idx" ON "development_contracts"("project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "development_contracts_current_version_id_id_key" ON "development_contracts"("current_version_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_proposals_contract_id_key" ON "contract_proposals"("contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_proposals_id_contract_id_key" ON "contract_proposals"("id", "contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_proposals_sender_id_send_key_key" ON "contract_proposals"("sender_id", "send_key");

-- CreateIndex
CREATE UNIQUE INDEX "contract_proposal_versions_id_contract_id_key" ON "contract_proposal_versions"("id", "contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_proposal_versions_id_proposal_id_key" ON "contract_proposal_versions"("id", "proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_proposal_versions_proposal_id_version_key" ON "contract_proposal_versions"("proposal_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "contract_proposal_versions_proposal_id_send_key_key" ON "contract_proposal_versions"("proposal_id", "send_key");

-- CreateIndex
CREATE INDEX "contract_participants_user_id_idx" ON "contract_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_responses_version_id_actor_id_key" ON "contract_responses"("version_id", "actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_responses_proposal_id_actor_id_response_key_key" ON "contract_responses"("proposal_id", "actor_id", "response_key");

-- CreateIndex
CREATE INDEX "contract_notifications_recipient_id_created_at_idx" ON "contract_notifications"("recipient_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "contract_notifications_recipient_id_version_id_kind_key" ON "contract_notifications"("recipient_id", "version_id", "kind");

-- CreateIndex
CREATE INDEX "contract_read_audits_version_id_created_at_idx" ON "contract_read_audits"("version_id", "created_at");

-- AddForeignKey
ALTER TABLE "development_contracts" ADD CONSTRAINT "development_contracts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_contracts" ADD CONSTRAINT "development_contracts_current_version_id_id_fkey" FOREIGN KEY ("current_version_id", "id") REFERENCES "contract_proposal_versions"("id", "contract_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_proposals" ADD CONSTRAINT "contract_proposals_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "development_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_proposals" ADD CONSTRAINT "contract_proposals_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_proposals" ADD CONSTRAINT "contract_proposals_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_proposal_versions" ADD CONSTRAINT "contract_proposal_versions_proposal_id_contract_id_fkey" FOREIGN KEY ("proposal_id", "contract_id") REFERENCES "contract_proposals"("id", "contract_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_proposal_versions" ADD CONSTRAINT "contract_proposal_versions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "development_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_participants" ADD CONSTRAINT "contract_participants_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "contract_proposal_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_participants" ADD CONSTRAINT "contract_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_responses" ADD CONSTRAINT "contract_responses_version_id_proposal_id_fkey" FOREIGN KEY ("version_id", "proposal_id") REFERENCES "contract_proposal_versions"("id", "proposal_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_responses" ADD CONSTRAINT "contract_responses_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_notifications" ADD CONSTRAINT "contract_notifications_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "contract_proposal_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_notifications" ADD CONSTRAINT "contract_notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_read_audits" ADD CONSTRAINT "contract_read_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_read_audits" ADD CONSTRAINT "contract_read_audits_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "mcp_grants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_read_audits" ADD CONSTRAINT "contract_read_audits_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "contract_proposal_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE contract_proposals ADD CONSTRAINT positive_current_version CHECK(current_version>0), ADD CONSTRAINT different_parties CHECK(sender_id<>recipient_id);
ALTER TABLE contract_proposal_versions ADD CONSTRAINT positive_version CHECK(version>0), ADD CONSTRAINT body_length CHECK(length(btrim(proposed_body))>0 AND length(proposed_body)<=50000);
ALTER TABLE contract_responses ADD CONSTRAINT response_comment CHECK((action='AGREE' AND comment IS NULL) OR (action='REQUEST_CHANGES' AND length(btrim(comment))>0 AND comment IS NOT NULL));
ALTER TABLE development_contracts ADD CONSTRAINT current_state CHECK((status='UNCONFIRMED' AND current_version_id IS NULL AND confirmed_at IS NULL) OR (status='ACTIVE' AND current_version_id IS NOT NULL AND confirmed_at IS NOT NULL));
