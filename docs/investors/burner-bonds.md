# BurnerBonds

A BurnerBond is a zero-coupon bond. The buyer pays less than face value today, and whoever holds the
bond at maturity is paid face value. Each bond is one ERC-1155 token with its own id. The proceeds
are held in `BondVault`, not in the AssurancePool. The contracts' full behaviour is in
[Bonds](../protocol/bonds.md); addresses are in the root [`README.md`](../../README.md#deployed-addresses).

## Buying a bond

**`BurnerBondDeposit.makeDeposit(token, faceValue, maturityDate, discountPercentage)` does the whole
purchase in one transaction.** It takes the price from the buyer, sends it straight to the BondVault,
mints the bond to the buyer, and books the vault's obligation (principal, face value and maturity).
If any step fails, nothing happens.

It refuses a purchase when:

- the token is not the vault's reserve token;
- the collection has been deactivated by its owner (bonds already sold still redeem and roll);
- the face value is outside the factory's bounds, or the maturity is in the past or beyond the
  factory's `maxMaturity`;
- `discountPercentage` is above the curve's discount for that maturity.

### How the price is computed

```
price    = faceValue − faceValue × discount / 10,000
discount = minDiscount + (term / maxMaturity) × (maxDiscount − minDiscount)
```

`term` is the time from now to maturity, capped at `maxMaturity`; a term shorter than `minMaturity`
gets no discount. This is the LINEAR curve, the one every deployed collection runs. The bounds are
factory parameters set by its owner ([Bonds](../protocol/bonds.md#the-discount-curve)). The price
charged is always the curve's, whatever `discountPercentage` the buyer passed.

**What a bondholder receives is fixed at purchase:** face value at maturity, against the price paid.
Nothing the co-op earns on the proceeds changes it.

## Where the proceeds go

**Proceeds go to the BondVault.** The vault keeps back a redemption reserve and treats only the rest
as deployable.

```
requiredReserve  = max( face value of bonds maturing within reserveWindow,
                        totalFaceOutstanding × minReserveBps / 10,000 )
deployableExcess = held − (requiredReserve + owedToReserve)        floored at zero
```

**The reserve is derived, not set.** It rises by itself as maturities come inside the window. The
deploy script sets the window at 90 days, and `minReserveBps` starts at 3,000. An operator can change
both with `setReserveTerms`; the floor is bounded to 2,000–10,000 bps, and the window is not bounded.
`owedToReserve` is anything the vault has borrowed from the AssurancePool, which it repays before the
treasury can take anything.

The deployable excess is the only money that leaves the vault other than to a bondholder:

| Outflow | Who | What happens to it |
|---|---|---|
| `withdrawDeployable(amount, to)` | `TREASURY_ROLE`, the co-op's Safe | Leaves the contracts. What the co-op does with it is not governed by any contract |
| `lendToPayoutPool(amount)` | The PayoutPool, for a merchant claim that has come due | Lent, and repaid with interest when members repay ([What stands behind it](./what-stands-behind.md#merchant-payout-claims)) |

Interest the PayoutPool pays the vault stays in the vault and adds to `held()`. It does not change
what any bondholder is owed; above the reserve it is deployable like any other money.

Money lent to the PayoutPool is not in `held()` while it is out, and `requiredReserve()` does not
wait for it to come back.

## Payment at maturity

**`redeemBond(id)` pays face value to whoever holds the bond once it has matured.**
`batchRedeemBonds(ids)` does the same for up to 50. The bond is burned and `BondVault.settle` pays.
If the vault holds less than the face value, it draws on its backstops in order:

1. the vault's own holdings;
2. the co-op treasury, up to the allowance the Safe has given the vault (capped at the Safe's
   balance);
3. the AssurancePool, from its excess, then its buffer while `hasValidRTD()` holds, and never its
   primary reserve.

If all three together cannot pay, the redemption reverts: nothing moves, and the holder keeps the
unpaid bond. The order and its limits are in [What stands behind it](./what-stands-behind.md#bonds-at-maturity).

**There is no early exit for a holder.** A bond redeems only at or after maturity. The one early
path, `redeemEarly`, is restricted to the collection's liquidator (below). Bonds are transferable
unless pledged, but the contracts provide no market for them and no buy-back.

## Rolling

**At maturity, a holder may roll a bond instead of redeeming it.** `rollBond(id)` burns the matured
bond and issues a new one maturing `rollTerm` from now (365 days by default). No cash moves: the
matured face value buys the new bond at the curve's discount for the new term, so

```
newFace = oldFace × 10,000 / (10,000 − discount)
```

Nothing rolls on its own. The holder calls `rollBond`; `redeemBond` pays out regardless of the roll
setting. A holder can opt a bond out of rolling with `setAutoRollOptOut`, after which `rollBond`
refuses it. A pledged bond's pledge moves to the new bond.

## Bonds as collateral

**A member can pledge a bond against credit.** Bonds are registered in `CollateralRegistry` as
`BOND`, counted at 95% (`9_500` bps) of their present value. `presentValueOf(id)` accretes
straight-line from the price paid to face value over the bond's term, and is face value from maturity
on. Limits and haircuts are in [Credit](../protocol/credit.md#collateral-and-the-ceiling).

- A bond that is pledged, with credit drawn under it, cannot be transferred, and `BondVault.settle`
  refuses to pay it out, so it cannot be redeemed until the credit is paid down. It can be rolled;
  the pledge moves to the new bond.
- The collection's `liquidator` can `seizeBond` and `redeemEarly`. Early redemption pays
  `presentValueOf` and retires the full face value; the difference stays in the vault. No deploy
  script sets a liquidator, so neither function can be called until the collection's owner sets one.

## Who controls the bonds

| Contract | Gate | Can |
|---|---|---|
| `BondVault` | `DEFAULT_ADMIN_ROLE` | Grant roles; upgrade the vault (UUPS) |
| `BondVault` | `OPERATOR_ROLE` | `setBackstops` (treasury, AssurancePool, PayoutPool), `setReserveTerms` |
| `BondVault` | `TREASURY_ROLE` | `withdrawDeployable` |
| `BurnerBondFactory` | Owner | Discount, maturity and face-value bounds; deactivate a collection |
| `BurnerBond` | Owner | `setBondVault`, `setLiquidator`, `setRollTerm`, `setEncumbranceSource` |

`BurnerBond` and `BurnerBondDeposit` are clones, not upgradeable proxies; the collection's owner can
still point it at a different vault with `setBondVault`. Who holds each of these is in
[Governance](../governance/README.md).
