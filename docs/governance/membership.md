# Membership and the co-op

Who is a member, what the two plans are, and where the co-op's own rules (bylaws, voting, patronage)
stand.

## Who is a member

**Having a Clear account and holding a membership are different things.** Anyone who signs up has
an account. A membership is a record on the chain, written once a membership plan is paid for.

| | What it is | Where it is kept |
|---|---|---|
| **An account** | A sign-in, a wallet and a profile in the member app | Clear's server |
| **A membership** | An active record with a plan and an expiry date | The membership registry (`MembershipRegistry`), on the chain |

When a plan is paid, Clear's server writes the member's record to the membership registry: their
wallet, their plan, an expiry date and a fingerprint of their details (a hash; no personal details go
on the chain). A Standard record stops counting once its expiry date passes, and when a Standard
subscription is cancelled or goes unpaid, the server marks the record revoked.

The wallet that writes these records is the **membership registrar**. Unless a separate registrar is
set, it is the credit operator's wallet
([On-chain authority](./on-chain-authority.md#the-wallets-that-do-each-job)). The deployer key never
does it.

The credit contracts ask the access manager (`AccessManager`) whether someone is a member. It answers
yes for an active, unexpired record in the membership registry, and also for anyone holding its own
member or operator role, or the admin role. Taking away the access manager's member role does not end
a membership recorded in the registry.

What makes someone a member of the co-op itself, with a vote, is for the bylaws to set, and they are
not adopted yet.

## The two plans

| | Standard | Accelerated |
|---|---|---|
| Billed | Yearly, as a subscription | Once |
| Membership record expires | At the end of the paid year | Never |
| Equity-credit multiplier on rent and bills | Starts at 1×, rises with an on-time record, up to 1.5× | 1.5× from the start |

**The plan sets the equity-credit multiplier and nothing else.** It does not change your savings,
the match on your deposits, which protections you can unlock, or your credit. The exact multiplier
rules are in [Parameters](./parameters.md#equity-credits).

Plan prices are set in the billing provider (Stripe) and are not listed here.

## Bylaws, voting and patronage

**The bylaws are not adopted yet.** Member voting: **Not available yet.** Patronage (sharing any
surplus among members): **Not available yet.**

How decisions are meant to be made (members, regional councils, the co-op and Holdings boards, the
Delegate Assembly and the five reserved matters) is in [The co-op's structure](./structure.md). It is
a draft until the bylaws are adopted.

The co-op keeps its own governance records (its entities, boards and seats, agendas, resolutions,
meetings and filings) in the Command Center. Putting a member vote forward there needs a second
person to approve, and is recorded for someone to carry out; the Command Center does not run a
ballot. See [The Command Center](./command-center.md#the-two-person-rule).
