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
