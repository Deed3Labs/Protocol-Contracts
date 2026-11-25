-- Command Center, Build's map: Clear Credits and the Housing Allowance join it, and the RedemptionAgent with the
-- Deed v5 contracts.
--
-- Deploy 29 (Clear Credits): the Credits Ledger, a second ClearCredit of its own ("Clear Credits", non-transferable,
-- no cash value); the Points Issuer, its only issuer; and the HousingAllowanceRecord, each member's equity toward a
-- Clear home, which the Points Issuer redeems into. They sit at the foot of the credit band, beside the credit they
-- mirror. Deploy 30 (Deed v5): the RedemptionAgent, which holds a home's deed while its member pays toward it and
-- hands it over when the record shows the price reached, beside the CoopTransferAgent; the deed band takes a third
-- row for it, so its two rows move up.
--
-- Not deployed when this was written: each counts as live once its deployment record is on dev (Build reads the
-- records by name). Their helpers (the Credits AccessManager and registries, DeedNFT's three extensions) are in
-- "Timelocks and helpers", not on the map.
--
-- Only where the map is already written: an empty table is seeded whole from the fixture
-- (packages/command-types/src/fixtures/contracts.json), which has these rows and lines.

INSERT INTO command.contracts (id, position, name, version, layer, status, address, purpose, map_x, map_y, band, controller)
SELECT v.id, v.position, v.name, 'v1.0', v.layer, 'later', '—', v.purpose, v.map_x, v.map_y, v.band, v.controller
FROM (VALUES
  ('pi', 43, 'PointsIssuer', 1,
   'The only issuer of Clear Credits: mints the credits members earn as they vest, redeems them into the Housing Allowance, and reverses them when two reviewers agree. Credits have no cash value and never leave their member.',
   30, 72.5, 'c', 'CL'),
  ('crl', 44, 'CreditsLedger', 2,
   'Clear Credits, on a ClearCredit ledger of their own with its own AccessManager: the credit ledger’s admins have no say over it, no shop can be registered on it, and only the Points Issuer mints.',
   50, 72.5, 'c', 'CL'),
  ('har', 45, 'HousingAllowanceRecord', 3,
   'Each member’s Housing Allowance, on chain: the Credit Portion from redeemed credits, never paid as cash, and the Member Portion, which members pay in USDC straight to the home’s payee.',
   70, 59.5, 'c', 'CL'),
  ('rda', 46, 'RedemptionAgent', 3,
   'Holds a home’s deed while its member pays toward it, and hands the deed to the member once the Housing Allowance Record shows the price reached. Nothing else moves it.',
   70, 96.5, 'd', 'R')
) AS v (id, position, name, layer, purpose, map_x, map_y, band, controller)
WHERE EXISTS (SELECT 1 FROM command.contracts)
ON CONFLICT (id) DO NOTHING;

-- the deed band takes three rows: 85 and 93 become 83.5 and 90, and the RedemptionAgent sits at 96.5
UPDATE command.contracts SET map_y = 83.5 WHERE band = 'd' AND map_y = 85;
UPDATE command.contracts SET map_y = 90 WHERE band = 'd' AND map_y = 93;

INSERT INTO command.contract_links (position, from_id, to_id, kind, verb, label, label_side)
SELECT v.position, v.from_id, v.to_id, v.kind, v.verb, v.label, NULL
FROM (VALUES
  (53, 'pi', 'crl', 'mint', 'mints Clear Credits', ''),
  (54, 'pi', 'har', 'money', 'redeems credits into', ''),
  (55, 'rda', 'har', 'reads', 'reads the price reached', ''),
  (56, 'rda', 'dn', 'money', 'hands the deed to its member', '')
) AS v (position, from_id, to_id, kind, verb, label)
WHERE EXISTS (SELECT 1 FROM command.contracts WHERE id = 'rda')
ON CONFLICT (position) DO NOTHING;
