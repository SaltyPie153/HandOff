-- A legacy request has exactly one immutable version; never guess a reply's version.
DO $$ BEGIN
  IF EXISTS (SELECT r.id FROM handoff_requests r LEFT JOIN handoff_versions v ON v.request_id=r.id
    GROUP BY r.id HAVING count(v.id) <> 1 OR min(v.version) <> 1) THEN
    RAISE EXCEPTION 'Ambiguous legacy handoff versions';
  END IF;
END $$;

CREATE TYPE "HandoffVersionStatus" AS ENUM ('AWAITING_REVIEW','ACKNOWLEDGED','CHANGES_REQUESTED','SUPERSEDED');
CREATE TYPE "HandoffResponseAction" AS ENUM ('ACKNOWLEDGE','REQUEST_CHANGES');
CREATE TYPE "HandoffNotificationKind" AS ENUM ('REQUEST_RECEIVED','REVISION_RECEIVED','ACKNOWLEDGED','CHANGES_REQUESTED');
ALTER TABLE handoff_requests ADD COLUMN current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0);
ALTER TABLE handoff_versions ADD COLUMN status "HandoffVersionStatus" NOT NULL DEFAULT 'AWAITING_REVIEW',
  ADD COLUMN send_key varchar(128), ADD COLUMN payload_hash char(64), ADD CHECK (version > 0);
CREATE UNIQUE INDEX handoff_versions_id_request_id_key ON handoff_versions(id,request_id);
CREATE UNIQUE INDEX handoff_versions_request_id_send_key_key ON handoff_versions(request_id,send_key);
ALTER TABLE handoff_replies ADD COLUMN version_id uuid;
ALTER TABLE handoff_jobs ADD COLUMN version_id uuid;
UPDATE handoff_replies r SET version_id=v.id FROM handoff_versions v WHERE v.request_id=r.request_id;
UPDATE handoff_jobs j SET version_id=v.id FROM handoff_versions v WHERE v.request_id=j.request_id;
ALTER TABLE handoff_replies ALTER COLUMN version_id SET NOT NULL,
  ADD FOREIGN KEY(version_id,request_id) REFERENCES handoff_versions(id,request_id) ON DELETE CASCADE;
ALTER TABLE handoff_jobs DROP CONSTRAINT handoff_jobs_pkey,
  ALTER COLUMN version_id SET NOT NULL, ADD PRIMARY KEY(version_id),
  ADD FOREIGN KEY(version_id,request_id) REFERENCES handoff_versions(id,request_id) ON DELETE CASCADE;
CREATE INDEX handoff_jobs_request_id_idx ON handoff_jobs(request_id);
CREATE UNIQUE INDEX handoff_jobs_version_id_request_id_key ON handoff_jobs(version_id,request_id);

CREATE TABLE handoff_responses (
  id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES handoff_requests(id) ON DELETE CASCADE,
  version_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
  action "HandoffResponseAction" NOT NULL, comment varchar(10000),
  response_key varchar(128) NOT NULL, payload_hash char(64) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  FOREIGN KEY(version_id,request_id) REFERENCES handoff_versions(id,request_id) ON DELETE CASCADE,
  CHECK ((action='ACKNOWLEDGE' AND comment IS NULL) OR
    (action='REQUEST_CHANGES' AND comment IS NOT NULL AND length(btrim(comment)) > 0))
);
CREATE UNIQUE INDEX handoff_responses_version_id_actor_id_key ON handoff_responses(version_id,actor_id);
CREATE UNIQUE INDEX handoff_responses_request_id_actor_id_response_key_key ON handoff_responses(request_id,actor_id,response_key);

CREATE TABLE handoff_notifications (
  id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES handoff_requests(id) ON DELETE CASCADE,
  version_id uuid NOT NULL, recipient_id uuid NOT NULL REFERENCES users(id),
  kind "HandoffNotificationKind" NOT NULL, created_at timestamptz(6) NOT NULL DEFAULT now(), read_at timestamptz(6),
  FOREIGN KEY(version_id,request_id) REFERENCES handoff_versions(id,request_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX handoff_notifications_recipient_id_version_id_kind_key ON handoff_notifications(recipient_id,version_id,kind);
CREATE INDEX handoff_notifications_recipient_id_created_at_idx ON handoff_notifications(recipient_id,created_at);
