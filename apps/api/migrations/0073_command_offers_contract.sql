-- Command Center, Contracts: OffersIssuer (#826), the co-op's $10 to each new member on a capped line of its
-- own, under Issuance, and its line to ClearCredit. Only where the map is already written: an empty table is
-- seeded whole from the fixture, which has it, and a row here first would stop that seeding.
INSERT INTO command.contracts (id, position, name, version, layer, status, address, purpose, map_x, map_y, band, note)
SELECT 'oi', (SELECT max(position) + 1 FROM command.contracts), 'OffersIssuer', 'v1.0', 1, 'live', '0x150E…841c',
       'The co-op’s $10 to each new member, on a capped line of its own. The Safe pays it down.', 30, 37, 'c', NULL
WHERE EXISTS (SELECT 1 FROM command.contracts)
ON CONFLICT DO NOTHING;

INSERT INTO command.contract_links (position, from_id, to_id, kind, verb, label, label_side)
SELECT (SELECT max(position) + 1 FROM command.contract_links), 'oi', 'cc', 'mint', 'gives $10 offers', '', NULL
WHERE EXISTS (SELECT 1 FROM command.contracts WHERE id = 'oi')
  AND NOT EXISTS (SELECT 1 FROM command.contract_links WHERE from_id = 'oi');
