-- Tables v2 (the terminal reference's new sections 8–8d, 14): a wait-list party is waiting, notified
-- (the almost-ready text went), seated, no_show or removed. What was `ready` (told their table was
-- ready) is notified; what was `left` is removed. No show and Remove keep the row for the day's figures.
ALTER TABLE merchant.waitlist_parties DROP CONSTRAINT IF EXISTS waitlist_parties_state_check;
UPDATE merchant.waitlist_parties SET state = 'notified' WHERE state = 'ready';
UPDATE merchant.waitlist_parties SET state = 'removed' WHERE state = 'left';
ALTER TABLE merchant.waitlist_parties ADD CONSTRAINT waitlist_parties_state_check
  CHECK (state IN ('waiting','notified','seated','no_show','removed'));
ALTER TABLE merchant.waitlist_parties ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
