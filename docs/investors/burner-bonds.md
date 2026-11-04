# BurnerBonds

A BurnerBond is a zero-coupon bond: the buyer pays less than face value today, and whoever holds the
bond when it matures is paid face value. Nothing is paid in between. Each bond is its own token on
the chain, with its own number.

The money paid for bonds is held in the bond vault (the `BondVault` contract), not in the
AssurancePool. The contracts' full behaviour is in [Bonds](../protocol/bonds.md), and their
addresses are listed under [Deployed addresses](../../README.md#deployed-addresses).

## Buying a bond

**A purchase happens in one transaction.** The buyer's payment goes straight to the bond vault, the
bond is issued to the buyer, and the vault records what it owes: the price paid, the face value and
the maturity date. If any step fails, nothing happens.

A purchase is refused when:

- it is paid in a token other than the one the vault holds (USDC, in the deployed setup);
- the bond series has been closed to new sales by its owner (bonds already sold still redeem and
  roll);
- the face value is outside the allowed range, or the maturity date is in the past or further out
  than the longest term allowed;
- the discount the buyer asks for is larger than the discount set for that term.

### How the price is set

The discount grows in a straight line with the time to maturity:

```
price    = face value − (face value × discount)
discount = smallest discount + (term ÷ longest term) × (largest discount − smallest discount)
```

A term longer than the longest allowed counts as the longest; a term shorter than the shortest
allowed gets no discount. The range is set by the bond factory's owner
([Bonds → The discount curve](../protocol/bonds.md#the-discount-curve)). The buyer always pays the
price this sets, whatever discount they asked for.

**What a bondholder receives is fixed when they buy:** face value at maturity, against the price
paid. Nothing the co-op earns on the money changes it.

## Where the proceeds go

**The bond vault keeps back a redemption reserve, and treats only the rest as free to use.** The
reserve is the larger of:

- the face value of every bond maturing within the reserve window (90 days when deployed);
- a floor across all bonds outstanding (30% of their face value when deployed).

What the vault holds above that reserve, and above anything it owes the AssurancePool, is its
**deployable excess**.

**The reserve is worked out, not set by hand.** It rises by itself as bonds come inside the window.
The vault's operator can change the window and the floor: the floor can be set anywhere from 20% to
100%, and the window has no limit. Anything the vault has borrowed from the AssurancePool is repaid
before the treasury can take anything.

The deployable excess is the only money that leaves the vault other than to pay a bondholder:

| Where it goes | Who sends it | What happens to it |
|---|---|---|
| The co-op's Safe | The holder of the vault's treasury permission, which is the Safe | It leaves the contracts. No contract governs what the co-op does with it |
| The payout pool | The payout pool, for a merchant payout that has come due | Lent, and repaid with carry when members repay ([What stands behind it](./what-stands-behind.md#merchant-payout-claims)) |

The Safe is the co-op's multi-signature wallet: moving money from it needs more than one of its
owners to sign ([On-chain authority](../governance/on-chain-authority.md#the-ops-safe)).

Carry the payout pool pays the vault stays in the vault. It does not change what any bondholder is
owed; above the reserve, it can be withdrawn or lent like any other money.

Money lent to the payout pool does not count as held while it is out, and the reserve does not wait
for it to come back.

## Payment at maturity

**Once a bond has matured, whoever holds it can redeem it for face value.** Up to 50 bonds can be
redeemed in one transaction. The bond is retired and the vault pays. If the vault holds less than
the face value, it draws on its backstops in this order:

1. the vault's own holdings;
2. the co-op's treasury, up to the amount the Safe has allowed the vault to draw, and no more than
   the Safe holds;
3. the AssurancePool: its excess first, then its buffer while its reserve is at target, and never
   its primary reserve.

If all three together cannot pay, the redemption fails: nothing moves, and the holder keeps the
unpaid bond. The order and its limits are in
[What stands behind it](./what-stands-behind.md#bonds-at-maturity).

**A holder cannot exit early.** A bond redeems only at or after maturity. The one early redemption
belongs to the bond series' liquidator (below). Bonds can be transferred unless pledged, but the
contracts provide no market for them and no buy-back.

## Rolling

**At maturity, a holder may roll a bond instead of redeeming it.** Rolling retires the matured bond
and issues a new one, maturing a year later by default. No cash moves: the matured face value buys
the new bond at the discount for the new term, so

```
new face value = old face value ÷ (1 − discount)
```

Nothing rolls on its own. The holder has to choose to roll; redeeming always pays out. A holder can
opt a bond out of rolling, after which it can only be redeemed. If a pledged bond is rolled, the
pledge moves to the new bond.

## Bonds as collateral

**A member can pledge a bond against credit.** A pledged bond counts at 95% of its value today. That
value rises in a straight line from the price paid to face value over the bond's term, and is face
value from maturity on. Limits and haircuts are in
[Credit → Collateral and the ceiling](../protocol/credit.md#collateral-and-the-ceiling).

- While a pledged bond backs credit the member has drawn, it cannot be transferred or redeemed until
  that credit is paid down. It can still be rolled, and the pledge moves to the new bond.
- The bond series' liquidator can seize a bond and redeem it early. Early redemption pays the bond's
  value today and retires its full face value; the difference stays in the vault. No liquidator has
  been named, so neither can happen until the bond series' owner names one.

## Who controls the bonds

- **The bond vault's admin** grants the vault's permissions and can replace its code (an upgrade).
- **The vault's operator** names its backstops (the treasury, the AssurancePool and the payout pool)
  and sets the reserve window and floor.
- **The vault's treasury permission** withdraws the deployable excess.
- **The bond factory's owner** sets the discount, maturity and face-value ranges for new bonds, and
  can close a bond series to new sales.
- **Each bond series' owner** can point the series at a different vault, name its liquidator, set
  the roll term and set where pledges are recorded.

Bond series cannot be upgraded, but their owner can still point them at a different vault. Who holds
each permission is in [Governance → On-chain authority](../governance/on-chain-authority.md).
