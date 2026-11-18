-- Command Center, Build's map: SettlementForwarder joins it, and three contracts' words lose the design's sample
-- figures.
--
-- SettlementForwarder (decision 54, the Settlement Funding lane), deployed
-- on Base Sepolia on 18 Nov at 0x0343…f46c. CL Operating's AllowanceModule delegate: the funding desk's
-- wallet forwards USDC from CL Operating to the off-ramp, within the allowance CL Operating gave it. It sits
-- in the Earn column under the Yield Pool (LendingPool), whose Settlement Funding lane fills CL Operating;
-- Clear Lending controls it, through CL Operating.
--
-- Only where the map is already written: an empty table is seeded whole from the fixture
-- (packages/command-types/src/fixtures/contracts.json), which has this row and its line.
-- Live, it counts as deployed once deployments/base-sepolia/SettlementForwarder.json is on dev.

-- after the Yield Pool, the rest move down one
UPDATE command.contracts SET position = position + 1
WHERE position > 25 AND NOT EXISTS (SELECT 1 FROM command.contracts WHERE id = 'sf');

INSERT INTO command.contracts (id, position, name, version, layer, status, address, purpose, map_x, map_y, band, controller)
SELECT 'sf', 26, 'SettlementForwarder', 'v1.0', 4, 'live', '0x0343…f46c',
  'CL Operating’s delegate for Settlement Funding: the funding desk’s wallet forwards USDC from CL Operating to the off-ramp, within the allowance CL Operating gave it. Only CL Operating sets the off-ramp and the desk.',
  90, 33.5, 'c', 'CL'
WHERE EXISTS (SELECT 1 FROM command.contracts)
ON CONFLICT (id) DO NOTHING;

INSERT INTO command.contract_links (position, from_id, to_id, kind, verb, label, label_side)
SELECT 52, 'lp', 'sf', 'money', 'settlement funding, through CL Operating', '', NULL
WHERE EXISTS (SELECT 1 FROM command.contracts WHERE id = 'sf')
ON CONFLICT (position) DO NOTHING;

-- What a contract does is structure; what it holds is the chain's. The fixture's words for three of them carried
-- the design's sample figures ("Holds $9,000.00 from 18 depositors", "6 issued", "Holds $25,000.00 for 6 bonds"),
-- and 0080 wrote them into the live map. They come out here; the demo keeps the reference's own words.
UPDATE command.contracts SET purpose = regexp_replace(purpose, ' Holds \$[0-9,.]+ from [0-9]+ depositors\.$', '') WHERE id = 'lp';
UPDATE command.contracts SET purpose = regexp_replace(purpose, ' [0-9]+ issued\.$', '') WHERE id = 'bb';
UPDATE command.contracts SET purpose = regexp_replace(purpose, ' Holds \$[0-9,.]+ for [0-9]+ bonds\.$', '') WHERE id = 'bv';
