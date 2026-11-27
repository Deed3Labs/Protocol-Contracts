-- Command Center, Phase 11b: whether a product sells past what's on hand. Goods sold on pre-order
-- (paid now, made in one run) keep selling at 0; a product made ahead can stop there instead, and
-- the store's catalog then shows a colour and size with nothing on hand as sold out.
ALTER TABLE command.shop_products ADD COLUMN sell_past_stock BOOLEAN NOT NULL DEFAULT true;
