# Membership and the co-op

Who is a member, what the two plans are, and how far the co-op's own rules — bylaws, voting,
patronage — are built into the software today.

## Who is a member

**Having a Clear account and being a co-op member are different things in the code.** Anyone who
signs up has an account. Membership is a record on the chain, written once a membership plan is paid
for.

| | What it is | Where it is kept |
|---|---|---|
| **An account** | A sign-in, a wallet and a profile in the member app | Clear's server |
| **A membership** | An active record with a plan and an expiry date | `MembershipRegistry`, on the chain |

When a plan is paid, the server writes the member's record to `MembershipRegistry`: their wallet,
their plan, an expiry date and a fingerprint of their details (a hash; no personal details go on the
chain). A Standard record stops counting once its expiry date passes, and when a Standard
subscription is cancelled or goes unpaid the server marks the record revoked.

The wallet that writes these records is the **membership registrar**. Unless a separate registrar is
set, it is the credit operator's wallet ([On-chain authority](./on-chain-authority.md)). The deployer
key never does it.

The credit contracts ask `AccessManager` whether someone is a member. It answers yes for an active,
unexpired record in `MembershipRegistry`, and also for anyone holding its own `MEMBER` or `OPERATOR`
role, or the admin role. Taking away `AccessManager`'s `MEMBER` role does not end a membership
recorded in the registry.

## The two plans

| | Standard | Accelerated |
|---|---|---|
| Billed | Yearly, as a subscription | Once |
| Membership record expires | At the end of the paid year | Never |
| Equity-credit multiplier on rent and bills | Starts at 1×, rises with an on-time record, up to 1.5× | 1.5× from the start |

**The plan sets the equity-credit multiplier and nothing else.** It does not change your savings, the
match on your deposits, which protections you can unlock, or your credit. The exact multiplier rules
are in [Parameters](./parameters.md).

Prices are set in the billing provider (Stripe), not in this repository, so they are not stated here.

## Bylaws, voting and patronage

**These are not built into the software yet.**

The member app has pages for them — the bylaws, voting history and a ballot, and patronage — but in
this code they are drawn from sample content: the bylaws text, the ballot and its options, past votes
and the patronage figures are examples, and a vote cast there is not recorded anywhere. The adopted
bylaws are not in this repository.

The Command Center has a Governance section for the co-op's own records — its legal entities, boards
and seats, agendas, resolutions, meetings and filings. It starts with every entity marked as planned
and every seat empty, and holds only what people enter. Proposing a member vote there needs a second
person to approve, and is recorded for someone to carry out; the Command Center does not run a
ballot. See [The Command Center](./command-center.md).

When member voting, the bylaws and patronage are built, this page is where their rules will be
written.

## Not written yet

- The bylaws: who may join, one member one vote, meetings, and how the bylaws are amended
- Patronage: how any surplus is shared among members
- Which decisions belong to the members, which to a board, and which to staff
