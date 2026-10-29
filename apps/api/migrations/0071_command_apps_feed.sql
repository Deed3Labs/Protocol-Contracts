-- Command Center, Growth › Apps: the member and merchant apps' own usage from Umami, as one more feed.
ALTER TABLE command.feeds DROP CONSTRAINT feeds_id_check;
ALTER TABLE command.feeds ADD CONSTRAINT feeds_id_check CHECK (id IN ('plaid', 'bridge', 'lithic', 'stripe', 'shop', 'catalog', 'site', 'apps'));
INSERT INTO command.feeds (id) VALUES ('apps');
