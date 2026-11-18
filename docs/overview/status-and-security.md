# Status, security and licensing

**Clear is in alpha: a developer preview.** The contracts have not been audited. Do not put real
money behind them without an independent security review and operational hardening.

## Which network

The contracts run on **Base**, a public network, and on its test network, **Base Sepolia**, where
nothing is real money.

| Network | What is there |
|---|---|
| Base Sepolia | Everything: savings, send, the credit ledger and its issuers, shop payouts, the lending pool on Earn, bonds, the reserve, offers and the Deed track |
| Base | Savings and send only: CLRUSD, the savings vault and the escrow behind link-based send |
| Ethereum Sepolia | CLRUSD only, for testing moving it between networks |

**The credit side is not on Base yet.** Credit lines, split plans, shop payouts, Earn and the reserve
exist only on the test network today.

**On Base Sepolia, the credit, Earn and reserve contracts were deployed or upgraded in a rollout that
began on November 17, 2026.** Since then, changes to them pass through timelocks: a multi-signature
wallet proposes a change, and it can take effect only after 7 days.

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
- **No single key should hold the contracts.** Admin and upgrade powers sit with multi-signature
  wallets, and on Base Sepolia with timelocks that make every change wait 7 days. Each day-to-day job
  has its own wallet. Until powers are handed over on a network, the deployer key holds every role
  there. Who holds what is in [On-chain authority](../governance/on-chain-authority.md).
- **Two people for the sharpest powers.** Pausing the savings vault or an account, taking a wallet
  off the members list, and paying anything out of the reserve each take two different people. A
  pause lapses after 72 hours unless it is renewed.
- **Base runs older contracts.** On Base, savings and send run on an earlier version of the vault
  and CLRUSD, without the members-only rule, the savings lock, the two-person pause or the timelocks.
  Those are on Base Sepolia only.
- **Interfaces still move.** Contract functions and API shapes can change between versions.

## Licensing

**Clear's source code carries more than one license, and which one applies depends on the
directory.**

| Part | License |
|---|---|
| The contracts, and the tooling that deploys and tests them (`contracts/`, `deploy/`, `scripts/`, `test/`) | AGPL-3.0, because the contracts are a fork of StableCredit |
| The apps (`apps/*`) | Proprietary, all rights reserved |
| `packages/domain`, `packages/tokens`, `packages/contracts-sdk`, and the Pay with Clear SDKs `packages/clear-js`, `packages/clear-node`, `packages/clear-mcp` | MIT |
| Every other package | Proprietary |

[`NOTICE.md`](../../NOTICE.md) is the authority on which license applies where. It records which
files come from StableCredit, explains the rule that keeps the copyleft inside `contracts/` — no app
imports Solidity source, only generated ABIs — and flags one question that has not been reviewed by
counsel. Read it before moving code across those boundaries.
