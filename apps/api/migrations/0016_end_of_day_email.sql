-- Settings › Notifications: the end-of-day summary, emailed when the day is closed, and where to.
ALTER TABLE merchant.shop_settings
  ADD COLUMN IF NOT EXISTS notify_end_of_day BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_email      TEXT;
