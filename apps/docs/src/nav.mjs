// The site map: sections, groups and page order. Ported from the design handoff's build/nav.mjs.
//
// Paths are relative to the repo root. An item is `path|Label` (the label is optional; without one
// the page's own title is used). Prefixes:
//   C:<id>|Label  a page drawn by hand in this app (src/lib/contract-map.mjs), not from markdown
//   L:<id>|Label  a sign-in-only link: shown with a lock, goes to the Command Center sign-in
//
// The build fails if a file named here is missing, or if a markdown file in a published folder
// (PUBLISHED below) is not named here — so the site can't silently drop or 404 a page.

export const SIGN_IN = 'https://command.useclear.org';
export const GITHUB = 'https://github.com/Deed3Labs/Protocol-Contracts';
export const GH_BLOB = `${GITHUB}/blob/dev/`;
export const GH_TREE = `${GITHUB}/tree/dev/`;

// Every markdown file under these folders must be in NAV. Files outside them are linked on GitHub.
export const PUBLISHED = [
  'docs/overview',
  'docs/members',
  'docs/merchants',
  'docs/contributors',
  'docs/investors',
  'docs/governance',
  'docs/developers',
  'docs/protocol',
  'docs/operators',
  'apps/member/public/docs',
];

export const NAV = [
  { id: 'overview', name: 'Overview', icon: 'M9 16A7 7 0 1 0 9 2a7 7 0 0 0 0 14zM9 8.5V13M9 5.2v.6', groups: [
    ['Start here', ['docs/overview/README.md|Introduction', 'docs/overview/what-clear-is.md', 'docs/overview/how-the-money-works.md', 'docs/overview/deeds-and-real-world-assets.md']],
    ['Reference', ['docs/overview/glossary.md', 'docs/overview/status-and-security.md']]] },
  { id: 'members', name: 'Members', icon: 'M9 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 15.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5', groups: [
    ['Getting started', ['docs/members/README.md|Introduction', 'docs/members/getting-started.md']],
    ['Money', ['docs/members/adding-and-moving-money.md', 'docs/members/savings-and-equity-credits.md', 'docs/members/credit.md', 'docs/members/sending-money.md', 'docs/members/paying-at-shops.md']],
    ['Cards', ['docs/members/cards.md', 'docs/members/clear-visa-card.md', 'docs/members/clear-card.md']],
    ['Protection and your home', ['docs/members/assurance-and-disputes.md', 'docs/members/clear-deed-and-membership.md']]] },
  { id: 'merchants', name: 'Merchants', icon: 'M3 7.5h12M3.5 7.5l1-4.5h9l1 4.5M4 7.5v8h10v-8M7.5 15.5V11h3v4.5', groups: [
    ['Getting started', ['docs/merchants/README.md|Introduction', 'docs/merchants/setting-up.md', 'docs/merchants/staff.md']],
    ['Every day', ['docs/merchants/taking-payments.md', 'docs/merchants/refunds-voids-disputes.md', 'docs/merchants/closing-the-day.md']],
    ['Money', ['docs/merchants/payouts.md']],
    ['Your shop', ['docs/merchants/settings-and-inventory.md', 'docs/merchants/clear-terminal.md', 'docs/merchants/rewards-and-online.md']]] },
  { id: 'land', name: 'Land contributors', icon: 'M2.5 15.5h13M9 15.5V8M9 10.5C9 8 7 6.5 3.8 6.5c0 2.7 2 4 5.2 4zM9 8c0-2.7 1.9-4.5 5.2-4.5 0 2.9-2 4.5-5.2 4.5z', groups: [
    ['Contributing', ['docs/contributors/README.md|Introduction', 'docs/contributors/how-contributing-works.md']],
    ['What you hold', ['docs/contributors/shares.md', 'docs/contributors/what-contributors-receive.md', 'docs/contributors/tax-basics.md']]] },
  { id: 'investors', name: 'Investors', icon: 'M3 15.5V10h3v5.5M7.5 15.5V6h3v9.5M12 15.5V2.5h3v13', groups: [
    ['Start here', ['docs/investors/README.md|Introduction', 'docs/investors/risks.md']],
    ['How it works', ['docs/investors/lending-pool.md', 'docs/investors/burner-bonds.md', 'docs/investors/what-stands-behind.md', 'docs/investors/on-chain-data.md']],
    ['Sign-in only', ['L:data-room|Data room', 'L:terms-room|Terms and agreements']]] },
  { id: 'governance', name: 'Governance', icon: 'M2.5 15.5h13M4 13V8M7.5 13V8M10.5 13V8M14 13V8M2.5 8h13L9 3z', groups: [
    ['Structure', ['docs/governance/README.md|Introduction', 'docs/governance/structure.md', 'docs/governance/membership.md']],
    ['Rules and keys', ['docs/governance/parameters.md', 'docs/governance/on-chain-authority.md', 'docs/governance/command-center.md']]] },
  { id: 'developers', name: 'Developers', fold: true, icon: 'M6.5 5L2.5 9l4 4M11.5 5l4 4-4 4', groups: [
    ['Pay with Clear', ['apps/member/public/docs/quickstart.md|Quickstart', 'apps/member/public/docs/server.md|Server', 'apps/member/public/docs/webhooks.md|Webhooks', 'apps/member/public/docs/mcp.md|MCP server', 'apps/member/public/docs/api.md|API reference']],
    ['This repository', ['docs/developers/README.md|Introduction', 'docs/developers/setup.md', 'docs/developers/merchant-privy-orgs.md', 'docs/developers/api/local-redis.md', 'docs/developers/api/testing.md', 'docs/developers/integrations/lithic.md']]] },
  { id: 'protocol', name: 'Protocol', fold: true, icon: 'M9 2.5l5.5 3.2v6.6L9 15.5l-5.5-3.2V5.7zM3.5 5.7L9 9l5.5-3.3M9 9v6.5', groups: [
    ['Reference', ['C:protocol/contract-map|Contract map', 'docs/protocol/contracts/README.md|All contracts']],
    ['Contracts', ['docs/protocol/contracts/AccessManager.md', 'docs/protocol/contracts/AssuranceOracle.md', 'docs/protocol/contracts/AssurancePool.md', 'docs/protocol/contracts/BondValuer.md', 'docs/protocol/contracts/BondVault.md', 'docs/protocol/contracts/BurnerBond.md', 'docs/protocol/contracts/BurnerBondDeposit.md', 'docs/protocol/contracts/BurnerBondFactory.md', 'docs/protocol/contracts/CLRUSDTokenPool.md', 'docs/protocol/contracts/ClaimEscrow.md', 'docs/protocol/contracts/ClearCredit.md', 'docs/protocol/contracts/ClearUSD.md', 'docs/protocol/contracts/ClearUSDUpgradeable.md', 'docs/protocol/contracts/CollateralRegistry.md', 'docs/protocol/contracts/Create2Deployer.md', 'docs/protocol/contracts/DeedNFT.md', 'docs/protocol/contracts/ESADepositVault.md', 'docs/protocol/contracts/FractionTokenFactory.md', 'docs/protocol/contracts/Fractionalize.md', 'docs/protocol/contracts/FundManager.md', 'docs/protocol/contracts/LendingPool.md', 'docs/protocol/contracts/LimitCalculator.md', 'docs/protocol/contracts/Liquidator.md', 'docs/protocol/contracts/MembershipRegistry.md', 'docs/protocol/contracts/MerchantRegistry.md', 'docs/protocol/contracts/MetadataRenderer.md', 'docs/protocol/contracts/NetworkRegistry.md', 'docs/protocol/contracts/OffersIssuer.md', 'docs/protocol/contracts/PayoutPool.md', 'docs/protocol/contracts/RevolvingIssuer.md', 'docs/protocol/contracts/SavingsIntentFactory.md', 'docs/protocol/contracts/Subdivide.md', 'docs/protocol/contracts/TermIssuer.md', 'docs/protocol/contracts/TokenRegistry.md', 'docs/protocol/contracts/Validator.md', 'docs/protocol/contracts/ValidatorRegistry.md']],
    ['How it works', ['docs/protocol/README.md|Introduction', 'docs/protocol/savings.md', 'docs/protocol/credit.md', 'docs/protocol/settlement.md', 'docs/protocol/visa-card-purchases.md', 'docs/protocol/reserve.md', 'docs/protocol/bonds.md']],
    ['Design', ['docs/protocol/clear-contracts-build-plan.md', 'docs/protocol/clear-card-design.md', 'docs/protocol/refund-repayment-plan.md', 'docs/protocol/token-registry.md']],
    ['Deed track', ['docs/protocol/deed-track/protocol-overview.md', 'docs/protocol/deed-track/smart-contracts.md', 'docs/protocol/deed-track/validation-system.md', 'docs/protocol/deed-track/asset-workflows.md', 'docs/protocol/deed-track/subdivision.md', 'docs/protocol/deed-track/fractionalization.md', 'docs/protocol/deed-track/metadata-renderer.md']],
    ['Deed asset types', ['docs/protocol/deed-track/assets/land-assets.md', 'docs/protocol/deed-track/assets/vehicle-assets.md', 'docs/protocol/deed-track/assets/estate-assets.md', 'docs/protocol/deed-track/assets/commercial-equipment.md']]] },
  { id: 'operators', name: 'Operators', icon: 'M2.5 3.5h13v4.5h-13zM2.5 10h13v4.5h-13zM5.5 5.7v.1M5.5 12.2v.1', groups: [
    ['Running it', ['docs/operators/README.md|Introduction', 'docs/operators/going-live.md', 'docs/operators/deploying-contracts.md|Deploying the contracts', 'docs/operators/clrusd-esa-bootstrap.md|Issuing CLRUSD', 'docs/operators/api-deploy.md|Deploying the API', 'docs/operators/command-center-live-switches.md']]] },
  // Staff docs live behind the Command Center sign-in. Nothing of them is published here: the section
  // is one locked link.
  { id: 'staff', name: 'Staff', locked: true, icon: 'M9 2.5l5.5 2v4.5c0 3.2-2.3 5.5-5.5 6.5-3.2-1-5.5-3.3-5.5-6.5V4.5z', groups: [] },
];

// The home grid: one door per section, with a note and three links. From the design.
export const DOORS = [
  ['overview', 'What Clear is and how the money works.', ['overview/what-clear-is', 'overview/how-the-money-works', 'overview/deeds-and-real-world-assets']],
  ['members', 'Using the member app.', ['members/getting-started', 'members/savings-and-equity-credits', 'members/credit']],
  ['merchants', 'Running a shop on Clear.', ['merchants/setting-up', 'merchants/taking-payments', 'merchants/payouts']],
  ['land', 'Contributing property, and what you hold after.', ['contributors/how-contributing-works', 'contributors/shares', 'contributors/tax-basics']],
  ['investors', 'How contributed money moves, and what can go wrong.', ['investors/lending-pool', 'investors/what-stands-behind', 'investors/risks']],
  ['governance', 'Who decides what. Other sections link here.', ['governance/structure', 'governance/parameters', 'governance/on-chain-authority']],
  ['developers', 'Pay with Clear, the API, and running Clear locally.', ['pay/quickstart', 'pay/api', 'developers/setup']],
  ['protocol', 'The contracts, including the Deed track.', ['protocol/contract-map', 'protocol/contracts', 'protocol/settlement']],
  ['operators', 'Deploying, upgrading and running it.', ['operators/going-live', 'operators/deploying-contracts', 'operators/api-deploy']],
];
// Labels the home grid uses instead of the nav label.
export const DOOR_LABELS = { 'pay/quickstart': 'Pay with Clear quickstart', 'pay/api': 'API reference' };

// What each governance page settles, for "Who decides this" on pages that link to one.
export const GOV_NOTES = {
  'governance/membership': 'Who is a member, and what the plans are',
  'governance/parameters': 'Where each number lives and who can change it',
  'governance/on-chain-authority': 'Who holds which keys',
  'governance/command-center': 'Access levels and the two-person rule',
  'governance/structure': 'Entities, boards and reserved matters',
  governance: 'How the co-op decides',
};

// Shown in search before anything is typed.
export const SUGGESTED = ['overview/what-clear-is', 'members/getting-started', 'merchants/taking-payments', 'protocol/contract-map', 'pay/quickstart'];

// Pages laid out full width: no right-hand contents column. The structure page puts its contents
// above the body as chips instead.
export const WIDE = ['protocol/contract-map', 'governance/structure'];
export const CHIPS = ['governance/structure'];
