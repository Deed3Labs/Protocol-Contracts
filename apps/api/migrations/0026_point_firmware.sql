-- Clear Terminal: Point firmware releases (docs/hardware/point-device-api.md, 7). A Point asks
-- GET /api/device/point/firmware for its model's newest; the manifest is signed with Ed25519 by a
-- key this server never holds, and the Point installs only what verifies against its built-in keys.
-- Published and withdrawn by scripts/point-firmware.ts. Images live elsewhere (Vercel Blob), by URL.

CREATE TABLE IF NOT EXISTS merchant.firmware_releases (
  id            TEXT PRIMARY KEY,
  model         TEXT NOT NULL CHECK (model IN ('point','point_large')),
  version       TEXT NOT NULL CHECK (version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
  url           TEXT NOT NULL CHECK (url LIKE 'https://%'),
  sha256        TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0),
  min_battery   INTEGER NOT NULL DEFAULT 40 CHECK (min_battery BETWEEN 0 AND 100),
  key_id        TEXT NOT NULL,
  signature     TEXT NOT NULL,
  published_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A withdrawn release is never offered again; Points that installed it are offered the next.
  withdrawn_at  TIMESTAMPTZ,
  UNIQUE (model, version)
);
