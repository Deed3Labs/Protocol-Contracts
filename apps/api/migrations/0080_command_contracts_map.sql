-- Command Center, brief update 2 (section 6): Build's map as the new reference draws it
-- (design/command-center-ui/command-center.html, BUILD2's `CTR` and `REL`). Forty-two contracts: forty-one
-- on the map in three bands (p controls and rules · c credit and money · d deeds and real assets) and
-- AssuranceOracle kept off it (x), retired. Five layers: Access, Issuance, Tokens, Pools, escrow and
-- enforcement, Earn. Each contract gains who controls it (`controller`: OPS the Ops Safe, CF Clear Financial,
-- CL Clear Lending, CO Clear Collective, AG the Collateral Agent, M the member alone, H bondholders, R no one,
-- rules only; empty for none).
--
-- Only where the map is already written: an empty table is seeded whole from the fixture
-- (packages/command-types/src/fixtures/contracts.json), which has this map, and a row written here first
-- would stop that seeding (as 0073 did for OffersIssuer).
--
-- What's kept: every id the old map had is on the new one (am ms nr cr mr tr lc ri ti oi lq cc cu ao ap lp
-- cp pp esa ce si bb bv bvl vr va mx dn sd fz ft fm), so nothing that points at a contract has to move:
-- contract_links, contract_releases, build_incidents and build_findings name contracts by id, and the
-- changes by name, which doesn't change. No contract is deleted. Ten are new: RateSchedule, PauseClock,
-- EarnControls, LegacyContactModule, CLRUSDTokenPool, PoolShareEnforcer, CollateralAgent, HolderDirections,
-- FunctionalContractRegistry and CoopTransferAgent.
--
-- Version and address stay columns, as the reference's rows carry them, but live they are the chain's
-- (sections.ts reads the indexer's inventory by name), so here they are only the structure's: each
-- address is its deployment record's (deployments/base-sepolia), shortened, never one copied out of the
-- reference; a contract with no record (OffersIssuer until its new record is pushed, and the four not
-- deployed) has none. Status is the structure's too: live or later.

ALTER TABLE command.contracts ADD COLUMN IF NOT EXISTS controller TEXT NOT NULL DEFAULT '';

-- the two new bands: p for the controls and rules row, x for a contract kept off the map
ALTER TABLE command.contracts DROP CONSTRAINT IF EXISTS contracts_band_check;
ALTER TABLE command.contracts ADD CONSTRAINT contracts_band_check CHECK (band IN ('p', 'c', 'd', 'x'));

-- every contract, by id: what it does, where it sits and who controls it are the reference's; an existing
-- row's note (the status line the seed's demo shows) is left as it is
INSERT INTO command.contracts (id, position, name, version, layer, status, address, purpose, map_x, map_y, band, controller)
SELECT v.id, v.position, v.name, v.version, v.layer, v.status, v.address, v.purpose, v.map_x::numeric, v.map_y::numeric, v.band, v.controller
FROM (VALUES
  ('am', 0, 'AccessManager', 'v1.0', 0, 'live', '0x23aF…8DBe', 'Role-based access for the protocol. Admin is the Ops Safe.', 10, 14, 'p', 'OPS'),
  ('rs', 1, 'RateSchedule', 'v1.0', 1, 'live', '0xdb73…8b97', 'What each credit product may charge, by state: the price Clear lists and the legal cap. RevolvingIssuer and TermIssuer read it before they charge. Changes wait on a timelock.', 30, 14, 'p', 'CL'),
  ('pc', 2, 'PauseClock', 'v1.0', 2, 'live', '0x794A…9959', 'Counts the seconds a pause on a member’s CLRUSD or ESA was in force, so grace and cure periods run longer by that much and a pause never causes a default.', 50, 14, 'p', 'R'),
  ('nr', 3, 'NetworkRegistry', 'v1.0', 3, 'live', '0xee10…1164', 'The parent registry every issuer is registered against, and the list of money paths the AssurancePool may pay. Its old AssuranceOracle field is retired.', 70, 14, 'p', 'OPS'),
  ('ec', 4, 'EarnControls', 'v1.0', 4, 'live', '0xe4a7…cD97', 'The one governed contract both Earn products share: eligibility attestations and exemption tags, the Funding Limit and offering cap, the Ladder, the Equity Cushion and Reserve Shortfall pauses, and the Successor path.', 90, 14, 'p', 'CL'),
  ('ms', 5, 'MembershipRegistry', 'v1.0', 0, 'live', '0xE700…4dE8', 'Member entitlements on-chain, no personal data. CLRUSD moves only between members; de-listing stops receiving only, with a reason code.', 10, 27, 'c', 'CO'),
  ('cr', 6, 'CollateralRegistry', 'v1.0', 0, 'live', '0xfeDb…446A', 'What each member has pledged and what is locked. Reads bond values and the pool-share side of the pledge module; ClearUSD reads its locks.', 10, 33.5, 'c', 'CL'),
  ('tr', 7, 'TokenRegistry', 'v1.0', 0, 'live', '0x4B13…8a86', 'Which tokens count, with fallback prices.', 10, 40, 'c', 'OPS'),
  ('lcm', 8, 'LegacyContactModule', '—', 0, 'later', '—', 'Optional recovery module a member installs on their own smart account. After a wait the member can cancel, a chosen contact can rotate the owner key, and nothing else. No Clear role.', 10, 46.5, 'c', 'M'),
  ('mr', 9, 'MerchantRegistry', 'v1.0', 0, 'live', '0x8f4C…3c1b', 'What each shop was promised: payout schedule, cap, fee, status.', 10, 53, 'c', 'CF'),
  ('ri', 10, 'RevolvingIssuer', 'v1.3', 1, 'live', '0xBec5…E2F0', 'The tiered revolving line: savings-backed, asset-backed, income and Boost. Calendar cycles, cure notices, Assurance and workouts run in its modules (Cycles, Terms, Workouts, Extension).', 30, 27, 'c', 'CL'),
  ('lc', 11, 'LimitCalculator', 'v1.0', 1, 'live', '0x6C08…4a20', 'Turns pledges and attestations into a member’s ceiling.', 30, 33.5, 'c', 'CL'),
  ('oi', 12, 'OffersIssuer', 'v1.0', 1, 'live', '—', 'The co-op’s $10 to each new member, on a capped line of its own. The Safe pays it down. Redeployed on 17 Nov; the old one is retired.', 30, 40, 'c', 'CO'),
  ('ti', 13, 'TermIssuer', 'v1.0', 1, 'live', '0x1b16…da57', 'Term plans: partner credit and Clear Cash. Origination prices each plan on-chain and pays the merchant fee leg to Clear Lending.', 30, 46.5, 'c', 'CL'),
  ('bvl', 14, 'BondValuer', 'v1.0', 1, 'live', '0x7f63…02C8', 'What a member’s pledged bonds are worth today, for CollateralRegistry.', 30, 59.5, 'c', 'R'),
  ('lq', 15, 'Liquidator', 'v1.0', 3, 'live', '0x6217…33f3', 'Enforces a member’s pledges after an objective default: Savings, pledged bonds and pledged Pool Shares. Never touches Ready to allocate USDC. Pauses lengthen its clock.', 70, 53, 'c', 'R'),
  ('cc', 16, 'ClearCredit', 'v1.1', 2, 'live', '0x5923…82Bc', 'The co-op’s credit ledger, the deployable StableCredit. Only issuers mint. A shop’s positive balance here is what the co-op owes it.', 50, 40, 'c', 'CL'),
  ('ccp', 17, 'CLRUSDTokenPool', 'v1.0', 2, 'live', '0xd8a1…CCc1', 'The CCIP pool that bridges CLRUSD between chains.', 50, 53, 'c', 'CF'),
  ('cu', 18, 'ClearUSD', 'v1.1', 2, 'live', '0x2a11…D6D1', 'CLRUSD, upgradeable. Moves only between members; pledged balances stay locked. Bridges by CCIP.', 50, 66, 'c', 'CF'),
  ('ap', 19, 'AssurancePool', 'v2.0', 3, 'live', '0x3c33…BB15', 'The co-op’s Assurance contract, owned by Clear Collective: a Credit Backstop compartment and a Member Assurance compartment (Hardship Grants), each paid out by two people after a timelock. Never funds merchant payouts.', 70, 27, 'c', 'CO'),
  ('cp', 20, 'CreditPool', '—', 3, 'later', '—', 'In the repo, not deployed. Members deposit credit for others to draw.', 70, 33.5, 'c', ''),
  ('ce', 21, 'ClaimEscrow', 'v1.0', 3, 'live', '0x24DA…c37D', 'Holds USDC sent by link until it’s claimed or refunded.', 70, 40, 'c', 'CF'),
  ('pp', 22, 'PayoutPool', 'v0.9', 3, 'live', '0xb470…F861', 'Pays shops what the co-op owes them, on the schedule they were promised, oldest claim first. The AssurancePool never funds it.', 70, 46.5, 'c', 'CF'),
  ('esa', 23, 'ESADepositVault', 'v1.1', 3, 'live', '0x8364…413b', 'Member savings: CLRUSD backed 1:1 by USDC, held for holders in the ESA Reserve Trust. Counts California mints for the pilot cap; two people can pause new CA mints.', 70, 66, 'c', 'CF'),
  ('si', 24, 'SavingsIntent', 'v1.0', 3, 'live', '0xF807…b74B', 'One-transfer escrows that turn a deposit into savings.', 70, 72.5, 'c', 'CF'),
  ('lp', 25, 'LendingPool', 'v1.0', 4, 'live', '0x5840…ce23', 'The Earn Yield Pool (ERC-4626). Pool Shares are limited-recourse demand notes: Share Value is principal plus interest less realized losses, with a Loss Holdback on redemptions. Deploys only to Clear Lending’s lending account. Holds $9,000.00 from 18 depositors.', 90, 27, 'c', 'CL'),
  ('pse', 26, 'PoolShareEnforcer', 'v1.0', 4, 'live', '0xEB6f…4fa1', 'The pledge module’s pool-share side: tells CollateralRegistry when pledged Pool Shares may be enforced, and queues their redemption for the Liquidator.', 90, 40, 'c', 'R'),
  ('bb', 27, 'BurnerBond', 'v1.0', 4, 'live', '0xe7F6…cC2A', 'Zero-coupon bonds, one token each. A bond rolls only on its holder’s confirmation; a pledged bond pays its debt at no less than present value. 6 issued.', 90, 46.5, 'c', 'CL'),
  ('bv', 28, 'BondVault', 'v1.0', 4, 'live', '0x9f31…A855', 'Where bond proceeds live, behind a redemption reserve. Deployable excess goes only to Clear Lending’s treasury. Holds $25,000.00 for 6 bonds.', 90, 53, 'c', 'CL'),
  ('ca', 29, 'CollateralAgent', 'v1.0', 4, 'live', '0x4884…2825', 'The Agent Role in the BondVault exactly as IV-10 Exhibit A states it: enforcement notices and distributions for bondholders, nothing else.', 90, 59.5, 'c', 'AG'),
  ('hd', 30, 'HolderDirections', 'v1.0', 4, 'live', '0x8ec3…5Cda', 'Directions bondholders sign themselves, counted on-chain by Accreted Value, that instruct the Collateral Agent.', 90, 66, 'c', 'H'),
  ('ao', 31, 'AssuranceOracle', 'v1.0', 3, 'live', '0x2E52…Fe38', 'Retired. Section 13 removed it from the money path; nothing reads it now.', 0, 0, 'x', ''),
  ('vr', 32, 'ValidatorRegistry', 'v1.0', 0, 'live', '0x979E…bc91', 'Which validators may approve deeds, and for what.', 10, 85, 'd', 'OPS'),
  ('fcr', 33, 'FunctionalContractRegistry', '—', 0, 'later', '—', 'The functional contracts a trust deed may be deposited into under any transfer policy (trust agreement v5).', 10, 93, 'd', 'OPS'),
  ('va', 34, 'Validator', 'v1.0', 1, 'live', '0x18C5…79b9', 'Checks a deed’s title and papers before it’s minted. Made by the ValidatorFactory.', 30, 85, 'd', 'OPS'),
  ('mx', 35, 'MetadataRenderer', 'v1.0', 1, 'live', '0x849e…70E5', 'Renders a deed’s features, condition and legal details.', 30, 93, 'd', 'OPS'),
  ('dn', 36, 'DeedNFT', 'v1.1', 2, 'live', '0x1a4e…21E6', 'One token per property deed, with its traits, validation and trust agreement terms.', 50, 85, 'd', 'OPS'),
  ('sd', 37, 'Subdivide', 'v1.0', 2, 'live', '0x3c94…923F', 'Splits a deed into units, like lots or rooms.', 50, 93, 'd', 'OPS'),
  ('fz', 38, 'Fractionalize', 'v1.0', 3, 'live', '0xeC46…9823', 'Locks a deed or its units and issues shares against it.', 70, 85, 'd', 'OPS'),
  ('cta', 39, 'CoopTransferAgent', '—', 3, 'later', '—', 'The only route by which a Coop-policy trust deed changes hands, including Clear’s right of first refusal (trust agreement v5).', 70, 93, 'd', 'R'),
  ('ft', 40, 'FractionToken', 'v1.0', 4, 'live', '0x3E51…28dc', 'Shares in one property, made by the FractionTokenFactory.', 90, 85, 'd', ''),
  ('fm', 41, 'FundManager', 'v1.0', 4, 'live', '0x73ea…401e', 'Money around deeds: commissions and payouts.', 90, 93, 'd', 'OPS')
) AS v (id, position, name, version, layer, status, address, purpose, map_x, map_y, band, controller)
WHERE EXISTS (SELECT 1 FROM command.contracts)
ON CONFLICT (id) DO UPDATE SET
  position = EXCLUDED.position, name = EXCLUDED.name, version = EXCLUDED.version, layer = EXCLUDED.layer, status = EXCLUDED.status,
  address = EXCLUDED.address, purpose = EXCLUDED.purpose, map_x = EXCLUDED.map_x, map_y = EXCLUDED.map_y, band = EXCLUDED.band,
  controller = EXCLUDED.controller;

-- how they connect, traced from each contract's stored addresses: the old lines are replaced whole (nothing
-- refers to a line), only where the map was already written
DELETE FROM command.contract_links WHERE EXISTS (SELECT 1 FROM command.contracts);

INSERT INTO command.contract_links (position, from_id, to_id, kind, verb, label, label_side)
SELECT v.position, v.from_id, v.to_id, v.kind, v.verb, v.label, v.label_side::numeric
FROM (VALUES
  (0, 'ms', 'am', 'reads', 'checks members', '', NULL),
  (1, 'am', 'cc', 'reads', 'sets roles', NULL, NULL),
  (2, 'rs', 'ri', 'reads', 'prices and legal caps', '', NULL),
  (3, 'rs', 'ti', 'reads', 'prices and legal caps', NULL, NULL),
  (4, 'pc', 'lq', 'reads', 'lengthens grace and cure by paused time', NULL, NULL),
  (5, 'pc', 'ri', 'reads', 'lengthens grace by paused time', '', NULL),
  (6, 'pc', 'ti', 'reads', 'lengthens cure by paused time', NULL, NULL),
  (7, 'cu', 'pc', 'reads', 'pauses', NULL, NULL),
  (8, 'esa', 'pc', 'reads', 'pauses', NULL, NULL),
  (9, 'nr', 'ap', 'reads', 'lists the money paths it may pay', '', NULL),
  (10, 'nr', 'cr', 'reads', 'lists issuers', NULL, NULL),
  (11, 'nr', 'cc', 'reads', 'registers issuers', NULL, NULL),
  (12, 'ec', 'lp', 'reads', 'eligibility, limits and pauses', '', NULL),
  (13, 'ec', 'bb', 'reads', 'eligibility, Ladder and pauses', NULL, NULL),
  (14, 'ec', 'bv', 'reads', 'Reserve Shortfall and Equity Cushion', NULL, NULL),
  (15, 'ms', 'ec', 'reads', 'who is a member', NULL, NULL),
  (16, 'cr', 'lc', 'reads', 'pledges', 'pledges', NULL),
  (17, 'bvl', 'cr', 'reads', 'values bonds', '', NULL),
  (18, 'lc', 'ri', 'reads', 'limits', '', NULL),
  (19, 'ri', 'ti', 'reads', 'share the Combined Ceiling', NULL, NULL),
  (20, 'ri', 'cc', 'mint', 'mints credit', 'mints', NULL),
  (21, 'oi', 'cc', 'mint', 'mints the $10 offer', '', NULL),
  (22, 'ti', 'cc', 'mint', 'mints credit, with the fee leg to Clear Lending', '', NULL),
  (23, 'cc', 'pp', 'money', 'pays what the co-op owes shops', '', NULL),
  (24, 'mr', 'pp', 'reads', 'payout terms', 'terms', NULL),
  (25, 'cc', 'cp', 'reads', 'credit deposits', '', NULL),
  (26, 'esa', 'cu', 'mint', 'mints against USDC', 'mints', NULL),
  (27, 'si', 'esa', 'money', 'deposits', '', NULL),
  (28, 'cu', 'ccp', 'money', 'bridges by CCIP', '', NULL),
  (29, 'cr', 'cu', 'reads', 'locks pledged CLRUSD', NULL, NULL),
  (30, 'ms', 'cu', 'reads', 'members-only transfers', NULL, NULL),
  (31, 'lq', 'cu', 'money', 'enforces pledged CLRUSD', '', NULL),
  (32, 'lq', 'esa', 'reads', 'redeems', NULL, NULL),
  (33, 'lq', 'cc', 'reads', 'repays the member’s debt', NULL, NULL),
  (34, 'lq', 'bb', 'money', 'pays pledged bonds at present value', '', NULL),
  (35, 'lq', 'pse', 'money', 'queues pledged Pool Shares', '', NULL),
  (36, 'pse', 'lp', 'money', 'queued redemption', '', NULL),
  (37, 'pse', 'cr', 'reads', 'enforcement allowed', NULL, NULL),
  (38, 'bb', 'bv', 'money', 'bond proceeds', '', NULL),
  (39, 'bvl', 'bb', 'reads', 'present value', NULL, NULL),
  (40, 'ca', 'bv', 'reads', 'enforces for bondholders', '', NULL),
  (41, 'hd', 'ca', 'reads', 'holder directions', '', NULL),
  (42, 'vr', 'va', 'reads', 'lists validators', 'lists', NULL),
  (43, 'va', 'dn', 'reads', 'validates', 'checks', NULL),
  (44, 'mx', 'dn', 'reads', 'renders', '', NULL),
  (45, 'dn', 'sd', 'mint', 'splits into units', '', NULL),
  (46, 'dn', 'fz', 'money', 'locks deeds', 'locks', NULL),
  (47, 'sd', 'fz', 'money', 'locks units', '', NULL),
  (48, 'fz', 'ft', 'mint', 'issues shares', 'issues', NULL),
  (49, 'fm', 'dn', 'reads', 'commissions', NULL, NULL),
  (50, 'cta', 'dn', 'money', 'moves Coop-policy deeds', 'transfers', NULL),
  (51, 'fcr', 'dn', 'reads', 'functional contracts', NULL, NULL)
) AS v (position, from_id, to_id, kind, verb, label, label_side)
WHERE EXISTS (SELECT 1 FROM command.contracts)
ON CONFLICT (position) DO NOTHING;
