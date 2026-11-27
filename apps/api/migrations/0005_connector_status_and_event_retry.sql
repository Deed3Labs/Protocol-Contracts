-- When the processor last told us a connector's status. Webhooks can arrive out of order, and an
-- older account.updated must not overwrite a newer one: a status is applied only if it is at least
-- as new as the one already stored.
ALTER TABLE merchant.card_connectors ADD COLUMN status_at TIMESTAMPTZ;

-- When a failed Stripe event is next due. Retries back off (30s, doubling, capped at an hour), so a
-- processor outage doesn't burn every attempt in the first second.
ALTER TABLE payments.stripe_events ADD COLUMN next_attempt_at TIMESTAMPTZ;
DROP INDEX payments.stripe_events_pending;
CREATE INDEX stripe_events_pending ON payments.stripe_events (next_attempt_at, received_at) WHERE processed_at IS NULL;
