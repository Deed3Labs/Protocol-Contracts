-- Settings › Closing › Who can close: owners and managers (as before), or anyone on shift. The
-- server enforces it at Close the day; the counts and any sign-off are unchanged.
ALTER TABLE merchant.shop_settings ADD COLUMN IF NOT EXISTS who_can_close TEXT NOT NULL DEFAULT 'managers'
  CHECK (who_can_close IN ('managers', 'anyone'));
