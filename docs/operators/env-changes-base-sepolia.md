# Environment changes: Base Sepolia rollout

Settings changed for the Base Sepolia rollout, in order. Names and values only.

## Phase 1: Nov 17, 2026

Railway, project Clear App, environment `dev`, service Protocol-Contracts (`api.useclear.org`). Set
without a redeploy. They take effect on the API's next deploy.

| Variable | Value | Why |
|---|---|---|
| `OPS_ALERT_EMAIL` | `ops@useclear.org` | Where the API's operator alerts go |
| `ASSURANCE_FEE_PAYER_CDP_ACCOUNT_NAME` | `cl-fees-base-sepolia` | The CDP server wallet the Assurance fee payer sends from (`0xB9ed7ea800c3a32a8F2cf7d2aB50AE2d4831cDFd`). Inert until `ASSURANCE_FEE_PAYER_ENABLED` is set |

Nothing else changed. No Vercel variable changed.

### Left for after the day-0 run

- `BURNER_BOND_84532` (`0x4d96904EA80aae8cAC34826f8Fd0aF52Ae85c148`) and `BURNER_BOND_DEPOSIT_84532`
  (`0x1933aC0BDd58C1a6D48c19f8A7fD96c5Ec27c6C3`) point at the retired `BurnerBondLegacy` and
  `BurnerBondDepositLegacy` records.
- `PAYOUT_KEEPER_ENABLED`, `ASSURANCE_FEE_PAYER_ENABLED`, `ASSURANCE_POOL_V2_84532` and the
  `PAYOUT_TOPUP_*` settings are not set yet.

## Phase 2: Nov 17, 2026

After the day-0 run. Railway, project Clear App, environment `dev`, service Protocol-Contracts
(`api.useclear.org`). Set without a redeploy, then the API was redeployed once (same build) to load
them. Each address matches its record in `deployments/base-sepolia/`.

### Set

| Variable | Value | Record |
|---|---|---|
| `CLEAR_CREDIT_84532` | `0x5923e02EdFb6724a08A28B79C902b40c748082Bc` | ClearCredit |
| `REVOLVING_ISSUER_84532` | `0xBec598bee24cF2973d42eA85e6028621180fE2F0` | RevolvingIssuer |
| `TERM_ISSUER_84532` | `0x1b1695353f14E889906237D9b9C386eD0393da57` | TermIssuer |
| `COLLATERAL_REGISTRY_84532` | `0xfeDb873e6e1ec1C3BFC8cD561F66bd64D51C446A` | CollateralRegistry |
| `LIMIT_CALCULATOR_84532` | `0x6C0859EcD05C6BB604c91B9De1CAf04724744a20` | LimitCalculator |
| `PAYOUT_POOL_84532` | `0xb4704046d1fA6C3F78DcBB60b40A9D1cdD9fF861` | PayoutPool |
| `MERCHANT_REGISTRY_84532` | `0x8f4C6f9472359BF749c12C840c4269341a423c1b` | MerchantRegistry |
| `LIQUIDATOR_84532` | `0x621784117C037b3D20AF54e04589818e919e33f3` | Liquidator |
| `BURNER_BOND_84532` | `0xe7F6d3E21189e8B6a73f6dee0955322b7a32cC2A` | BurnerBond (the Phase 2f collection) |
| `BURNER_BOND_FACTORY_84532` | `0xf36dE3553509BAafB835bC37c97f529Adf42a96a` | BurnerBondFactory |
| `BOND_VALUER_84532` | `0x7f63e01B1BBd79509138D825B5Ef4b186E9502C8` | BondValuer |
| `EARN_CONTROLS_84532` | `0xe4a7eF8BaF868264F9C4aF0b95342b683764cD97` | EarnControls |
| `SAVINGS_INTENT_FACTORY` | `0xF8074182d9ec61970bBC9E4aaE182B42dF7Bb74B` | SavingsIntentFactory |
| `SAVINGS_INTENT_FACTORY_84532` | `0xF8074182d9ec61970bBC9E4aaE182B42dF7Bb74B` | SavingsIntentFactory |
| `ASSURANCE_POOL_V2_84532` | `0x3c334D3AeD134191B7Ad0744a23978D71357BB15` | AssurancePoolV2 |
| `PAYOUT_KEEPER_ENABLED` | `1` | |
| `PAYOUT_TOPUP_WALLET` | `0xC0C4EC7875D1838C0AE610accC16AAdCDb475068` | the `payout-topup-base-sepolia` CDP wallet |
| `PAYOUT_TOPUP_CDP_ACCOUNT_NAME` | `payout-topup-base-sepolia` | |
| `PAYOUT_TOPUP_CAP_USDC` | `5000` | |
| `PAYOUT_TOPUP_ENABLED` | `1` | |

### Removed

- `BURNER_BOND_DEPOSIT_84532` (was `0x1933aC0BDd58C1a6D48c19f8A7fD96c5Ec27c6C3`, `BurnerBondDepositLegacy`): retired, no replacement.
- `OFFERS_ISSUER_84532` (was `0x150EA8497700E127a3dFe44a98a618bcC7D8841c`, `OffersIssuerPreAudit`): removed. The fresh OffersIssuer (`0x52ED…Edb1`, deploy 24) is set once the credit timelock has registered it.

### Left as they are

- `ESA_VAULT_84532`, `CLRUSD_84532`, `CLRUSD_POOL_84532`, `LENDING_POOL_84532`, `BOND_VAULT_84532`
  and `SEND_CLAIM_ESCROW_ADDRESS_84532`: same addresses, upgraded in place.
- `ASSURANCE_POOL_84532` (`0xf5E40414410672636Ab1691ae19D2Aa1c1705840`, the old pool) and
  `ASSURANCE_FEE_PAYER_ENABLED` (not set): the fee payer is switched on at day 7.

No Vercel variable changed: none names a retired address.

## Keepers in dry run (2026-11-18, after #905)

Railway, project Clear App, environment dev, service Protocol-Contracts. Set with
`--skip-deploys`, then one redeploy (deployment `c8945a69`, 02:03 UTC, from `ffdfa8c0`).

### Set

| Variable | Value |
|---|---|
| `CREDIT_DEFAULT_KEEPER_ENABLED` | `1` |
| `CREDIT_DEFAULT_KEEPER_DRY_RUN` | `1` |
| `POOL_ENFORCE_KEEPER_ENABLED` | `1` |
| `POOL_ENFORCE_KEEPER_DRY_RUN` | `1` |
| `BOND_PLEDGE_KEEPER_ENABLED` | `1` |
| `BOND_PLEDGE_KEEPER_DRY_RUN` | `1` |
| `QUEUE_FILL_KEEPER_ENABLED` | `1` |
| `QUEUE_FILL_KEEPER_DRY_RUN` | `1` |

The startup lines after the redeploy:

- `[cycle-keeper]`: hourly, with `syncCreditPeriod` on and `triggerDefault` in dry run.
- `[pledge-keepers]`: hourly, with pool shares and bonds in dry run.
- `[queue-fill]`: every 15 minutes, in dry run.

The chain keepers pay gas from the card settler `0x1b535BBE4bC5f1a4152DfBD1D1215d9435EaD4f3`, which held 0.085 Sepolia ETH.

Remove each `_DRY_RUN` once its reports look right.
