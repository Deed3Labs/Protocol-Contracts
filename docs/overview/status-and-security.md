# Status, security and licensing

**Clear is in alpha: a developer preview.** The contracts have not been audited. Do not put real
money behind them without an independent security review and operational hardening.

## Which network

The contracts run on **Base**, a public network, and on its test network, **Base Sepolia**, where
nothing is real money.

| Network | What is there |
|---|---|
| Base Sepolia | Everything: savings, send, the credit ledger and its issuers, shop payouts, the reserve, bonds, offers and the Deed track |
| Base | Savings and send only: CLRUSD, the savings vault and the escrow behind link-based send |
| Ethereum Sepolia | CLRUSD only, for testing moving it between networks |

**The credit side is not on Base yet.** Credit lines, split plans, shop payouts and the reserve exist
only on the test network today.

Every address is listed in the root README under
[Deployed addresses](../../README.md#deployed-addresses).

## Which app

`demo.useclear.org`, `merchant.useclear.org` and `command.useclear.org` run on the test network,
with the bank, identity, card and payment providers in their sandbox or test modes. Nothing there is
real money.

**The Clear Visa card is not available with real money yet.** It runs in its provider's sandbox only.

Equity credits earned on a test network are recorded separately from those earned on a live one.

## Security

- **Unaudited.** No independent audit of the contracts has been done.
- **Access control on every money path.** Contracts that move value check roles, can be paused, and
  guard against re-entry.
- **No single key should hold the contracts.** Admin powers are meant to sit with the Ops Safe, a
  multi-signature wallet, and each day-to-day job with its own wallet. Until they are handed over on
  a network, the deployer key holds every role there. Who holds what is in
  [On-chain authority](../governance/on-chain-authority.md).
- **Interfaces still move.** Contract functions and API shapes can change between versions.

## Licensing

**Clear's source code carries more than one license, and which one applies depends on the
directory.**

| Part | License |
|---|---|
| The contracts, and the tooling that deploys and tests them (`contracts/`, `deploy/`, `scripts/`, `test/`) | AGPL-3.0, because the contracts are a fork of StableCredit |
| The apps (`apps/*`) | Proprietary, all rights reserved |
| `packages/domain`, `packages/tokens`, `packages/contracts-sdk` | MIT |
| Every other package | Proprietary |

[`NOTICE.md`](../../NOTICE.md) is the authority on which license applies where. It records which
files come from StableCredit, explains the rule that keeps the copyleft inside `contracts/` — no app
imports Solidity source, only generated ABIs — and flags one question that has not been reviewed by
counsel. Read it before moving code across those boundaries.
