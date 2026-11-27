-- Command Center, Phase 4a: reading the Ops Safe (docs/command-center-plan.md).

-- The wallet a person signs with. Linked by signing a one-time message with it, so it's theirs; a
-- Safe owner is a signer when one of these matches. One wallet per person, one person per wallet.
ALTER TABLE command.people
  ADD COLUMN wallet_address   TEXT UNIQUE CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  ADD COLUMN wallet_linked_at TIMESTAMPTZ;

-- The one-time messages people sign to link a wallet. Each is used once and expires in 10 minutes.
CREATE TABLE command.wallet_challenges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  UUID NOT NULL REFERENCES command.people (id),
  message    TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX wallet_challenges_person ON command.wallet_challenges (person_id, expires_at DESC);
