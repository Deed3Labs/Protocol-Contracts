# What Clear is

**CLEAR is a money app and a financial co-op, built to help renters become owners.** You save in it,
spend from it, pay your rent through it, and every month of doing that on time moves you toward a
home of your own. Underneath it is the Clear Protocol: the contracts on the Base network that hold
the savings and keep the records.

You don't need to know what a blockchain is. Words in bold that you have not met before are in the
[glossary](./glossary.md).

## Who it is for

- **Renters** who want to save, build a record of paying on time, and work toward owning a home.
  This is who Clear is built around. The member app is for them: [Members](../members/README.md).
- **Shops** that want to take payments from members, and from everyone else, at the counter or
  online: [Merchants](../merchants/README.md).
- **Financial contributors** who put money behind the co-op's lending: [Investors](../investors/README.md).
- **People building on Clear**, or working on its source code: [Developers](../developers/README.md).

## Three layers

**The app.** What a member sees: savings, a card, sending money, paying rent and bills, credit, and
progress toward a home. There are five apps in all — member, merchant, Pay with Clear, rewards and
the Command Center — and one server they all talk to.

**The co-op.** Clear is run as a co-operative. How it makes decisions, and who holds which keys, is
written down in one place: [Governance](../governance/README.md).

**The Clear Protocol.** The contracts that hold savings, keep the credit ledger, pay shops and hold
the reserve. They are open source. If you want the detail, start with
[Protocol](../protocol/README.md).

## The products

**Savings and send run on Base, the public network.** Credit lines, split plans, the card and
payouts to shops run only on the test network for now, where nothing is real money. See
[Status, security and licensing](./status-and-security.md).

### Savings

You deposit USDC, a digital dollar, and receive the same amount of **CLRUSD**, one for one. Your
CLRUSD balance is your savings. It is yours, it is liquid, and you can turn it back into USDC
whenever you want.

**Savings earn no interest.** CLRUSD pays nothing to the people who hold it. What saving does earn
you is equity credits, below.

Your savings sit in the **Equity Savings Account (ESA)**. The contract behind it is
`ESADepositVault`; how it works is in [Savings and send](../protocol/savings.md).

### Equity credits

Equity credits are a separate count from your savings. They are not money and **they can never be
withdrawn or cashed out.** They only ever go toward your Clear Deed.

You earn them two ways:

- **Matched savings.** Each dollar you deposit is matched with an equity credit, up to a monthly
  limit. A match settles after 30 days; take that deposit out sooner and its match is cancelled.
- **Paying on time through Clear Pay.** Rent paid on time earns credits, and so do other bills.

A record of paying on time makes the bill and rent credits add up faster. The exact rules are in
[Parameters and who sets them](../governance/parameters.md).

Equity credits are kept by Clear's server, not by a contract. No contract on the chain holds them.

### Clear Deed

The Clear Deed is the finish line: **a home title, free of debt, earned by being consistent.** It is
not a mortgage. On the chain, a home is recorded as a T-Deed, a token issued by the `DeedNFT`
contract in the Deed track of the protocol. Recording a member's home as a T-Deed: Not available
yet. More in [Deeds and real-world assets](./deeds-and-real-world-assets.md).

### Clear Assurance

Protections from the co-op for the moments that go wrong — for example, rent paid for you if you
lose your job. **Protections unlock as your equity credits grow,** not by which plan you are on. A
claim is read by a person at the co-op.

### Credit lines and split plans

Members can spend on credit, in two separate ways:

- **A credit line** that backs the Clear card and spending at partner shops. How much it allows
  depends on what backs it — your savings, or other things you have pledged.
- **Split plans**, for paying a purchase back in 1, 2, 4, 6 or 12 instalments. These draw on a
  separate limit that starts small and grows as you pay on time.

Credit has a cost, called **carry**. If you pledge savings behind your credit line, the part covering
what you have drawn can be held until you repay it; the rest stays free. More in
[How the money works](./how-the-money-works.md).

### The Clear card

A card for spending anywhere cards are taken. A swipe at a shop outside the Clear network is paid
from the co-op's float, and recorded against your credit line once the payment clears.

### Send

Send money to another wallet, or to an email address or phone number. Someone without an account
can receive by a link; the money waits in escrow until they claim it, and comes back to you if they
never do.

### Pay with Clear

Shops can take Clear online through payment links and a checkout, and the Clear member approves the
payment in their app.

### Rewards

Each shop can have its own branded loyalty app — points, offers and rewards — and there is one hub
for all of them. Separately, the co-op can give each new member a one-time offer to spend; an offer
left unspent expires.

### For shops

The merchant app is a full point of sale. It takes Clear, cards (through Stripe Terminal) and cash,
splits a bill across payments, and sends payment links. Staff charge at the counter; owners manage
payouts, staff and refunds. See [Merchants](../merchants/README.md).

### Membership

**Clear works like a credit union: your savings account is your membership.** Joining is free, with
no buy-in. What you save is your share in the co-op, and every member has one vote, however much
they save. Every member is on the **Standard** plan, which is free. **Accelerated**, an optional paid
plan, is not available yet. See [Membership and the co-op](../governance/membership.md).

## Next

- [How the money works](./how-the-money-works.md) — where each dollar sits, in plain words
- [Status and security](./status-and-security.md) — what is live, on which network, and what has not
  been audited
