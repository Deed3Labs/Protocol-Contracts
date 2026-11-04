# The co-op's structure

> **Draft.** The co-op's bylaws are not adopted yet. Until they are, the structure below is a draft
> and binds no one.

How Clear is put together: the entities, who holds what, how members and regional councils take
part, the co-op and Holdings boards, and the five reserved matters. The public version is on
[The co-op](https://useclear.org/coop) and [Clear Capital](https://useclear.org/capital).

## The entities

**Two balance sheets that never touch.** Housing is on one side: land and contributed property.
Money is on the other: deposits, credit and loans.

| Entity | What it does | Owned by |
|---|---|---|
| **The co-op** | The parent. One member, one vote | Its members |
| **Program entity** | Accounts, cards and payments. Member money sits here, on the money side | The co-op |
| **Deed & Title Co** | Records and administration for deeds and title | The co-op |
| **Clear Capital Holdings** | A separate company with its own board, and the only place outside investors sit | The co-op |
| **Clear Lending** | Funds the credit book. The money side; it never touches the land | Clear Capital Holdings |
| **Clear Properties** | Holds contributed property. The housing side; it never backs a credit loss | Clear Capital Holdings |
| **ClearLabs** | Builds the protocol, and is paid by the foundation to maintain it | The co-op |
| **Protocol foundation** | Holds the protocol's source, and contracts ClearLabs to maintain it | Nobody. It sits outside the ownership tree |

The co-op owns everything in the tree except the foundation. Members hold no shares in Clear
Capital Holdings, and outside investors sit only there. How ownership of Holdings is divided between
the co-op and outside investors is not settled yet.

**Who holds what:**

- **Members hold the structure** (the house), bought down through an Equity-Lease Participation
  Agreement and ending in a Clear Deed.
- **The land is held in common by members**, through the co-op. Selling it is a reserved matter.
- **Contributors of property hold shares** in Clear Properties, pro rata, on the same terms as
  everyone in the pool, Clear Capital's own position included. There is no preferred return
  anywhere in the stack.

**What backs what:**

| | | |
|---|---|---|
| The land | Construction borrowing | Backs it |
| The land | Credit losses | Never |
| A member's savings | Another member's credit | Never |

Savings sit in the savings vault, which has no way to lend them. Money a member chooses to deposit
in the lending pool on Earn is different: the pool lends it to fund members' card credit
([The lending pool](../investors/lending-pool.md)).

## Who decides

**Policies and reserved matters are different things.** A policy is what a board sets, and what the
next board is free to unset. A reserved matter is written into the structure and cannot pass without
the co-op, whoever else sits on the board.

### Members

**One vote each, not by balance.** A bigger balance does not give a member a bigger say. What makes
someone a member of the co-op is set by the bylaws, which are not adopted yet. How membership is
recorded in the apps today is in [Membership and the co-op](./membership.md).

### Regional councils

**Residents govern their own place**, through one council per community. Each council's chair goes
up to the co-op board, through the Delegate Assembly.

### The Delegate Assembly

**One third of the co-op board is delegated from the councils.** Each community delegates its
council chair. The share is a fraction rather than a number so that it holds at any board size:
three of nine seats, four of twelve.

### The co-op board

**Elected by members, and member-only.** What protects a member is written here, and it is not up
for negotiation with anyone outside the membership. It has a chair. The number of seats is not
settled yet.

### The Holdings board

**Clear Capital Holdings has its own board of seven**, fixed by kind:

| Seat | How it is filled |
|---|---|
| Chair | Directly elected |
| Two co-op seats | Reserved for the co-op |
| Neutral seat | Named jointly |
| Open seat | Free |
| Two investor seats | Held by investors |

The two co-op seats belong to the co-op class, and the two investor seats to the financial class.
Investors hold these two seats and none on the co-op board.

Neither board can quietly become the other. That is the reason there are two.

## The five reserved matters

**None of the five can pass without the co-op**, and none can pass on a Holdings vote alone. At
Holdings they belong to the co-op class.

1. Selling land
2. Diluting members
3. Amending the purpose
4. Replacing the manager
5. Related-party deals above a threshold

An example: a motion to sell the land is put to a seven-seat vote, which goes four to three in
favour. Written as a policy, it passes. Written as a reserved matter, it is blocked.

The related-party threshold is not settled yet.

## The protocol

**The contracts are open source and held by a foundation nobody owns.** The source is public under
AGPL-3.0. ClearLabs is paid to maintain it today, and is deliberately not the only party that could.
If governance diverged, the co-op could fork the source; because it already funds the maintainer, it
has the capability and not only the right.

**The structure is not enforced on the chain.** The contracts know an admin, operators and members.
Boards, councils, seats and reserved matters are not on the chain. Admin of the deployed contracts
sits with the Ops Safe, a multi-signature wallet; how that works, and how to check who can sign for
it, is in [On-chain authority](./on-chain-authority.md). The Command Center records the co-op's
decisions; it does not enforce them ([The Command Center](./command-center.md)).
