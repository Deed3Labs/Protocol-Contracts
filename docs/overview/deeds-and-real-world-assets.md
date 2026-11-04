# Deeds and real-world assets

What a Clear Deed is, how the protocol records a home or another real-world asset, and what
subdividing and fractionalizing mean — in plain terms. The technical account is in
[the Deed track](../protocol/README.md#the-deed-track).

## The Clear Deed

**The Clear Deed is the finish line for a member: a home title, free of debt, earned by being
consistent.** It is not a mortgage and it is not bought with a loan. Members work toward it with
equity credits, earned by saving and by paying rent on time. How that works in the app is in
[Your Clear Deed](../members/clear-deed-and-membership.md#your-clear-deed).

## The T-Deed

**On the chain, a property is recorded as a T-Deed: a token issued by the `DeedNFT` contract.** Each
T-Deed stands for one asset and carries its record with it:

- **What kind of asset it is** — see [Asset types](#asset-types).
- **A definition**: the description that identifies the asset, such as a parcel's legal description.
- **An operating agreement**: a link to the agreement that governs it.
- **Its details**: location, size, value sources and so on, as named fields.
- **Its validator, and whether it has been validated** — see [Validators](#validators).

A T-Deed can be transferred to someone else, though the contract can limit which marketplaces may
handle it. Its owner can also give it up, which removes it and its record.

**Where it stands.** The Deed track runs on Base Sepolia, a test network, and has not been audited.
Issuing T-Deeds for real properties: Not available yet. Turning a member's progress into a recorded
Clear Deed in the app: Not available yet. See
[Status, security and licensing](./status-and-security.md).

## Asset types

`DeedNFT` supports four kinds of asset. Each has a page on what a validator checks.

| Type | What it is | A validator checks for, by default | More |
|---|---|---|---|
| Land | A parcel of land | Country, state, county, parcel number, legal description | [Land](../protocol/deed-track/assets/land-assets.md) |
| Estate | Land with a building on it — a house, for example | The same as land | [Estates](../protocol/deed-track/assets/estate-assets.md) |
| Vehicle | A car, truck or other vehicle | Make, model, year, VIN | [Vehicles](../protocol/deed-track/assets/vehicle-assets.md) |
| Commercial equipment | Business machinery and equipment | Manufacturer, model, serial number, year | [Commercial equipment](../protocol/deed-track/assets/commercial-equipment.md) |

For every type, a validator by default also requires a definition and a recognised operating
agreement. A home is recorded as land or as an estate.

## Validators

**A validator is the party that vouches for a T-Deed's record.** Validators are registered in a
registry, and each says which asset types it handles. When a T-Deed is created, a validator is
chosen for it (or the default one is used), and the validator may charge a service fee for it.

When a validator reviews a T-Deed, the contract checks that the required details for its type are
filled in and that its operating agreement is one the validator recognises, then marks the T-Deed
valid or not valid. **The contract can only check that the details are there.** It cannot see county
records or a vehicle register, so whether the details are true rests on the validator.

If the owner changes a T-Deed's details, it goes back to not validated until a validator reviews it
again. A validator can change the details without that reset.

More: [the validation system](../protocol/deed-track/validation-system.md).

## Subdividing

**Subdividing splits one property into separate units, each with its own token.** Think of lots in a
parcel, or homes on one piece of land.

- Only land and estates can be subdivided, and only once the T-Deed has been validated.
- The owner sets how many units there are, then issues each unit to whoever should hold it. Each
  unit is unique: it stands for one particular part of the property, not a share of the whole.
- Each unit can be validated on its own.
- The T-Deed itself stays with its owner. The subdivision can only be closed once every unit that
  was issued has been given up by its holder, which is possible only while the owner allows it.

The contract is `Subdivide`; its units are ERC-1155 tokens. More:
[subdivision](../protocol/deed-track/subdivision.md).

## Fractionalizing

**Fractionalizing locks one asset away and issues shares in it.** The asset can be a whole T-Deed or
a single subdivided unit.

- The owner hands the asset to the `Fractionalize` contract, which holds it, and a new share token
  (a `FractionToken`) is created for it with a fixed maximum number of shares.
- The person who locked the asset issues the shares, and can set a limit on how many any one wallet
  may hold. Shares can be passed on like other tokens.
- To take the asset back out, someone must hold every share, or, by a second route, at least the
  percentage chosen when it was locked (51 to 100 percent). Unlocking cancels all the shares.
- **The contracts pay nothing to share holders.** A share records part-ownership of the locked asset;
  it does not carry rent or any other payment.
- The contract does not itself require the asset to be validated before it is locked; it lets anyone
  check whether it was.

The share tokens are ERC-20 tokens. More:
[fractionalization](../protocol/deed-track/fractionalization.md).

## Contributing property

People who contribute land or property to Clear Properties, the co-op's property company, receive
shares in that company. Those shares are not tokens, and no contract issues them; see
[Contributors](../contributors/README.md).

## Read more

- [The Deed track](../protocol/README.md#the-deed-track): the full technical account
- [Asset workflows](../protocol/deed-track/asset-workflows.md): the lifecycle, from minting through
  fractionalization
- [Glossary](./glossary.md)
