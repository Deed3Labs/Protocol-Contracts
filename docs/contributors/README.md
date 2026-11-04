# Contributors

For people who own land or property and want to understand how contributing it to the co-op's
property company works.

**This section describes mechanics only.** It is not an offer or a solicitation of anything, and it
is not tax, legal or financial advice. It sets no terms, states no rate or return, and makes no claim
about what any contribution will earn or how it will be taxed. Who may contribute, on what terms, and
the legal and tax treatment of any contribution are matters for a contributor's own tax and legal
advisers. [COUNSEL TO REVIEW]

## Where this comes from

**Almost all of contributing happens off the chain.** No contract in this repository takes in a
property, values it, issues shares in it or pays anyone from it. So these pages describe what the
public website says — its pages on contributing land (useclear.org/contribute), on Clear Capital
(useclear.org/capital) and on the co-op (useclear.org/coop) — and, at each step, whether the
protocol has a matching mechanism. Where the website states something legal or tax-related, it is
reported here as what the website describes and marked [COUNSEL TO REVIEW]. The website itself says
it is not a contributor's tax adviser and that nothing on it is advice about anyone's situation.

## Pages

| Page | What it covers |
|---|---|
| [How contributing works](./how-contributing-works.md) | The structure the website describes, the four steps, what kinds of property, why a contribution is meant to be held, and what the code does at each step |
| [What shares are](./shares.md) | The shares a contributor holds, how they are issued, the pool and its terms, the downsides the website lists, and how they differ from the protocol's fraction tokens |
| [What contributors receive](./what-contributors-receive.md) | Shares, how distributions are described, tax distributions and the K-1, what a contributor does not receive, and what anyone can check on the chain |
| [Tax basics](./tax-basics.md) | What the website says about section 721, boot, the deferred gain, the K-1 and the holding period. Every statement is marked for counsel |

## What the code does and does not do

| The website describes | In this repository |
|---|---|
| Property goes into a nominee trust, with Clear Properties as beneficiary | Not in code. A property can be recorded as a T-Deed — see [Deeds and real-world assets](../overview/deeds-and-real-world-assets.md) — but nothing connects a contribution to one |
| Shares issued one per dollar of appraised value | Not in code. No contract values property or issues shares in Clear Properties |
| Distributions paid pro rata, and mandatory tax distributions | Not in code. No contract pays anything to holders of property shares |
| Title records kept on public contracts | Partly. `DeedNFT` records title-style tokens on Base Sepolia, a test network; no service mints them yet |
| Splitting or sharing a single property | The Deed track can split land or an estate into units ([subdivision](../protocol/deed-track/subdivision.md)) and lock an asset behind ERC-20 shares ([fractionalization](../protocol/deed-track/fractionalization.md)). Neither is how contributor shares work — see [What shares are](./shares.md#on-the-chain) |

## Related

- [Deeds and real-world assets](../overview/deeds-and-real-world-assets.md): T-Deeds, subdividing and
  fractionalizing, in plain language.
- [Investors](../investors/README.md): the lending pool and bonds, which are a different thing from
  contributing property.
- [Governance](../governance/README.md): who decides, and who holds the keys to the contracts. The
  co-op's bylaws and the rules of its companies are not yet in this repository; see
  [Membership and the co-op](../governance/membership.md#bylaws-voting-and-patronage).
