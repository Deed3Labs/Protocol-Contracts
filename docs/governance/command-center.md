# The Command Center

**The Command Center is the co-op's internal app, at `command.useclear.org`.** Staff, members and
invited investors sign in to it, each with their own access. Its rules: who sees what, when a second
person must approve, how it prepares Ops Safe transactions, how a section goes live, and how
personal details are kept masked. Running and deploying it is covered in
[Operators](../operators/command-center-live-switches.md).

**The server enforces every rule here.** The app's screens follow the server's answers; a person who
bypassed the screens would get the same refusals.

## Who sees what

**Access is set per section, at one of five levels.**

| Level | Allows |
|---|---|
| None | Nothing |
| Totals | Co-op aggregates only: nothing that could point to one person |
| See | Reading the section, with personal details masked |
| Propose | Asking for a change |
| Approve | Approving someone else's proposal, and revealing personal details |

The sections are Home, Growth, Field, Members, Merchants, Shop, Money, Build (the contracts),
Community, Governance, Records, Team and Settings.

A person's levels come from their group, or from custom levels set for them alone. Anyone with a
Clear account gets at least the levels set for all members. Someone whose access is turned off,
or an investor whose access has passed its expiry date, gets nothing.

**Signing in.** A Clear sign-in alone is not enough: the person must be recognised as a member, or
have been invited. The Command Center needs no wallet to sign in, so an outside accountant or an
investor can use it, and it keeps its own sessions, separate from the member app. The first admin is
named in the server's settings.

## The two-person rule

**Nobody approves their own proposal.** The server refuses it, and so does a check in the database
itself, on every table that holds an approval: proposals, outside actions, settings changes and
exports.

These need a second person:

- **Giving anyone Approve** on any section. It waits for another admin.
- **Anything proposed by someone who can only propose.**
- **Money** over the limit set in Settings: shop refunds and supplier purchases.
- **Every on-chain change**: a shop's cap, switching a shop on or off, the payout run, a top-up of
  the payout pool.
- **Invites**: sending a batch, or changing how many go out at a time.
- **A member vote** being put forward.
- **A list with names taken out of the app** (an export).
- **Changing a setting.**

A waiting proposal shows in Home under Needs you for everyone who can see that section, and runs once
someone else approves it.

**Outside acts are recorded, not carried out.** When an action means doing something outside the
Command Center (a payout, a refund, a restock order, a Safe signature, sending invites), it is saved
to an outbox for the connection that will carry it out, and the person is told so.

## Ops Safe transactions

**The Command Center never holds a key.** It builds each Ops Safe transaction and the hash to be
signed; the signer signs with their own wallet; the Command Center checks that the signature comes
from that person's linked wallet and that the wallet is an owner of the Safe, then passes it to
Safe's Transaction Service. The transaction is executed in Safe{Wallet}.

- **A signer** is a person whose linked wallet owns the Safe. Linking takes a one-time signed
  message; each person links one wallet.
- **What it can build:** a shop's cap, switching a shop on or off, the payout run, a payout pool
  top-up, and any contract function chosen by contract, function and arguments, checked against the
  deployed contract's interface.
- **What it does not do:** hand admin roles over to the Safe, or move operational roles. Those are
  done outside it ([On-chain authority](./on-chain-authority.md#the-ops-safe)).
- **A waiting period** between the last signature and a change taking effect: Not available yet.

## Going live

**Switching a section from the Command Center's own records to live sources is a setting on its
server, not a control in the app.** No access level lets anyone switch a section live from inside
the Command Center; it is changed by whoever runs the server. Which sources each section reads once
live is in [The Command Center's live switches](../operators/command-center-live-switches.md).

## Personal details

**Names, emails, phone numbers and addresses leave the server masked.** At See and above, a name
arrives as a first letter and dots. At Totals, member rows carry no name, member number or dates,
only what the overview counts by.

**A reveal is logged before anything is shown.** Seeing a person's details in full needs Approve on
that section and a reason. The reveal is written to the log (who, whose details, which field, and
why) before the details are sent. A reveal without a reason is allowed only as a rush, and is
flagged in the log; Settings can turn the reason requirement off. Records → Reveals lists every
reveal.

**People in the Admin group** can show members' names on screen without giving a reason, and those
showings are not logged.

**A whole list with names is an export.** It needs an export approved by a second person, can be
used once, and is logged as a reveal with the reason it was approved for.

**Shared documents** are view-only links that expire after 1, 7 or 30 days. Only a fingerprint of
the link is stored, and every opening is logged.

## Settings

Settings → Rules and limits holds the numbers the Command Center enforces, such as the amount above
which a refund needs a second person. Changing one is a proposal someone else approves.

Some rules there are **locked**: shown with where they are decided (a vote, the bylaws, the law, or
the server itself) but not changeable in the Command Center. A locked rule says where the decision
belongs; it is not a way to make it. Rules that belong to the members have no process in the
software yet ([Membership and the co-op](./membership.md)).

## The record

Actions, approvals and reveals are written to an append-only audit log. The log is never pre-filled.
