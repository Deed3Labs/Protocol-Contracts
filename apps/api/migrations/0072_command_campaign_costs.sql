-- Command Center, Growth › Campaigns: what each campaign cost, as people record it (a poster design's print run,
-- a tagged link's ad spend, referral credit). The $10 offers count themselves from members' first spends.
-- A campaign is 'design:<code>' or 'utm:<utm_campaign>'.
CREATE TABLE command.campaign_costs (
  id           BIGSERIAL PRIMARY KEY,
  campaign     TEXT NOT NULL CHECK (campaign ~ '^(design|utm):.+$'),
  kind         TEXT NOT NULL CHECK (kind IN ('print', 'ads', 'offer', 'credit')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  spent_on     DATE NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  recorded_by  UUID NOT NULL REFERENCES command.people (id),
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX campaign_costs_campaign ON command.campaign_costs (campaign);
