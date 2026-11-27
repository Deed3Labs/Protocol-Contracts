-- Command Center, Merchants: where each shop is on the map. A shop's street address (a partner's from the merchant
-- app, a pipeline card's own) is looked up once with the US Census geocoder and kept here by the address as it was
-- asked, so the map pins it at its door. lat/lng NULL is an address it found no match for, asked again after a while.
CREATE TABLE command.geocodes (
  address   TEXT PRIMARY KEY,
  lat       DOUBLE PRECISION,
  lng       DOUBLE PRECISION,
  matched   TEXT,
  looked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
