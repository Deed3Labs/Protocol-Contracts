# Licensing and attribution

This repository carries more than one license. Which one applies depends on the directory.

| Directory | License | File |
|---|---|---|
| `contracts/` | GNU Affero General Public License v3.0 | [`contracts/LICENSE`](contracts/LICENSE) |
| `apps/member`, `apps/merchant`, `apps/api` | Proprietary — all rights reserved | [`LICENSE`](LICENSE) |
| `packages/domain`, `packages/tokens`, `packages/contracts-sdk` | MIT | `packages/*/LICENSE` |
| `deploy/`, `scripts/`, `test/` (hardhat tooling for `contracts/`) | AGPL-3.0 | [`contracts/LICENSE`](contracts/LICENSE) |

## Fork origin

`contracts/` is a fork of **StableCredit** and is AGPL-3.0 licensed in consequence.
Files including `StableCredit.sol`, `MutualCredit.sol`, `AssurancePool`, `AssuranceOracle`,
`AccessManager` and `MembershipRegistry` derive from that work and carry its copyleft.

## The boundary, and why it holds

No application code imports Solidity source from `contracts/`. The apps reach the chain through
committed ABI JSON and, in future, through `packages/contracts-sdk`.

`packages/contracts-sdk` ships **generated artifacts only** — ABIs, typechain output, deployed
addresses and read helpers. It must never import or vendor AGPL source from `contracts/`. Keeping
that rule is what keeps the copyleft inside `contracts/`.

## Open question

Whether generated bindings derived from AGPL sources inherit the copyleft is not settled law.
The common industry position is that an ABI is an interface description rather than a creative
derivative, and that generated bindings therefore carry no copyleft — which is the position this
layout assumes. It has not been reviewed by counsel. If `packages/contracts-sdk` is ever
distributed outside Deed3Labs, get that reviewed first.
