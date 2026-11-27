-- Command Center: saving each section's own actions (docs/command-center-plan.md, after Phase 3).

-- What Command was asked to do outside itself: pay, refund, sign on-chain, send for e-signature,
-- message members, buy postage, sync a provider. Nothing here has been carried out; Phases 4–7
-- connect the Safe, Stripe, Shippo, the e-signature tool and messaging, and work through it.
-- A row arrives once it's allowed: straight away, or when the second person approves.
CREATE TABLE command.outbox (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section      TEXT NOT NULL,
  kind         TEXT NOT NULL,
  summary      TEXT NOT NULL,
  payload      JSONB NOT NULL,
  requested_by UUID NOT NULL REFERENCES command.people (id),
  approved_by  UUID REFERENCES command.people (id),
  proposal_id  UUID REFERENCES command.proposals (id),
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'done', 'failed', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT outbox_second_person CHECK (approved_by IS NULL OR approved_by <> requested_by)
);
CREATE INDEX outbox_queued ON command.outbox (created_at) WHERE status = 'queued';

-- Files people add: documents and their versions, and photos from the field. Kept in the database
-- for now, behind one interface (services/command/files.ts) so a bucket can replace it.
CREATE TABLE command.files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL CHECK (size > 0 AND size <= 26214400),
  sha256      TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  bytes       BYTEA NOT NULL,
  added_by    UUID NOT NULL REFERENCES command.people (id),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Each document's versions, newest last; the document row points at the current one.
CREATE TABLE command.document_versions (
  document_id TEXT NOT NULL REFERENCES command.documents (id),
  version     TEXT NOT NULL,
  file_id     UUID REFERENCES command.files (id),
  note        TEXT NOT NULL DEFAULT '',
  added_by    UUID REFERENCES command.people (id),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, version)
);
ALTER TABLE command.documents ADD COLUMN file_id UUID REFERENCES command.files (id);

-- View-only links to a document. Only the token's hash is kept; the link stops working when it
-- expires or is revoked, and every open is logged.
CREATE TABLE command.share_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id TEXT NOT NULL REFERENCES command.documents (id),
  token_hash  TEXT NOT NULL UNIQUE,
  for_whom    TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_by  UUID NOT NULL REFERENCES command.people (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  opens       INTEGER NOT NULL DEFAULT 0
);

-- A board card taken off the board stays on record, with why.
ALTER TABLE command.merchant_stage ADD COLUMN removed_at TIMESTAMPTZ, ADD COLUMN removed_reason TEXT;

-- A field scan's photo.
ALTER TABLE command.route_tasks ADD COLUMN photo_file UUID REFERENCES command.files (id);
