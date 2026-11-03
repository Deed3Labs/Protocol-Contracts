# Governance

How the co-op makes decisions, and who holds which keys. **This is the one place these rules are
written down** — member, merchant, investor and operator pages link here rather than restating them.

| Page | What it covers |
|---|---|
| [Membership and the co-op](./membership.md) | Who is a member, on the chain and off it; the Standard and Accelerated plans; how far the bylaws, voting and patronage are built |
| [On-chain authority](./on-chain-authority.md) | Admin, operational and contract roles; the `AccessManager`; the wallet that does each job; the Ops Safe and the hand-over to it; who can upgrade or pause a contract |
| [Parameters and who sets them](./parameters.md) | Savings, equity credits, assurance thresholds, credit and term limits, the reserve target, shop terms and offers — where each lives, who changes it, today's value — and how a rule changes |
| [The Command Center](./command-center.md) | Access levels, the two-person rule, preparing Ops Safe transactions, switching sections live, masked details and logged reveals |

The contracts these rules govern are described in [Protocol](../protocol/README.md); deploying them
and handing over the keys is in [Operators](../operators/README.md).

## Not written yet

- The bylaws, member voting and patronage. The member app shows sample content for them and records
  no votes; the adopted bylaws are not in this repository. See
  [Membership and the co-op](./membership.md).
- Who holds each role on each network today. That is a fact about the chain, not the code: the dry
  run of the hand-over scripts reports it ([On-chain authority](./on-chain-authority.md)).
