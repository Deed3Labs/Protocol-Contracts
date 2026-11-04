# What shares are

What a contributor holds after contributing property, as the public website describes it, and how
that compares with the share tokens the protocol can create. A description of mechanics, not an
offer, and not tax or legal advice; see the notice in the [section index](./README.md).
[COUNSEL TO REVIEW]

## Shares in Clear Properties

**A contributor receives shares in Clear Properties, the company that holds contributed property.**
The website describes them this way. [COUNSEL TO REVIEW]

- **Issued by value.** Property comes in at appraised value, and shares are issued one for each
  dollar of it. A property appraised at $437,000 — the website's worked example — becomes 437,000
  shares.
- **Nothing settled in cash.** There is no cash payment to balance the exchange (the website calls
  this "no boot"). See [Tax basics](./tax-basics.md#no-boot).
- **One pool.** Shares are in a single pool of contributed property, not in the contributor's own
  building. Clear Capital's own position is in the same pool.
- **The same terms for every holder.** No preferred return and no priority for anyone, Clear Capital
  included. The website says there is no arrangement in which someone is paid before another holder.
- **Pro rata.** Whatever is distributed is shared in proportion to shares held. See
  [What contributors receive](./what-contributors-receive.md).

The website's illustration shows Clear Capital's share of the pool shrinking as more property comes
in, and labels its figures as illustrative.

## The downsides the website lists

The website lists five costs of contributing rather than selling, and says the list is the same for
one property or a portfolio.

| | What the website says |
|---|---|
| Liquidity | Shares are illiquid compared with cash |
| Control | The contributor does not control the properties |
| Paperwork | A K-1, which arrives later than a 1099 and costs an accountant's time [COUNSEL TO REVIEW] |
| Deferred tax | The deferred gain still exists, and comes due if the shares are ever sold [COUNSEL TO REVIEW] |
| Concentration | Risk moves from one building to a pool — a change, not a removal |

For larger contributions it adds one more: early properties sit in a single corridor by design, and
anyone assessing a contribution should take that concentration into account.

## On the chain

**No contract issues shares in Clear Properties.** The website does not say the shares are tokens,
and nothing in this repository records them.

The protocol's Deed track does have a way to split ownership of one asset into shares —
`Fractionalize`, with a `FractionToken` for each asset it locks — but it is a different thing:

| | Contributor shares, as the website describes them | Fraction tokens in the code |
|---|---|---|
| What they are a share of | A pool of many contributed properties | One locked T-Deed, or one subdivided unit |
| How many there are | One per dollar of appraised value | Whatever number the asset's owner sets; no contract values anything |
| Who issues them | Clear Properties, off the chain | The person who locked the asset |
| Payments to holders | Distributed pro rata, as described | None — the contracts pay nothing to holders |
| Transfer | Described as illiquid | Transferable ERC-20 tokens, subject to an optional per-wallet limit |

How fractionalizing and subdividing work is in
[Deeds and real-world assets](../overview/deeds-and-real-world-assets.md), with the full account in
[Fractionalization](../protocol/deed-track/fractionalization.md) and
[Subdivision](../protocol/deed-track/subdivision.md).
