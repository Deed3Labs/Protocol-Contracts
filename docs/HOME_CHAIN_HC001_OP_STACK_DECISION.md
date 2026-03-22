# HC-001: OP Stack Provider Decision and Standard Config Freeze

Date: March 21, 2026  
Status: In Progress (awaiting final sign-off)  
Plan reference: `docs/HOME_CHAIN_30_60_90_EXECUTION_PLAN.md` (HC-001)

## 1. Decision Summary

1. Chain framework: `OP Stack`.
2. Phase 0 operator model: `Self-managed` (Clear-operated infrastructure for testnet launch).
3. Deployment method: `op-deployer` using `standard-overrides`.
4. Non-standard deviations: `None approved`.

## 2. Provider Decision for Phase 0

Selected provider model:

1. Primary: `Self-managed OP Stack` for Home Testnet (`chainId 92373`).

Rationale:

1. Fastest path to operational ownership before introducing external provider dependencies.
2. Aligned with official OP Stack rollup operator flow (`init` -> `apply` -> `inspect`).
3. Keeps migration optional if a managed RaaS vendor is selected after pilot metrics are available.

Phase 1 re-evaluation trigger:

1. If reliability targets, support coverage, or cost profile are not met, evaluate managed RaaS migration under a formal exception memo.

## 3. Frozen Standard Chain Parameters

These values are frozen for HC-001 and cannot change without an approved exception record.

| Parameter | Value |
|---|---|
| `intentType` | `standard-overrides` |
| `l1ChainID` (testnet) | `11155111` (Sepolia) |
| `home testnet chainId` | `92373` |
| `home mainnet chainId (reserved)` | `92401` |
| `useInterop` | `false` |
| `fundDevAccounts` | `false` |
| Custom system contract changes | `not allowed` |
| Alt-DA mode | `not enabled` |

## 4. Required Components for HC-002

1. `op-geth` (execution client).
2. `op-node` (consensus client).
3. `op-batcher`.
4. `op-proposer`.
5. `op-challenger`.
6. Public RPC endpoint.
7. Block explorer (Blockscout target).
8. Faucet and bridge UI path for internal testing.

## 5. Exception Policy

Any deviation from the frozen parameters requires:

1. Written exception note in `docs/`.
2. Security and Infra/Ops review.
3. Explicit owner sign-off before rollout.

## 6. Sign-off Checklist

| Role | Owner | Status | Date |
|---|---|---|---|
| Product/PM | TBD | Pending | TBD |
| Infra/Ops | TBD | Pending | TBD |
| Security | TBD | Pending | TBD |

## 7. Implementation Artifacts

1. `ops/op-stack/hc001/chain-config-freeze.yaml`
2. `ops/op-stack/hc001/intent.template.toml`
3. `ops/op-stack/hc001/.env.example`
4. `ops/op-stack/hc001/README.md`
5. `scripts/op-stack/validate-hc001.js`
