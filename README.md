# Clear

Monorepo for **CLEAR** — a fintech app and financial co-op built to turn renters into owners — and
for its **Deed track**, the open-source real-world-asset layer underneath it.

The Solidity protocol, five web apps — member, merchant, pay, rewards and the Command Center — and
the API they all talk to, on one chain.

[System](#what-the-system-is) · [Layout](#repository-layout) · [Quickstart](#quickstart) ·
[Contracts](#the-on-chain-layer) · [Addresses](#deployed-addresses) · [Tooling](#contract-tooling) ·
[API](#the-api-appsapi) · [Member](#the-member-app-appsmember) · [Merchant](#the-merchant-app-appsmerchant) ·
[Pay, rewards, command](#pay-rewards-and-the-command-center) · [Licensing](#licensing) · [Docs](#documentation)

> ⚠️ **Status: alpha, developer preview.** The contracts are deployed on Base Sepolia and partly on
> Base, and they are **unaudited**. Interfaces still move. Do not put real money behind them without
> an independent security review and operational hardening.

---

## What the system is

Deposit USDC, get CLRUSD 1:1 — liquid savings, redeemable any time. That balance backs a credit
line and, separately, accrues **equity credits** that can only ever be spent on a home. Members pay
partner merchants, tap a Clear card, or send to each other. The home itself is a T-Deed.

```mermaid
flowchart LR
  USDC["USDC"] -->|"ESADepositVault<br/>mints 1:1"| CLR["CLRUSD<br/><i>savings, redeemable</i>"]
  CLR --> CEIL["Credit ceiling<br/><i>tiered, collateral-backed</i>"]
  CLR --> EQ["Equity credits<br/><i>never redeemable</i>"]
  CEIL --> SPEND["Spend at a partner,<br/>on a card, or peer to peer"]
  EQ --> DEED["T-Deed<br/><i>the home</i>"]
```

Two mechanics to know before reading the contract code.

**CLRUSD and the credit ledger are separate tokens, deliberately.** CLRUSD is money, fully reserved
against deposited USDC. `ClearCredit` is a signed per-member balance — an obligation ledger, not a
pot of money. Merge them and CLRUSD is backed partly by USDC and partly by somebody's promise.

**A purchase is a three-party mint that nets to zero.** Nobody lends anything at origination, so
origination is capital-free. Liquidity is needed only at redemption, when a merchant converts a
positive balance to USDC.

```mermaid
flowchart LR
  M["Member<br/><b>−100</b>"] --> L{{"one mint,<br/>nets to zero"}}
  L --> R["Merchant<br/><b>+97</b>"]
  L --> C["Co-op<br/><b>+3</b> discount"]
```

Both are argued out in [`docs/protocol/clear-contracts-build-plan.md`](./docs/protocol/clear-contracts-build-plan.md).

---

## Repository layout

npm workspaces + Turborepo. Each app under `apps/` is its own deploy target with its own root
directory. `apps/api` is the exception to the workspace: it installs on its own, with Bun, and links
the packages it needs with `file:`.

```
apps/
  member/           consumer PWA                     @clear/member     Vite + React 19
  merchant/         counter app, web + Capacitor     @clear/merchant   Vite + React 19
  pay/              Pay with Clear: links + checkout @clear/pay        Vite + React 19
  rewards/          shop loyalty app + rewards hub   @clear/rewards    Vite + React 19
  command/          the Command Center               @clear/command    Vite + React 19
  api/              Express on Bun                   @clear/api        Docker → Railway
packages/
  domain/                charge lifecycle, split + carry math, money formatting, roles, shared types
  tokens/                color, type scale, spacing, radii
  member-kit/            components, CSS and onboarding shared by member and rewards
  merchant-contracts/    zod schemas and the MerchantApi interface, shared by api, merchant, rewards, pay
  public-api-contracts/  the public /v1 API: schemas, endpoints, versions and published snapshots
  command-types/         Command Center shapes, figures and seed fixtures
  pay-docs/              generates the public developer docs and llms.txt from the two above
  clear-js/              @useclear/js — the browser "Pay with Clear" script
  clear-node/            @useclear/node — the server SDK for /v1
  clear-mcp/             @useclear/mcp — an MCP server for a shop's agent
  contracts-sdk/         generated ABIs, addresses and read helpers — generated output only (empty so far)
contracts/          Solidity (AGPL-3.0 — see NOTICE.md)
deploy/             numbered Hardhat deploy scripts, upgrade + verification tooling
deployments/        deployed addresses and ABIs, by network
scripts/            operational scripts — role grants, upgrades, registry configuration
test/               Hardhat suites
docs/               documentation by audience — overview, members, merchants, investors, governance,
                    developers, protocol, operators — plus design references and the archive
```

### One state machine, two ends

The merchant's "waiting" screen is the member's approval screen, unopened. Anything both must agree
on is computed once in `packages/domain` — which is why the reference figures live there as unit
tests. **If the two apps ever disagree on a number for the same charge, that package is wrong.**

```mermaid
flowchart TD
  MEM["Member app<br/><code>apps/member</code>"] --> API["API<br/><code>apps/api</code>"]
  MER["Merchant app<br/><code>apps/merchant</code>"] --> API
  MEM -.->|"charge math, money,<br/>shared types"| DOM(["packages/domain"])
  MER -.-> DOM
  API -.-> DOM
  API --> CH["Base · Base Sepolia<br/><code>contracts/</code>"]
  MEM --> CH
```

No component library shared between the counter and the phone, deliberately: a tablet counter app
and a consumer phone app are different products, and tokens and formatters are all they share.
`member-kit` is shared only between member and rewards, which are the same kind of app.

### Deploy targets

| Target | Root directory | Host |
|---|---|---|
| member | `apps/member` | `app.useclear.org` |
| member (demo) | `apps/member` | `demo.useclear.org` |
| merchant | `apps/merchant` | `merchant.useclear.org` |
| pay | `apps/pay` | `pay.useclear.org`, and `js.useclear.org` for the script |
| rewards | `apps/rewards` | `rewards.useclear.org`, and each shop's app at `useclear.org/s/:slug` |
| command | `apps/command` | `command.useclear.org` |
| api | `apps/api` | Railway (Docker) |

`main` is production and `dev` is the working branch; pull requests go to `dev`.

**Auth sessions do not cross the two surfaces.** Different auth models, no cookie scoped to
`.useclear.org`, neither app reads the other's storage.

> Vercel's root directory is a dashboard setting, not a repo file. Merchant builds from the
> workspace root (`apps/merchant/vercel.json`); member's root must point at `apps/member`.

---

## Quickstart

Requires **Node ≥ 20.19** (CI runs 22). The API runs on **Bun**. The full version — every `.env`,
the checks to run before pushing — is [`docs/developers/setup.md`](./docs/developers/setup.md).

```bash
npm install          # installs every workspace from the repo root — not apps/api
cp .env.example .env # RPC URLs + deployer key for Hardhat
npm run compile
npm run test
```

Then run whichever surface you need. Each app has its own `.env.example`.

```bash
npm run dev --workspace @clear/member     # http://localhost:5173
npm run dev --workspace @clear/merchant   # http://localhost:5174
npm run dev --workspace @clear/rewards    # http://localhost:5190
npm run dev --workspace @clear/pay        # http://localhost:5195
npm run dev --workspace @clear/command    # http://localhost:5230
cd apps/api && bun install && cp env.example .env && bun run dev   # http://localhost:3001
```

Turborepo drives everything across the workspace:

```bash
npm run build        # turbo run build
npm run typecheck
npm run lint
npm run test:apps
npm run build:member # or build:merchant, filtered
```

Before pushing, run `npx turbo run typecheck test --affected`; the `ci` check on a pull request is
what blocks a merge. [`CLAUDE.md`](./CLAUDE.md) covers which pushes start a Vercel build.

---

## The on-chain layer

### Deed track — real-world assets

| Contract | Role |
|---|---|
| `DeedNFT.sol` | Upgradeable ERC-721 T-Deed with trait storage and transfer policy controls |
| `Validator.sol` | Validation criteria, service fees, token whitelist, royalties, agreement handling |
| `ValidatorRegistry.sol` | Validator registration, status, role propagation |
| `FundManager.sol` | Validator fee accounting, commission routing, T-Deed compatibility |
| `MetadataRenderer.sol` | Trait-aware metadata, document and feature composition |
| `Subdivide.sol` | ERC-1155 units for Land/Estate subdivision, with unit-level validation |
| `Fractionalize.sol` + `FractionToken.sol` + `FractionTokenFactory.sol` | Asset lock/unlock and clone-deployed ERC-20 shares |

### Money — savings and settlement

| Contract | Role |
|---|---|
| `ClearUSD.sol` / `ClearUSDUpgradeable.sol` | CLRUSD, 6 decimals, Chainlink burn/mint ERC-20 (the upgradeable one is UUPS) |
| `ESADepositVault.sol` | The Equity Savings Account: USDC in, CLRUSD out 1:1, redeemable |
| `SavingsIntentFactory.sol` / `SavingsIntentEscrow.sol` | Gasless deposit intents, relayer-settled |
| `ClaimEscrow.sol` | USDC escrow for link-based send: sender lock, settler claim, expiry refund |

### Credit

**The waterfall is not four accounts — it is one balance with a tiered ceiling.** `ClearCredit`
answers what the balance and the ceiling are; the issuers answer what the ceiling is made of.

```mermaid
flowchart LR
  V["ESADepositVault"] -->|"mints"| U["CLRUSD"]
  U --> CR["CollateralRegistry"]
  CR --> LC["LimitCalculator<br/><i>haircuts → ceiling</i>"]
  LC --> RI["RevolvingIssuer<br/><i>tiers</i>"]
  OPS["Operator<br/><i>attested income</i>"] -->|"setTermLimit"| TI["TermIssuer<br/><i>plans</i>"]
  RI --> CC["ClearCredit<br/><b>the ledger</b>"]
  TI --> CC
  OI["OffersIssuer<br/><i>new-member offers</i>"] --> CC
  CC --> PP["PayoutPool"] --> OUT["Merchant USDC"]
  CC -->|"repayments beyond payables"| CLO["Clear Lending"]
  LP["LendingPool"] -->|"Deployments"| CLO
  CLO -->|"payout top-ups"| PP
  CC -.->|"after default"| LQ["Liquidator"] -.->|"seizes pledged savings"| V
```

| Contract | Role |
|---|---|
| `ClearCredit.sol` | The deployable ledger — the concrete form of `StableCredit` / `MutualCredit` |
| `CreditIssuer.sol` | Base underwriting: periods, compliance, default and write-off controls |
| `RevolvingIssuer.sol` | The tiered line — savings, asset, income, Boost. Cheapest-first; carry accrues per second, simple, per tier. Cycles, dues, Automatic Clearing and card settlement |
| `TermIssuer.sol` | Term plans — partner credit, Clear Cash, ELPA. Per-plan rate and clock, level split schedules, and Clear Lending's fee leg |
| `CollateralRegistry.sol` | What each member has pledged, and where it sits |
| `LimitCalculator.sol` | Values collateral, applies haircuts, emits the tiered ceiling |
| `OffersIssuer.sol` | A capped line that gives each new member a one-time offer. Unspent offers expire; the Safe pays the line down. Not counted as exposure |
| `LendingPool.sol` | The lending pool on Earn (Phase 2f), an ERC-4626 vault of Pool Shares. Deploys only to Clear Lending, as two-person Deployments or through the settlement lane; holders earn Pool Interest at the Funding Rate; withdrawals queue first in, first out. Direct borrowing is retired |
| `Liquidator.sol` | Once a member has defaulted, seizes the savings or pool shares they pledged and settles their debt with it |
| `CreditPool.sol` | Legacy queued deposit/withdraw. No deploy script uses it |
| `AccessManager.sol` | Admin / operator / member authority boundaries |
| `MembershipRegistry.sol`, `NetworkRegistry.sol` | Membership, and issuer → ledger, member → issuers, and the money-path list the AssurancePool refuses deposits from |
| `RateSchedule.sol` | Credit products, listed rates and legal caps, by state |

> Two credit lines, and confusing them breaks approvals. `TermIssuer.termLimitOf` is the ceiling a
> **split plan** draws against, underwritten off-chain against attested income. The **revolving
> tiers** are a different line, backed by pledged collateral. Summing tiers to quote a plan promises
> room the plan cannot use.

### Merchant settlement

| Contract | Role |
|---|---|
| `MerchantRegistry.sol` | Per-merchant terms: payout schedule, approval cap, discount rate, status |
| `PayoutPool.sol` | Funds merchant redemptions at par, earliest deadline first, and reports its own shortfall. Paid from members' repayments, funders' capital, Clear Lending's top-ups and the treasury allowance. Nothing lends to it, and the AssurancePool never reaches it |
| `SettlementForwarder.sol` | Clear Lending's operating Safe delegate that forwards Settlement Funding to the card settlement off-ramp |

A merchant's positive balance **is** the payables ledger — what the co-op owes them, on-chain, with
no parallel off-chain record. A merchant carrying credit of their own is paid by drawdown first;
only the surplus is redeemable.

### Reserve and Earn

| Contract | Role |
|---|---|
| `AssurancePool.sol` | The co-op's Assurance contract (v2, Phase 2c, deployed as `AssurancePoolV2`): a Credit Backstop for Clear Lending's charged-off principal and a Member Assurance compartment for member grants, each with its own ledger. Two signers for everything, a 7-day timelock for parameters. Lends nothing, and no money path reaches it |
| `TokenRegistry.sol` | Token whitelist read by validators, fee collection and the bond factory; stablecoin metadata, chain mappings and fallback prices for off-chain clients |
| `BurnerBond.sol` (with `BurnerBondIssue`, `BurnerBondPledges`), `BurnerBondFactory.sol` | ERC-1155 zero-coupon bond collections (Phase 2f): sold by signed quote at the Ladder's rate, valued at Accreted Value, settled at maturity, rolled only on the holder's confirmation |
| `EarnControls.sol`, `CollateralAgent.sol`, `HolderDirections.sol`, `PoolShareEnforcer.sol` | Shared Earn rules (eligibility, caps, pauses, transfers); the bond collateral agent; bond holders' signed directions; enforcement of pledged pool shares |
| `BondVault.sol`, `BondValuer.sol`, `BondTraits.sol` | Where bond proceeds live — not the AssurancePool — with a derived Redemption Reserve (glide reserve and a 90-day window); what a pledged bond is worth |

### Libraries

`CarryIndex` (each tier's and plan's rate and cycle length), `ExposureMath`,
`JSONUtils`, `StringUtils`, `TickMath`.

### Standards and patterns

- ERC-721, ERC-1155, ERC-20, ERC-2981, ERC-4626
- UUPS and transparent proxies where applicable; `.openzeppelin/` tracks the upgradeable ones
- RBAC, pausability, reentrancy protection on every value-moving path
- Trait-driven metadata with structured document and feature fields

---

## Deployed addresses

Artifacts live in `deployments/<network>/<Contract>.json` alongside their ABIs.

<details>
<summary><b>Base Sepolia</b> — the working network (56 contracts)</summary>


Each contract's page in the [contract reference](docs/protocol/contracts/README.md) lists its functions and who can call them.

| Contract | Address |
|---|---|
| [AccessManager](docs/protocol/contracts/AccessManager.md) | `0x23aF9715761156C24C2de3666587753168f28DBe` |
| [AssurancePoolV2](docs/protocol/contracts/AssurancePoolV2.md) | `0x3c334D3AeD134191B7Ad0744a23978D71357BB15` |
| [AssuranceTimelock](docs/protocol/contracts/AssuranceTimelock.md) | `0xE77F3C4B94Fa25A021f3Ef8d0E5D06F4Ea057C6b` |
| [BondValuer](docs/protocol/contracts/BondValuer.md) | `0x7f63e01B1BBd79509138D825B5Ef4b186E9502C8` |
| [BondVault](docs/protocol/contracts/BondVault.md) | `0x9f311Fd8F05Ed517130dC044cDdBb159d02bA855` |
| [BurnerBond](docs/protocol/contracts/BurnerBond.md) | `0xe7F6d3E21189e8B6a73f6dee0955322b7a32cC2A` |
| [BurnerBondFactory](docs/protocol/contracts/BurnerBondFactory.md) | `0xf36dE3553509BAafB835bC37c97f529Adf42a96a` |
| [ClaimEscrow](docs/protocol/contracts/ClaimEscrow.md) | `0x24DAE7b66dC31657265260B5d9092280B57Bc37D` |
| [ClearCredit](docs/protocol/contracts/ClearCredit.md) | `0x5923e02EdFb6724a08A28B79C902b40c748082Bc` |
| [ClearUSD](docs/protocol/contracts/ClearUSD.md) | `0x56195066D4ada8D371254061047f76FA2BBd0Ae3` |
| [ClearUSDUpgradeable](docs/protocol/contracts/ClearUSDUpgradeable.md) | `0x2a116Bead17dd96DC5c560A0d76b02eb2D7aD6D1` |
| [CLRUSDTokenPool](docs/protocol/contracts/CLRUSDTokenPool.md) | `0xd8a171c293969E8b97EFE1a9dA7742205e23CCc1` |
| [CollateralAgent](docs/protocol/contracts/CollateralAgent.md) | `0x48840620F9F4780e7d5986F6365A4acdD7D82825` |
| [CollateralRegistry](docs/protocol/contracts/CollateralRegistry.md) | `0xfeDb873e6e1ec1C3BFC8cD561F66bd64D51C446A` |
| [CoopTransferAgent](docs/protocol/contracts/CoopTransferAgent.md) | `0x8803f70f83D624D26935B03CfcAfbeAAf66a766A` |
| [Create2Deployer](docs/protocol/contracts/Create2Deployer.md) | `0x2BFba336A1B5E79E4717CA00677C65DDCa63cB06` |
| [CreditsAccessManager](docs/protocol/contracts/CreditsAccessManager.md) | `0x2b85D9649d8aC4502Cbacdeb0541E77Bd78965be` |
| [CreditsLedger](docs/protocol/contracts/CreditsLedger.md) | `0x6a46c688F0D84cB6c8e66D7E9546e2A236bAD3d5` |
| [CreditsMerchantRegistry](docs/protocol/contracts/CreditsMerchantRegistry.md) | `0x67AC0a3b927b2A43FA76827DA3074B33f7fe3700` |
| [CreditsNetworkRegistry](docs/protocol/contracts/CreditsNetworkRegistry.md) | `0xa204AB2bF9aaBCe38389051109Fdf22C37D8e545` |
| [CreditTimelock](docs/protocol/contracts/CreditTimelock.md) | `0x39411C23825844c4B14ad964a661d1Cb8238d330` |
| [DeedNFT](docs/protocol/contracts/DeedNFT.md) | `0x1a4e89225015200f70e5a06f766399a3de6e21E6` |
| [EarnControls](docs/protocol/contracts/EarnControls.md) | `0xe4a7eF8BaF868264F9C4aF0b95342b683764cD97` |
| [EarnTimelock](docs/protocol/contracts/EarnTimelock.md) | `0xB3788Bca237F5FFDf1BCB6698066AB6Ff82C7911` |
| [ESADepositVault](docs/protocol/contracts/ESADepositVault.md) | `0x836401Ed3e2bF7CAb5e2721188E74B834511413b` |
| [Fractionalize](docs/protocol/contracts/Fractionalize.md) | `0x6C896EeE9D3c6984a6B0225B0c17c9Df914Fbd76` |
| [FractionTokenFactory](docs/protocol/contracts/FractionTokenFactory.md) | `0xc7E3234E058cc7793Ac68F471c09693f14cb166E` |
| [FunctionalContractRegistry](docs/protocol/contracts/FunctionalContractRegistry.md) | `0xAAb503A7ccd33CBD1FC7e669D6FAAdfF3a923c5C` |
| [FundManager](docs/protocol/contracts/FundManager.md) | `0xe5E038A44DaAfE88fA20902489E4308ADD72e453` |
| [HolderDirections](docs/protocol/contracts/HolderDirections.md) | `0x8ec35b88CCb59576957917a4F4B937b491815Cda` |
| [HousingAllowanceRecord](docs/protocol/contracts/HousingAllowanceRecord.md) | `0x26D8540881249bcD253810aBC2242b5a572729B5` |
| [LendingPool](docs/protocol/contracts/LendingPool.md) | `0x58405326b66888d8a9f2Dc4646cAc2F5EaC7ce23` |
| [LendingPoolSettlementLane](docs/protocol/contracts/LendingPoolSettlementLane.md) | `0xeccfDDCac073a657CFB94D3Ff9f22997e7EcBAbD` |
| [LimitCalculator](docs/protocol/contracts/LimitCalculator.md) | `0x6C0859EcD05C6BB604c91B9De1CAf04724744a20` |
| [Liquidator](docs/protocol/contracts/Liquidator.md) | `0x621784117C037b3D20AF54e04589818e919e33f3` |
| [MembershipRegistry](docs/protocol/contracts/MembershipRegistry.md) | `0xE7009eE28a71d8D593Cb57C48E1e648A9fB44dE8` |
| [MerchantRegistry](docs/protocol/contracts/MerchantRegistry.md) | `0x8f4C6f9472359BF749c12C840c4269341a423c1b` |
| [MetadataRenderer](docs/protocol/contracts/MetadataRenderer.md) | `0xC565a69A41b98482B437eB4182051196278EC240` |
| [NetworkRegistry](docs/protocol/contracts/NetworkRegistry.md) | `0xee10a0d79a718cd13c49b68ce6ccCda398781164` |
| [OffersIssuer](docs/protocol/contracts/OffersIssuer.md) | `0x52EDD619B18D537B4c880d6Ff0925891ea05Edb1` |
| [PauseClock](docs/protocol/contracts/PauseClock.md) | `0x794Acc0c1BD0effaa7B413F60C5B56F60A229959` |
| [PayoutPool](docs/protocol/contracts/PayoutPool.md) | `0xb4704046d1fA6C3F78DcBB60b40A9D1cdD9fF861` |
| [PointsIssuer](docs/protocol/contracts/PointsIssuer.md) | `0xd254Bd2C78791a666eEfC4A7B6163d5d47C842a3` |
| [PoolShareEnforcer](docs/protocol/contracts/PoolShareEnforcer.md) | `0xEB6f2c654d078Df56D78946767d5A43307eb4fa1` |
| [RateSchedule](docs/protocol/contracts/RateSchedule.md) | `0xdb73Ae35D0A22A4CA6bc03F263CF006D16a28b97` |
| [RedemptionAgent](docs/protocol/contracts/RedemptionAgent.md) | `0xBbBdf1302ED3Ef7861D757eAC28AcEEa019FAB84` |
| [RevolvingIssuer](docs/protocol/contracts/RevolvingIssuer.md) | `0xBec598bee24cF2973d42eA85e6028621180fE2F0` |
| [RevolvingIssuerCardFee](docs/protocol/contracts/RevolvingIssuerCardFee.md) | `0x7eDe0306a079cc473DD8298C6bCe727e2497d71f` |
| [SavingsIntentFactory](docs/protocol/contracts/SavingsIntentFactory.md) | `0xF8074182d9ec61970bBC9E4aaE182B42dF7Bb74B` |
| [SettlementForwarder](docs/protocol/contracts/SettlementForwarder.md) | `0x0343a5C0eD485B82487DDCFdE0021133B5d5f46c` |
| [Subdivide](docs/protocol/contracts/Subdivide.md) | `0xfB54f5F05d63FF80Bc94d5810321355c4Ee30f60` |
| [TermIssuer](docs/protocol/contracts/TermIssuer.md) | `0x1b1695353f14E889906237D9b9C386eD0393da57` |
| [TokenRegistry](docs/protocol/contracts/TokenRegistry.md) | `0x4B13b49167941d128DB56008AdfDac805f868a86` |
| [Validator](docs/protocol/contracts/Validator.md) | `0x5036ca87256f7526Fc2374dD2Bf8697e4Cd98f9A` |
| [ValidatorRegistry](docs/protocol/contracts/ValidatorRegistry.md) | `0x9E5c7D64bF3EB1fa3B7338608bbBD30ae64717ec` |
| [VaultTimelock](docs/protocol/contracts/VaultTimelock.md) | `0xb49c85E8E7eFB4401aaAb2745C9198a239071994` |

23 older records (names ending in `PreAudit`, `Pre2d`, `Pre2f`, `Legacy` or `V1`) are kept in `deployments/base-sepolia/` for history. They are retired and replaced by the contracts above. So are `AssurancePool` (`0xf5E4…5840`) and `AssuranceOracle` (`0x2E52…Fe38`), the Phase 1 reserve, and `BurnerBondDeposit` (`0xA030…dB8c`), a record left under the retired bond deposit contract's name.
`LendingPoolSettlementLane` and `RevolvingIssuerCardFee` are prepared `LendingPool` and `RevolvingIssuer` implementations that their proxies do not run yet.

</details>

<details>
<summary><b>Base</b> — savings and send rails only</summary>


| Contract | Address |
|---|---|
| ClearUSD | `0xa7a257f411e4Fe98e1D1FaA36C84B864c3336583` |
| ESADepositVault | `0x0CfE6aFB053474cE4Ff744a1fe864C82c173a1C1` |
| ClaimEscrow | `0xb30E97FEd437bf89B122693D26338C8D64515096` |
| Create2Deployer | `0xF313b7b748691e778cAaBD1dDF8e8dca7bD33c21` |

</details>

<details>
<summary><b>Ethereum Sepolia</b> — CLRUSD cross-chain only</summary>


| Contract | Address |
|---|---|
| ClearUSD | `0x54Dd3449Eb54adC02C33cD880178BfA718991753` |
| CLRUSDTokenPool | `0x7ec282D0501407f52ce2099BFa5d76AAc1f4890d` |
| Create2Deployer | `0xc54dA54b0BDa1BAfE279cc61Ade42ac73A6D2023` |

</details>

The credit stack is **not** on mainnet. Base carries the savings and send rails only.

---

## Contract tooling

### Tests

```bash
npm run test              # everything
npm run test:core         # test/core
npm run test:esa-vault    # a single suite
npm run test:coverage
npm run test:gas
```

| Area | Suites |
|---|---|
| Deed track | `DeedNFT`, `Validator`, `ValidatorRegistry`, `FundManager`, `MetadataRenderer` |
| Credit | `StableCredit`, `StableCreditIssuers`, `RevolvingIssuer`, `TermIssuer`, `OffersIssuer`, `LimitCalculator`, `CollateralRegistry`, `LendingPool`, `Liquidator`, `PayoutPool`, `MembershipRegistry`, `NetworkRegistry` |
| Credit invariants | `FirstLossOrdering`, `RepaymentRouting`, `IncomeToDebt`, `AssetBackedDefault`, `AssetBackedTier`, `SharedBalance`, `PayoutLifecycle` |
| Savings + settlement | `ESADepositVault`, `SavingsIntentFactory`, `ClearUSDUpgradeable`, `ClaimEscrow` |
| Bonds | `BurnerBond`, `BondVault`, `BondCollateral`, `BondBackstop`, `BondSeniority` |
| Deploy | `CreditCore.deploy` — the credit stack deploys and wires cleanly |
| Reserve | `AssurancePool` (v2) |
| Libraries | `CarryIndex`, `ExposureMath` |

### Deployment

The `deploy/` scripts are numbered `00`–`28` and run in order; `deploy/deploy_all.ts` deploys the
Deed track — the contracts of `00`–`06` — in one run.

```bash
npx hardhat run deploy/deploy_all.ts --network base-sepolia   # Deed track

npm run deploy:token-registry     -- base-sepolia
npm run deploy:assurance-pool     -- base-sepolia
npm run deploy:assurance-oracle   -- base-sepolia
npm run deploy:burner-bonds:sepolia
npm run deploy:clrusd             -- base-sepolia
npm run deploy:esa-vault          -- base-sepolia
npm run deploy:clrusd-register    -- base-sepolia
npm run deploy:clrusd-pool        -- base-sepolia
npm run deploy:access-manager     -- base-sepolia
npm run deploy:membership-registry -- base-sepolia
npm run configure:membership-registry -- base-sepolia
npm run deploy:savings-intents    -- base-sepolia

npx hardhat run deploy/11_deploy_ClaimEscrow.ts       --network base-sepolia
npx hardhat run deploy/20_deploy_CreditCore.ts        --network base-sepolia
npx hardhat run deploy/21_deploy_ClearUSDUpgradeable.ts --network base-sepolia
npx hardhat run deploy/22_deploy_BondsAndPool.ts      --network base-sepolia
npx hardhat run deploy/23_deploy_BondCollection.ts    --network base-sepolia
npx hardhat run deploy/24_deploy_OffersIssuer.ts      --network base-sepolia
```

Runbook: [`docs/operators/deploying-contracts.md`](./docs/operators/deploying-contracts.md) — every script, what it
reads, the wiring after, and handing the keys to the Safe.

### Verification and upgrades

```bash
npm run verify:deployments:sepolia     # checks the reserve and bond contracts only
CONTRACT_NAME=DeedNFT PROXY_ADDRESS=0x… npm run upgrade:check   -- base-sepolia
CONTRACT_NAME=DeedNFT PROXY_ADDRESS=0x… npm run upgrade:execute -- base-sepolia
```

The credit stack has its own upgrade scripts, one per contract, in `scripts/upgrade_*.ts`.

### Operational scripts

```bash
npm run send:grant-settler:base-sepolia          # ClaimEscrow settler role
npm run clrusd:ccip:configure -- base-sepolia    # CCIP lanes for CLRUSD
npm run clrusd:validate       -- base-sepolia
npx hardhat run scripts/grant_collateral_operator.ts --network base-sepolia
npx hardhat run scripts/rotate_credit_operator.ts    --network base-sepolia
npx hardhat run scripts/register_merchant.ts         --network base-sepolia
npx hardhat run scripts/sync_savings_collateral.ts   --network base-sepolia
```

Operator authority on the issuers is `stableCredit.access().isOperator(caller)` — an AccessManager
check two hops out, not a role on the issuer itself.

---

## The API (`apps/api`)

Express on Bun, Postgres, Redis, socket.io. Deployed as a Docker image on Railway, built from the
repository root (`apps/api/railway.json`); `docker-compose.yml` runs Redis locally.

```bash
cd apps/api
bun install
cp env.example .env
bun run dev      # bun --watch src/index.ts
```

Route groups mounted in `apps/api/src/index.ts`:

| Group | What it covers |
|---|---|
| `/api/prices`, `/api/balances`, `/api/token-balances`, `/api/nfts`, `/api/transactions`, `/api/portfolio` | Chain data aggregation, caching, portfolio history + snapshots |
| `/api/members`, `/api/contacts`, `/api/avatars`, `/api/member-links`, `/api/notifications` | Member identity, profile, directory lookup, push |
| `/api/session`, `/api/step-up` | Sessions, and step-up checks before money moves |
| `/api/savings`, `/api/credit`, `/api/pay`, `/api/autopay`, `/api/requests`, `/api/withdraw` | ESA deposits, credit lines and plans, the equity ledger, autopay, cash-out |
| `/api/assurance`, `/api/disputes` | Assurance claims and reserve reports, disputes |
| `/api/send` | Link-based send: prepare, lock, claim, payout, refund |
| `/api/charges`, `/api/merchant` | Merchant charges, staff, payouts, refunds |
| `/api/device/point`, `/api/p`, `/api/r` | Clear Terminal: a Point's own API, and the public phone pages for paying at a Point and for receipts |
| `/api/lithic`, `/api/lithic/cards` | The Clear card: issuing, JIT auth decisioning, ACH origination. `/api/cards` is an older scaffold |
| `/api/plaid`, `/api/bridge`, `/api/stripe`, `/api/onramper`, `/api/ramp`, `/api/sweeps` | Bank links, KYC, fiat on/off ramps, sweeps |
| `/v1`, `/api/l`, `/api/checkout` | Pay with Clear: the public API for shops, payment links and checkout. `/v1` sits outside `/api` and its rate limiter |
| `/api/s`, `/api/rewards`, `/api/partners`, `/api/public` | Shop pages, rewards, the partner directory, public reads |
| `/api/command/*` | The Command Center |
| `/api/webhooks/{lithic,bridge,onramper,coinbase-ramp}`, `/api/stripe/webhooks` | Signature-verified provider callbacks, mounted outside auth |

```text
GET /health
```

Member routes sit behind `requireAuth`. Merchant, send, command, `/v1` and the shop routes do their
own auth, and webhooks and public reads have none. Rate limiting is Redis-backed, applied at `/api`.

| Provider | Owns |
|---|---|
| **Bridge** | Fiat → USDC deposits, hosted KYC |
| **Lithic** | Card issuing, JIT authorization, ACH push/pull |
| **Plaid** | Bank linking and identity |
| **Coinbase** · **Onramper** | Crypto on-ramp for Add money |
| **Stripe** | Merchant card processing (Stripe Connect, Terminal) and membership billing |

More: [`apps/api/README.md`](./apps/api/README.md), [`docs/operators/api-deploy.md`](./docs/operators/api-deploy.md),
[`docs/developers/integrations/lithic.md`](./docs/developers/integrations/lithic.md).

---

## The member app (`apps/member`)

React 19 + Vite + Tailwind, Radix primitives.

| Concern | Stack |
|---|---|
| Auth + wallets | **Privy** — embedded smart wallets, wagmi/viem underneath |
| Account abstraction | ZeroDev — sponsored gas, session keys |
| Messaging · Routing | XMTP · LiFi |
| On-ramp | Coinbase, through `/api/ramp` |

Routes:

| Route | Screen |
|---|---|
| `/` | Home |
| `/savings` | ESA — deposit, redeem, equity credits |
| `/earn` | Credit line, tiers, plans |
| `/send` | Send to a wallet, email or phone |
| `/activity`, `/charges` | Transactions across chain and linked banks, and charge history |
| `/card` | The Clear card |
| `/scan`, `/code` | Scan to pay, and the member's own Clear code |
| `/assurance`, `/assurance/reserve`, `/assurance/reports`, `/assurance/claim` | Protections, the reserve, its reports, and making a claim |
| `/partners`, `/inbox`, `/settings/:page`, `/learn/:topic` | The rest. Contacts live under settings |
| `/c/:code`, `/approve/:id`, `/join/pay` | Approving a charge or a Pay with Clear payment, outside the app shell |
| `/login`, `/onboarding`, `/s/:shop`, `/claim/:token`, `/wallet-link`, `/share` | Entries before sign-in |

`/s/:shop` is counter onboarding — a signup started at a merchant counter, which can never itself
authorize a charge. `/claim/:token` is the recipient side of a send link and needs no account.

### PWA

The member app is installable.

- **Manifest** — `public/manifest.json`: standalone display, shortcuts, share target
- **Service worker** — `public/sw.js`: per-route cache strategies, network-only for stateful
  endpoints such as Plaid
- **Runtime** — `OfflineIndicator`, `PwaInstallTakeover`, `PWAInitializer` for sync + notification
  registration; helpers in `src/utils/serviceWorker.ts`

> **Bundle secrets are scanned on every build** (`npm run scan:secrets`). Dynamic
> `import.meta.env[key]` access inlines the entire `VITE_` namespace — so the scan is a build gate,
> not a lint.

---

## The merchant app (`apps/merchant`)

A full point of sale. Staff take payments at a counter in every way a shop is paid; owners manage
payouts, staff and refunds.

```mermaid
flowchart TD
  C(["One counter"]) --> CL["Clear<br/><i>a Clear code, a payment link, a phone pay</i>"]
  C --> CARD["Card<br/><i>Stripe Terminal: smart reader, M2, Tap to Pay</i>"]
  C --> CASH["Cash<br/><i>the drawer</i>"]
  CL --> ONE["<b>One tender</b><br/>funded balance or credit line"]
  ONE --> PP["Merchant payout<br/><i>PayoutPool, on the shop's terms</i>"]
  CARD --> ST["The shop's own Stripe account<br/><i>direct charges</i>"]
```

**Every tender at one counter.** A Clear payment — a code approved in the member app, a payment
link, a phone pay — settles on Clear's rails and is paid out through the PayoutPool on the shop's
terms. A card is taken on Stripe Terminal and charged directly on the shop's own Stripe account
(Connect Standard), so card money never passes through Clear; a Clear card is just a card here.
Cash goes in the drawer. A sale can be split across tenders, and the app also keeps inventory,
tables, the close of the day, staff and payouts.

**One Clear tender, whatever backs it.** A funded balance is collateral for a fully secured draw,
not a second tender — so balance and line are the same charge, and the merchant sees one thing.
Hence `approved` and `isFinanced` in `packages/domain`: the design, not a phase. Per-merchant terms
— payout window, approval cap, discount — live in `MerchantRegistry`.

```mermaid
flowchart LR
  D["Enrolled device"] --> P["Staff PIN<br/><i>counter · manager</i>"] --> O["Owner<br/><i>Privy organizations</i>"]
  D -.- d1["the counter"]
  P -.- p1["charges; a manager approves<br/>refunds and voids"]
  O -.- o1["payouts, staff, month end,<br/>reset a PIN"]
```

Three roles: counter, manager, owner. A refund or void is approved by a manager or the owner, never
by the person who asked; above the PIN limit, the owner approves it on their own phone. Owners can
reset a PIN; staff cannot choose each other's. The two balances an owner sees — **owed**
and **held** — are different money and are never summed.

Screens: `/` counter, `/new`, `/charges` + detail + refund, `/tables` (Clear Terminal),
`/inventory`, `/close` (close the day), `/settings/:section`, `/onboarding`. Owner-only:
`/payouts` + detail with the withdraw modal, `/staff`, `/overview` (month end).

Design reference: [`docs/merchant-reference/`](./docs/merchant-reference/) — one file per screen.
Card flow: [`packages/merchant-contracts/CARD_FLOW.md`](./packages/merchant-contracts/CARD_FLOW.md).
Clear Terminal hardware: [`docs/hardware/`](./docs/hardware/).

---

## Pay, rewards and the Command Center

**Pay with Clear (`apps/pay`)** — payment-link pages (`/l/:slug`) and the checkout frame
(`/m/:session`) a shop's site opens, plus the `@useclear/js` script at `js.useclear.org/v1`. Shops
integrate through the public `/v1` API; its docs are generated by
[`packages/pay-docs`](./packages/pay-docs/README.md) and served at `app.useclear.org/docs/`.

**Rewards (`apps/rewards`)** — one codebase, two forms: each shop's branded loyalty app at
`useclear.org/s/:slug`, and the hub at `rewards.useclear.org`. Points, offers, rewards and scan to
pay. Store builds: [`apps/rewards/native/`](./apps/rewards/native/README.md).

**The Command Center (`apps/command`)** — the co-op's internal app, the members' read-only view and
the investors' data room. See [`apps/command/README.md`](./apps/command/README.md).

---

## Licensing

This repository carries more than one license, and which applies depends on the directory.

| Directory | License | File |
|---|---|---|
| `contracts/`, `deploy/`, `scripts/`, `test/` | AGPL-3.0 | [`contracts/LICENSE`](./contracts/LICENSE) |
| `apps/*` | Proprietary — all rights reserved | [`LICENSE`](./LICENSE) |
| `packages/domain`, `packages/tokens`, `packages/contracts-sdk` | MIT | [`domain`](./packages/domain/LICENSE) · [`tokens`](./packages/tokens/LICENSE) · [`contracts-sdk`](./packages/contracts-sdk/LICENSE) |
| `packages/clear-js`, `packages/clear-node`, `packages/clear-mcp` — the public SDKs | MIT | [`clear-js`](./packages/clear-js/LICENSE) · [`clear-node`](./packages/clear-node/LICENSE) · [`clear-mcp`](./packages/clear-mcp/LICENSE) |
| Every other package under `packages/` | Proprietary — `UNLICENSED` in its `package.json` | [`LICENSE`](./LICENSE) |

`contracts/` is a fork of **StableCredit**, hence AGPL-3.0. **No application code imports Solidity
source from it** — the apps reach the chain through committed ABI JSON and, in future,
`packages/contracts-sdk`, which ships generated artifacts only. That rule is what keeps the copyleft
inside `contracts/`.

**Read [`NOTICE.md`](./NOTICE.md) before moving code across those boundaries.** It is the
authority on which license applies where, records the fork lineage file by file, and flags one
unsettled question: whether bindings generated from AGPL sources inherit the copyleft. The layout
here assumes they do not — that has not been reviewed by counsel, and should be before
`packages/contracts-sdk` is distributed outside Deed3Labs.

---

## Documentation

Everything lives in [`docs/`](./docs/README.md), sectioned by who it is for:

| Section | For |
|---|---|
| [Overview](./docs/overview/README.md) | Anyone — what Clear is and how the money works |
| [Members](./docs/members/README.md) | People using the member app |
| [Merchants](./docs/merchants/README.md) | Shops taking Clear, and their staff |
| [Investors](./docs/investors/README.md) | Financial contributors |
| [Contributors](./docs/contributors/README.md) | People contributing land or property |
| [Governance](./docs/governance/README.md) | How the co-op decides, and who holds which keys — the other sections link here |
| [Developers](./docs/developers/README.md) | Building on Clear, or working in this repository |
| [Protocol](./docs/protocol/README.md) | The contracts, including the Deed track |
| [Operators](./docs/operators/README.md) | Deploying, upgrading and running it |

The public Pay with Clear developer docs are generated by [`packages/pay-docs`](./packages/pay-docs/README.md)
and served at `app.useclear.org/docs/`.

---

## Security

- Critical flows use role-based access control, pause controls and reentrancy protection
- Upgradeable modules require strict admin governance — multisig or equivalent
- Validate oracle, token registry, credit policy, merchant terms and settlement role assumptions
  before any production use
- Contracts are **unaudited**

---

## Contributing

Focused PRs against `dev`. Run the suites that cover what you touched, update the docs when an
interface or workflow moves, and re-validate the deploy and upgrade scripts whenever you change
contract initialization or permissions.
