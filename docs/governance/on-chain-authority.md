# On-chain authority

Who can do what to the Clear Protocol's contracts: the kinds of authority, the wallets that hold them,
the Ops Safe, and who can upgrade a contract. Contract addresses are in the root README under
[Deployed addresses](../../README.md#deployed-addresses). How to deploy and hand over is the
operators' runbook, [Deploying the contracts](../operators/deploying-contracts.md); this page is the
rule it follows.

## Three kinds of authority

| Kind | What it can do | Who should hold it |
|---|---|---|
| **Admin** | Grant and take away roles, upgrade a contract, pause it, change who owns it | The Ops Safe |
| **Operational** | One day-to-day job: open a credit line, settle a send, submit a member's signed deposit | A wallet dedicated to that job, or the Ops Safe for jobs that are configuration only |
| **Contract-to-contract** | One contract calling another: the vault minting CLRUSD, an issuer writing to the ledger | The contract that needs it |

**When the contracts are deployed, the deployer key holds every admin and operational role.** Two
hand-overs move them off it. Until both have run on a network, the deployer key holds everything
there.

## The `AccessManager`

The credit contracts take their answer to "is this an admin, an operator or a member?" from one
contract, `AccessManager`.

| Role | Granted by | What it allows |
|---|---|---|
| Admin | An admin | Upgrading the ledger, its settings, granting operators. An admin also counts as an operator |
| `OPERATOR` | An admin | The issuers' day-to-day calls: opening lines and plans, setting term limits and tier rates, reinstating a member |
| `MEMBER` | An operator | Being treated as a member. Most members are recognised through `MembershipRegistry` instead ([Membership](./membership.md)) |

The issuers check operator authority by asking the ledger's `AccessManager`, not through a role of
their own. Because an admin counts as an operator, the deployer stops being an operator only once its
admin role has moved to the Ops Safe.

Other contracts — the vault, the collateral registry, the shop registry, the pools — keep their own
roles. The full list per contract is in [Credit](../protocol/credit.md),
[Savings and send](../protocol/savings.md), [Settlement](../protocol/settlement.md) and
[The reserve](../protocol/reserve.md).

## The wallets that do each job

**Each job signs with its own key, or does nothing.** The server no longer falls back to the deployer
key for any of them. The map of role to job is
[`scripts/command/ops-roles.map.json`](../../scripts/command/ops-roles.map.json); this is what it says.

| Job | Roles it holds | What it does |
|---|---|---|
| **Credit operator** | `AccessManager` `OPERATOR`; `MembershipRegistry` `REGISTRAR_ROLE` unless a separate registrar is set | Opens credit lines and plans, sets term limits, closes plans for refunds, reinstates members, writes membership records |
| **Savings relayer** | `ESADepositVault` `OPERATOR_ROLE`; `SavingsIntentFactory` `SETTLER_ROLE`; `CollateralRegistry` `OPERATOR_ROLE` | Submits members' signed deposits, redemptions and autopay; settles savings intents; records pledged savings |
| **Send relayer** | `ClaimEscrow` `SETTLER_ROLE` | Escrows link-based sends and releases them when claimed |
| **Card settler** | `LendingPool` `BORROWER_ROLE`, and the card-settler slot on `RevolvingIssuer` | Records card spending on the ledger and borrows the float for it |
| **The Ops Safe** | Every configuration-only operator role, `MerchantRegistry` `OPERATOR_ROLE`, `PayoutPool` `FUNDER_ROLE`, and the Deed track's fee and validation managers | Shop terms, pool top-ups, lending and liquidation settings, validator fees |

**Some operational roles also cover settings.** An operator role is one switch for a whole contract,
so the wallet that does a day-to-day job there can also change that contract's operator settings:

- The credit operator can add revolving tiers and change their rates.
- The savings relayer can change which tokens the vault accepts, cancel an autopay mandate, and set
  the haircut on a kind of collateral.

Roles nothing off-chain uses are given up rather than moved: `AccessManager` `MEMBER`, `LendingPool`
`LOSS_REPORTER_ROLE`, `LimitCalculator` `ATTESTOR_ROLE`, `SavingsIntentFactory` `CREATOR_ROLE`, the
minting and validator roles on `DeedNFT`, and a few that no function checks. No service mints
T-Deeds yet.

## The Ops Safe

**The Ops Safe is the co-op's multi-signature wallet.** A transaction from it needs signatures from
more than one of its owners, so no one person's key can upgrade a contract, change a shop's terms or
move the co-op's money on the chain.

The hand-over to it is [`scripts/command/safe-handover.ts`](../../scripts/command/safe-handover.ts).
It moves:

- every admin role — `DEFAULT_ADMIN_ROLE`, `ADMIN_ROLE`, `UPGRADER_ROLE`, `REGISTRY_ADMIN_ROLE`,
  `PAUSER_ROLE` — and ownership of every contract that has an owner;
- the two operational roles the Command Center's proposals need: `MerchantRegistry`
  `OPERATOR_ROLE` and `PayoutPool` `FUNDER_ROLE`.

It grants first, and takes a role from the deployer only once the Safe is seen to hold it. Two
contracts need the Safe itself to finish: CLRUSD's admin is handed over on a timed two-step, accepted
by the Safe after a delay, and the cross-chain CLRUSD pool's ownership is accepted by the Safe.

The order is fixed:

1. **Operational roles to their wallets** — [`scripts/command/ops-roles.ts`](../../scripts/command/ops-roles.ts).
   It has to run first, while the deployer can still grant.
2. **Admin to the Ops Safe** — `safe-handover.ts`.

Both are rehearsed against a copy of the live network before they run. The rehearsal checks that the
Safe ends up with every admin role and every ownership, that the deployer ends with none, that two
signers can act through the Safe and that one alone cannot.

People sign Safe transactions with their own wallets. How the Command Center prepares them is in
[The Command Center](./command-center.md).

## Who holds each role today

**These pages do not record who holds a role on a network.** That is state on the chain: it changes
with each grant and hand-over, and anyone can read it. The contracts' addresses are in the root README
under [Deployed addresses](../../README.md#deployed-addresses), and each of these is a public view
function, callable from a block explorer's "Read contract" tab without a wallet:

| To check | Call |
|---|---|
| Whether an address holds a role | `hasRole(role, address)` on the contract. A role's id is the value of its getter, such as `OPERATOR_ROLE()`; `DEFAULT_ADMIN_ROLE` is zero |
| Admin, operator or member of the credit contracts | `isAdmin(address)`, `isOperator(address)` and `isMember(address)` on `AccessManager`. `isOperator` is true for an admin too, and `isMember` for anyone with an active `MembershipRegistry` record |
| Who owns a contract that has an owner (the issuers, `AssurancePool`, `AssuranceOracle`, the cross-chain CLRUSD pool) | `owner()`, and `pendingOwner()` where ownership is accepted in a second step |
| Who is CLRUSD's admin | `defaultAdmin()` and `pendingDefaultAdmin()` on `ClearUSDUpgradeable`. Its `owner()` only repeats the default admin |
| Who can sign for the Ops Safe | `getOwners()` and `getThreshold()` on the Safe. The Command Center reads the same two from the chain |

`hasRole` answers for one address at a time: the contracts do not keep a list of a role's holders. To
see every grant and removal, read the contract's `RoleGranted` and `RoleRevoked` events.

**The hand-over scripts also report it.** Run without `MODE=run`, each one only reads the chain: it
needs no key and sends nothing.

- **`safe-handover.ts`** lists every contract deployed on Base Sepolia, which of its roles the deployer
  and the Ops Safe each hold (marking the admin roles), who owns it and any owner still to accept, and
  the steps a hand-over would still take.
- **`ops-roles.ts`** lists each role in the role-to-job map, whether the deployer and that job's wallet
  hold it now, and where it is meant to go — a job's wallet, the Ops Safe, or given up. It also reports
  whether each contract holds the roles another contract needs it to.

Both read the Base Sepolia deployment list, and both ask only about the addresses they are given — the
deployer, the Safe and the job wallets. They answer "does this wallet hold it?", not "who else does?";
the events above answer that.

## Who can upgrade a contract

**An upgrade keeps a contract's address and replaces its code.** The right to do it sits with each
contract's admin — after the hand-over, the Ops Safe — so an upgrade is then a Safe transaction, not
something one key can do.

| Contracts | Upgraded by |
|---|---|
| `ClearCredit` (the ledger) | An `AccessManager` admin |
| The issuers: `RevolvingIssuer`, `TermIssuer`, `OffersIssuer` | The issuer's owner |
| `AssurancePool`, `AssuranceOracle` | Their owner |
| `ClearUSDUpgradeable` (CLRUSD) | `UPGRADER_ROLE` |
| `ESADepositVault`, `ClaimEscrow`, `CollateralRegistry`, `LimitCalculator`, `Liquidator`, `NetworkRegistry`, `MerchantRegistry`, `PayoutPool`, `LendingPool`, `BondVault` | `DEFAULT_ADMIN_ROLE` |
| The Deed track | Each contract's admin role or owner |
| `ClearUSD` (the original CLRUSD), `SavingsIntentFactory` | Cannot be upgraded |

The scripts are `deploy/upgrade/` for the Deed track and the reserve, and one `scripts/upgrade_*.ts`
per change for the credit stack ([Deploying the contracts](../operators/deploying-contracts.md)).

## Pausing

`PAUSER_ROLE` on the savings vault stops deposits, redemptions and autopay runs until it is
unpaused. It does not stop the vault's settings from being changed. `MembershipRegistry` has a pauser
too. `ClaimEscrow`, the link-based send escrow, has no pause. `PAUSER_ROLE` is an admin role and moves
to the Ops Safe in the hand-over.

## What no role can do

- **Take the savings.** The vault's only way to release USDC is a redemption by the holder of the
  CLRUSD. There is no admin withdrawal.
- **Take savings that were not drawn against.** Seizure after a default is limited by the CLRUSD
  contract to what the member drew against their pledged savings.
- **Hold equity credits.** No contract does; they are kept by the server
  ([Parameters](./parameters.md)).
