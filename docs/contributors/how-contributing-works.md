# How contributing works

What the public website says about contributing land or property, step by step, and what the code
does at each step. This is a description of mechanics, not an offer, and not tax or legal advice; see
the notice in the [section index](./README.md). [COUNSEL TO REVIEW]

## The structure, as the website describes it

**A contribution is made to a company, not to the co-op's members.** As the website describes it,
contributed property is held by **Clear Properties**, a company under **Clear Capital Holdings**,
and a contributor receives shares in Clear Properties. [COUNSEL TO REVIEW]

The companies, their boards, and the five reserved matters that need the co-op's agreement are
described once, in [Governance → The co-op's structure](../governance/structure.md) (a draft until
the bylaws are adopted). None of them is in the code, and the documents that create them are not in
this repository.

## The four steps

The website describes a contribution as four steps, none of which is a sale.

1. **The property goes in.** The deed goes into a nominee trust, with Clear Properties as its
   beneficiary, instead of to a buyer. [COUNSEL TO REVIEW]
2. **The contributor receives shares.** One share for each dollar of the property's appraised value.
   Nothing is settled in cash. See [What shares are](./shares.md).
3. **The property's income is handled at the project.** Rent is earned at the property, which pays
   its own costs first; what remains is distributed to every holder pro rata. See
   [What contributors receive](./what-contributors-receive.md).
4. **Everyone holds on the same terms.** Clear Capital's own position is in the same pool, with no
   priority and no preferred return.

The website says the steps are the same at any size, from one property to a portfolio, and that what
changes with size is the diligence, not the structure.

## What kinds of property

The website names rental property — ideally paid off — and raw land. It describes backyards
separately, on its housing page, as a ground lease rather than a contribution; that arrangement is not
covered here.

## A contribution is meant to be held

**The website says a contribution is designed to be held, not traded.** It says the rules that make
the tax deferral work also make moving property in and out every couple of years unworkable, and
that those rules look at a window of seven years. See [Tax basics](./tax-basics.md#the-holding-period).
[COUNSEL TO REVIEW]

## How it starts

The website publishes no terms, rate or projected return. It says anything beyond its description
happens in a private conversation, with documents sent to the contributor's own advisers, and under
an applicable exemption. [COUNSEL TO REVIEW]

## On the chain

**No step of a contribution is carried out by a contract in this repository.**

- The nominee trust, the appraisal and the issue of shares are off-chain.
- The protocol can record a property as a T-Deed, a token from `DeedNFT`, of the land or estate type;
  its metadata templates include a holding-entity field and appraisal fields. Nothing links a
  contribution to a T-Deed, and the website does not say a contributed property is recorded as one.
  No service mints T-Deeds yet ([On-chain authority](../governance/on-chain-authority.md#the-wallets-that-do-each-job)).
- The Deed track's subdivision and fractionalization contracts are not used for contributions. See
  [What shares are](./shares.md#on-the-chain) and
  [Deeds and real-world assets](../overview/deeds-and-real-world-assets.md).
