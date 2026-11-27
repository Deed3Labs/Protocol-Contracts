-- Card payments (card-processing prompt, Phase 4).

-- Whether a card refund gives back Clear's fee on it. A term of the shop's plan; until that's
-- decided it's off, so a refund returns the customer's money and Clear keeps its fee.
ALTER TABLE merchant.profiles ADD COLUMN refund_application_fee BOOLEAN NOT NULL DEFAULT false;

-- When the card was authorised: the safety capture runs well inside the processor's window, which
-- is counted from here.
ALTER TABLE payments.tenders ADD COLUMN authorised_at TIMESTAMPTZ;
CREATE INDEX tenders_authorised ON payments.tenders (authorised_at) WHERE method = 'card' AND status = 'authorised';

-- A card tender is one processor payment; finding it again from a webhook is by that id.
CREATE INDEX tenders_merchant_status ON payments.tenders (merchant, status);
