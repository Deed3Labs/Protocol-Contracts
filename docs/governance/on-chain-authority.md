# On-chain authority

Who can do what to the Clear Protocol's contracts: the kinds of authority, the wallets that hold
them, the Ops Safe, and who can upgrade a contract. Contract addresses are listed under
[Deployed addresses](../../README.md#deployed-addresses). Deploying the contracts and handing over
the keys follows these rules; the steps are in
[Deploying the contracts](../operators/deploying-contracts.md).

## Three kinds of authority

| Kind | What it can do | Who should hold it |
|---|---|---|
| **Admin** | Grant and take away roles, upgrade a contract, pause it, change who owns it | The Ops Safe |
| **Operational** | One day-to-day job: open a credit line, settle a send, submit a member's signed deposit | A wallet dedicated to that job, or the Ops Safe for jobs that only change settings |
| **Contract-to-contract** | One contract calling another: the savings vault minting CLRUSD, a credit issuer writing to the ledger | The contract that needs it |

**When the contracts are deployed, the deployer key holds every admin and operational role.** Two
hand-overs move them off it. Until both have run on a network, the deployer key holds everything
there.

## The `AccessManager`

The credit contracts take their answer to "is this an admin, an operator or a member?" from one
contract, the access manager (`AccessManager`).

| Role | Granted by | What it allows |
|---|---|---|
| Admin | An admin | Upgrading the credit ledger, changing its settings, granting operators. An admin also counts as an operator |
| `OPERATOR` | An admin | The credit issuers' day-to-day calls: opening lines and plans, setting term limits and tier rates, reinstating a member |
| `MEMBER` | An operator | Being treated as a member. Most members are recognised through the membership registry instead ([Membership](./membership.md)) |

The credit issuers check operator authority by asking the ledger's access manager, not through a
role of their own. Because an admin counts as an operator, the deployer stops being an operator only
once its admin role has moved to the Ops Safe.

Other contracts (the savings vault, the collateral registry, the shop registry, the pools) keep their
own roles. The full list per contract is in [Credit](../protocol/credit.md),
[Savings and send](../protocol/savings.md), [Settlement](../protocol/settlement.md) and
[The reserve](../protocol/reserve.md).

## The wallets that do each job

**Each job signs with its own key, or the job does not run.** Clear's server never falls back to the
deployer key for any of them.

| Job | Roles it holds | What it does |
|---|---|---|
| **Credit operator** | `AccessManager` `OPERATOR`; `MembershipRegistry` `REGISTRAR_ROLE` unless a separate registrar is set | Opens credit lines and plans, sets term limits, closes plans for refunds, reinstates members, writes membership records |
| **Savings relayer** | `ESADepositVault` `OPERATOR_ROLE`; `SavingsIntentFactory` `SETTLER_ROLE`; `CollateralRegistry` `OPERATOR_ROLE` | Submits members' signed deposits, redemptions and autopay; settles savings intents; records pledged savings |
| **Send relayer** | `ClaimEscrow` `SETTLER_ROLE` | Holds link-based sends in escrow and releases them when claimed |
| **Card settler** | `LendingPool` `BORROWER_ROLE`, and the card-settler slot on `RevolvingIssuer` | Records card spending on the ledger and borrows the float for it from the lending pool |
| **The Ops Safe** | Every operator role that only changes settings, `MerchantRegistry` `OPERATOR_ROLE`, `PayoutPool` `FUNDER_ROLE`, and the Deed track's fee and validation managers | Shop terms, payout pool top-ups, lending and liquidation settings, validator fees |

**Some operational roles also cover settings.** An operator role is one switch for a whole contract,
so the wallet that does a day-to-day job there can also change that contract's operator settings:

- The credit operator can add revolving tiers and change their rates.
- The savings relayer can change which tokens the savings vault accepts, cancel an autopay mandate,
  and set the haircut on a kind of collateral.

Roles that nothing off the chain uses are given up rather than moved: `AccessManager` `MEMBER`,
`LendingPool` `LOSS_REPORTER_ROLE`, `LimitCalculator` `ATTESTOR_ROLE`, `SavingsIntentFactory`
`CREATOR_ROLE`, the minting and validator roles on `DeedNFT`, and a few that no function checks.
Nothing mints T-Deeds yet.

## The Ops Safe

**The Ops Safe is the co-op's multi-signature wallet.** A transaction from it needs signatures from
more than one of its owners, so no one person's key can upgrade a contract, change a shop's terms or
move the co-op's money on the chain.

The hand-over to the Safe moves:

- every admin role (`DEFAULT_ADMIN_ROLE`, `ADMIN_ROLE`, `UPGRADER_ROLE`, `REGISTRY_ADMIN_ROLE`,
  `PAUSER_ROLE`) and ownership of every contract that has an owner;
- the two operational roles the Command Center's proposals need: `MerchantRegistry`
  `OPERATOR_ROLE` and `PayoutPool` `FUNDER_ROLE`.

It grants first, and takes a role from the deployer only once the Safe is seen to hold it. Two
contracts need the Safe itself to finish: CLRUSD's admin is handed over in two timed steps, accepted
by the Safe after a delay, and ownership of the cross-chain CLRUSD pool is accepted by the Safe.

The order is fixed:

1. **Operational roles to their wallets.** This runs first, while the deployer can still grant.
2. **Admin to the Ops Safe.**

Both are rehearsed against a copy of the live network before they run. The rehearsal checks that the
Safe ends up with every admin role and every ownership, that the deployer ends with none, and that
two signers can act through the Safe while one alone cannot.

People sign Safe transactions with their own wallets. How the Command Center prepares them is in
[The Command Center](./command-center.md#ops-safe-transactions).

## Who holds each role today

**Who holds a role on a network is state on the chain.** It changes with each grant and hand-over,
and anyone can read it. Each of these is a public function, callable from a block explorer's "Read
contract" tab without a wallet:

| To check | Call |
|---|---|
| Whether an address holds a role | `hasRole(role, address)` on the contract. A role's id is the value of its getter, such as `OPERATOR_ROLE()`; `DEFAULT_ADMIN_ROLE` is zero |
| Admin, operator or member of the credit contracts | `isAdmin(address)`, `isOperator(address)` and `isMember(address)` on `AccessManager`. `isOperator` is true for an admin too, and `isMember` for anyone with an active membership record |
| Who owns a contract that has an owner (the credit issuers, `AssurancePool`, `AssuranceOracle`, the cross-chain CLRUSD pool) | `owner()`, and `pendingOwner()` where ownership is accepted in a second step |
| Who is CLRUSD's admin | `defaultAdmin()` and `pendingDefaultAdmin()` on `ClearUSDUpgradeable`. Its `owner()` only repeats the default admin |
| Who can sign for the Ops Safe | `getOwners()` and `getThreshold()` on the Safe. The Command Center reads the same two from the chain |

`hasRole` answers for one address at a time: the contracts do not keep a list of a role's holders.
To see every grant and removal, read the contract's `RoleGranted` and `RoleRevoked` events.

## Who can upgrade a contract

**An upgrade keeps a contract's address and replaces its code.** The right to do it sits with each
contract's admin. After the hand-over that is the Ops Safe, so an upgrade is then a Safe transaction,
not something one key can do.

| Contracts | Upgraded by |
|---|---|
| `ClearCredit` (the credit ledger) | An `AccessManager` admin |
| The credit issuers: `RevolvingIssuer`, `TermIssuer`, `OffersIssuer` | The issuer's owner |
| `AssurancePool`, `AssuranceOracle` | Their owner |
| `ClearUSDUpgradeable` (CLRUSD) | `UPGRADER_ROLE` |
| `ESADepositVault`, `ClaimEscrow`, `CollateralRegistry`, `LimitCalculator`, `Liquidator`, `NetworkRegistry`, `MerchantRegistry`, `PayoutPool`, `LendingPool`, `BondVault` | `DEFAULT_ADMIN_ROLE` |
| The Deed track | Each contract's admin role or owner |
| `ClearUSD` (the original CLRUSD), `SavingsIntentFactory` | Cannot be upgraded |

How an upgrade is run is in [Deploying the contracts](../operators/deploying-contracts.md#upgrades).

## Pausing

`PAUSER_ROLE` on the savings vault stops deposits, redemptions and autopay runs until it is
unpaused. It does not stop the vault's settings from being changed. `MembershipRegistry` has a
pauser too. `ClaimEscrow`, the link-based send escrow, cannot be paused. `PAUSER_ROLE` is an admin
role and moves to the Ops Safe in the hand-over.

## What no role can do

- **Take the savings.** The savings vault releases USDC only when the holder of the CLRUSD redeems
  it. There is no admin withdrawal.
- **Take savings that were not drawn against.** After a default, the CLRUSD contract limits seizure
  to what the member drew against their pledged savings.
- **Hold equity credits.** No contract does; Clear's server keeps them
  ([Parameters](./parameters.md#equity-credits)).
