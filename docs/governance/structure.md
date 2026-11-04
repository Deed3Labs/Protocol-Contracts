# The co-op's structure

> **Draft — this describes the structure as published on useclear.org. It is not binding until the
> bylaws are adopted.**

The entities, the co-op and Holdings boards, how members and regional councils take part, the
Delegate Assembly and the five reserved matters, as the public website describes them on
[The co-op](https://useclear.org/coop) and [Clear Capital](https://useclear.org/capital). Nothing on
this page is enforced by the contracts or the apps in this repository;
[How this meets the code](#how-this-meets-the-code) says where the two differ. Anything legal that the
published structure leaves open is marked **[COUNSEL TO REVIEW]**.

## The entities

**Two balance sheets that never touch.** Housing is on one side: land and contributed property.
Money is on the other: deposits, credit and loans.

| Entity | What it does | Owned by |
|---|---|---|
| **The co-op** | The parent. One member, one vote | Its members |
| **Program entity** | Accounts, cards and payments. Member money sits here, on the money side | The co-op |
| **Deed & Title Co** | Records and administration for deeds and title | The co-op |
| **Clear Capital Holdings** | A separate company with its own board, and the only place outside investors sit | The co-op, which "owns everything in the tree except the foundation" **[COUNSEL TO REVIEW]** |
| **Clear Lending** | Funds the credit book. The money side; it never touches the land | Clear Capital Holdings |
| **Clear Properties** | Holds contributed property. The housing side; it never backs a credit loss | Clear Capital Holdings |
| **ClearLabs** | Builds the protocol, and is paid by the foundation to maintain it | The co-op |
| **Protocol foundation** | Holds the protocol's source, and contracts ClearLabs to maintain it | Nobody. It sits outside the ownership tree |

The site also says that members hold no shares in Clear Capital Holdings, and that outside investors
sit only there. How Holdings' ownership is divided between the co-op and its investors is not
published. **[COUNSEL TO REVIEW]**

**Who holds what:**

- **Members hold the structure** — the house — bought down through an Equity-Lease Participation
  Agreement and ending in a Clear Deed.
- **The co-op holds the land**, permanently. Selling it is a reserved matter.
- **Contributors of property hold shares**: yield-bearing shares in Clear Properties, pro rata, on the
  same terms as everyone in the pool, Clear Capital's own position included. There is no preferred
  return anywhere in the stack.

**What backs what:**

| | | |
|---|---|---|
| The land | Construction borrowing | Backs it |
| The land | Credit losses | Never |
| A member's savings | Another member's credit | Never |

## Who decides

**Policies and reserved matters are different things.** A policy is what a board sets, and what the
next board is free to unset. A reserved matter is written into the structure and cannot pass without
the co-op, whoever else sits on the board.

### Members

**One vote each, not by balance.** A deposit makes a member an owner; a bigger deposit does not make
them a bigger one. The site says "your deposit is your share". What legally constitutes a member's
share is not published. **[COUNSEL TO REVIEW]**

### Regional councils

**Residents govern their own place**, one council per community. The site says a council looks like a
homeowners' association from outside and is not one. **[COUNSEL TO REVIEW]**

Each council's chair goes up to the co-op board, through the Delegate Assembly. How a council is
formed, who counts as a resident and how its chair is chosen are not published.
**[COUNSEL TO REVIEW]**

### The Delegate Assembly

**One third of the co-op board is delegated from the councils.** Each community delegates its council
chair. The share is written as a fraction rather than a number so that it holds at any board size:
three of nine seats, four of twelve.

Not published: how the board's size is set; what happens when the number of communities is not a
third of the seats, or the board's size is not divisible by three; and whether the assembly meets as a
body of its own or is only the delegated seats. **[COUNSEL TO REVIEW]**

### The co-op board

**Elected by members, and member-only.** What protects a member is written here, and it is not up for
negotiation with anyone outside the membership. It has a chair.

The number of seats is not fixed: the site draws seven and marks the count as illustrative. It also
draws every seat as member-elected, while a third are meant to be delegated from the councils; how the
elected and delegated seats combine is not published. **[COUNSEL TO REVIEW]**

### The Holdings board

**Clear Capital Holdings has its own board of seven**, fixed by kind:

| Seat | How it is filled | Class |
|---|---|---|
| Chair | Directly elected | Not published **[COUNSEL TO REVIEW]** |
| Two co-op seats | Reserved for the co-op | Co-op class |
| Neutral seat | Named jointly | Not published **[COUNSEL TO REVIEW]** |
| Open seat | Free | Not published **[COUNSEL TO REVIEW]** |
| Two investor seats | Held by investors | Financial class |

Investors hold these two seats and none on the co-op board. Who elects the chair, who names the
neutral seat jointly, and who may fill the open seat are not published. **[COUNSEL TO REVIEW]**

Neither board can quietly become the other, which the site gives as the reason there are two.

## The five reserved matters

**None of the five can pass without the co-op**, and none can pass on a Holdings vote alone. At
Holdings they belong to the co-op class.

1. Selling land
2. Diluting members
3. Amending the purpose
4. Replacing the manager
5. Related-party deals above a threshold

The site's example: a motion to sell the land, put to a seven-seat vote that goes four to three in
favour. Written as a policy, it passes. Written as a reserved matter, it is blocked.

Not published: what "without the co-op" requires — the co-op's two Holdings seats, the co-op class,
the co-op board or a member vote; which entity's purpose; who the manager is; what counts as diluting
members; and the related-party threshold. **[COUNSEL TO REVIEW]**

## The protocol

**The contracts are open source and held by a foundation nobody owns.** They are in this repository,
under AGPL-3.0. ClearLabs is paid to maintain them today, and is deliberately not the only party that
could. If governance diverged, the co-op could fork the code; because it already funds the maintainer,
the site says it has the capability and not only the right.

## How this meets the code

- **None of it is enforced in this repository.** The contracts know an admin, operators and members
  ([On-chain authority](./on-chain-authority.md)); boards, councils, seats and reserved matters are not
  on the chain. The Command Center records the co-op's decisions and does not enforce them
  ([The Command Center](./command-center.md)).
- **What makes a member.** The site says a deposit is a member's share. In the code, membership is a
  record written when a membership plan is paid for, not when money is deposited
  ([Membership and the co-op](./membership.md)).
- **"A member's savings never fund another member's credit."** The savings vault has no way to lend
  members' savings. Members can also put money in the yield pool on Earn, which lends it to cover card
  spending and shop payouts ([Settlement](../protocol/settlement.md)). Whether the yield pool counts as
  savings for this rule is not settled. **[COUNSEL TO REVIEW]**
- **Who holds the keys.** The site places the protocol's source with the foundation. On the chain,
  admin of the deployed contracts moves to the Ops Safe, which [On-chain authority](./on-chain-authority.md)
  calls the co-op's. The published structure does not say which entity holds the deployed contracts'
  keys. **[COUNSEL TO REVIEW]**
- **The Command Center's outline differs.** Its Governance section starts from its own outline of the
  structure ([`governance.json`](../../packages/command-types/src/fixtures/governance.json)). That
  outline adds a fund-manager company under Holdings and puts Clear Properties under it; gives the
  co-op a majority of ClearLabs rather than all of it; seeds a five-seat co-op board with no seats
  delegated from councils, and a ClearLabs board; and lists eight decisions by who decides them in
  place of the five reserved matters. Its Holdings board matches the seven seats above. Until the
  bylaws are adopted, neither is the binding structure.
