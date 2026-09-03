# @clear/contracts-sdk

Generated contract artifacts: ABIs, typechain bindings, deployed addresses and read helpers.

## The one rule

**Ships generated output only. Never imports or vendors Solidity source from `contracts/`.**

`contracts/` is AGPL-3.0 (forked from StableCredit). This package is MIT. That boundary holds
only as long as nothing here reaches into AGPL source — see [`NOTICE.md`](../../NOTICE.md) at the
repo root, which also records the unsettled question about generated bindings.

## Today

ABIs currently reach the member app two other ways, both predating this package:

- committed JSON under `apps/member/src/contracts/<network>/`
- ABI fragments inlined in ~11 files under `apps/member/src/lib` and `src/hooks`

Consolidating those here is not yet scheduled.
