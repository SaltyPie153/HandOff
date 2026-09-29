ALTER TYPE "ContractStatus" ADD VALUE 'RETIRED';
ALTER TYPE "ContractVersionStatus" ADD VALUE 'WITHDRAWN';
ALTER TYPE "ContractNotificationKind" ADD VALUE 'WITHDRAWN';
CREATE TYPE "ContractProposalKind" AS ENUM ('INITIAL','CHANGE','RETIRE');
CREATE TYPE "ContractProposalLifecycle" AS ENUM ('OPEN','CONFIRMED','WITHDRAWN');

ALTER TABLE development_contracts
 ADD COLUMN sender_id UUID, ADD COLUMN recipient_id UUID,
 ADD COLUMN previous_contract_id UUID, ADD COLUMN last_confirmed_version_id UUID,
 ADD COLUMN retirement_version_id UUID, ADD COLUMN retired_at TIMESTAMPTZ(6);
UPDATE development_contracts c SET sender_id=p.sender_id,recipient_id=p.recipient_id,last_confirmed_version_id=c.current_version_id FROM contract_proposals p WHERE p.contract_id=c.id;
ALTER TABLE development_contracts ALTER COLUMN sender_id SET NOT NULL, ALTER COLUMN recipient_id SET NOT NULL;
ALTER TABLE contract_proposals
 ADD COLUMN kind "ContractProposalKind" NOT NULL DEFAULT 'INITIAL',
 ADD COLUMN lifecycle "ContractProposalLifecycle" NOT NULL DEFAULT 'OPEN',
 ADD COLUMN baseline_version_id UUID, ADD COLUMN previous_proposal_id UUID,
 ADD COLUMN withdrawn_by_id UUID, ADD COLUMN withdrawal_reason VARCHAR(10000),
 ADD COLUMN withdrawn_at TIMESTAMPTZ(6), ADD COLUMN withdrawal_key VARCHAR(128), ADD COLUMN withdrawal_hash CHAR(64);
UPDATE contract_proposals p SET lifecycle='CONFIRMED' FROM development_contracts c WHERE p.contract_id=c.id AND c.status='ACTIVE';
DROP INDEX contract_proposals_contract_id_key;
CREATE UNIQUE INDEX contract_one_open_proposal ON contract_proposals(contract_id) WHERE lifecycle='OPEN';
ALTER TABLE development_contracts DROP CONSTRAINT current_state;
-- Text comparison lets this migration run in a transaction that added enum values.
ALTER TABLE development_contracts ADD CONSTRAINT current_state CHECK (
 (status::text='UNCONFIRMED' AND current_version_id IS NULL AND last_confirmed_version_id IS NULL AND confirmed_at IS NULL AND retirement_version_id IS NULL AND retired_at IS NULL) OR
 (status::text='ACTIVE' AND current_version_id IS NOT NULL AND last_confirmed_version_id IS NOT NULL AND current_version_id=last_confirmed_version_id AND confirmed_at IS NOT NULL AND retirement_version_id IS NULL AND retired_at IS NULL) OR
 (status::text='RETIRED' AND current_version_id IS NULL AND last_confirmed_version_id IS NOT NULL AND retirement_version_id IS NOT NULL AND confirmed_at IS NOT NULL AND retired_at IS NOT NULL));
ALTER TABLE development_contracts
 ADD CONSTRAINT contract_sender_fk FOREIGN KEY(sender_id) REFERENCES users(id),
 ADD CONSTRAINT contract_recipient_fk FOREIGN KEY(recipient_id) REFERENCES users(id),
 ADD CONSTRAINT contract_last_fk FOREIGN KEY(last_confirmed_version_id,id) REFERENCES contract_proposal_versions(id,contract_id),
 ADD CONSTRAINT contract_retirement_fk FOREIGN KEY(retirement_version_id,id) REFERENCES contract_proposal_versions(id,contract_id),
 ADD CONSTRAINT contract_previous_fk FOREIGN KEY(previous_contract_id) REFERENCES development_contracts(id),
 ADD CONSTRAINT contract_different_parties CHECK(sender_id<>recipient_id),
 ADD CONSTRAINT contract_not_self CHECK(previous_contract_id IS NULL OR previous_contract_id<>id);
ALTER TABLE contract_proposals
 ADD CONSTRAINT proposal_baseline_fk FOREIGN KEY(baseline_version_id,contract_id) REFERENCES contract_proposal_versions(id,contract_id),
 ADD CONSTRAINT proposal_previous_fk FOREIGN KEY(previous_proposal_id,contract_id) REFERENCES contract_proposals(id,contract_id),
 ADD CONSTRAINT proposal_withdrawer_fk FOREIGN KEY(withdrawn_by_id) REFERENCES users(id),
 ADD CONSTRAINT proposal_baseline_kind CHECK((kind='INITIAL' AND baseline_version_id IS NULL) OR (kind<>'INITIAL' AND baseline_version_id IS NOT NULL)),
 ADD CONSTRAINT proposal_not_self CHECK(previous_proposal_id IS NULL OR previous_proposal_id<>id),
 ADD CONSTRAINT proposal_withdrawal CHECK((lifecycle='WITHDRAWN' AND withdrawn_by_id=sender_id AND withdrawn_by_id IS NOT NULL AND withdrawal_reason IS NOT NULL AND length(btrim(withdrawal_reason))>0 AND withdrawn_at IS NOT NULL AND withdrawal_key IS NOT NULL AND withdrawal_hash IS NOT NULL) OR (lifecycle<>'WITHDRAWN' AND withdrawn_by_id IS NULL AND withdrawal_reason IS NULL AND withdrawn_at IS NULL AND withdrawal_key IS NULL AND withdrawal_hash IS NULL));
