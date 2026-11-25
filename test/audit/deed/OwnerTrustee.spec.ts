import { expect } from "chai";
import { ethers } from "hardhat";
import { deployDeedTrack, mintTrust, mintValidatedLand, subdivideDeed, signTrust, Ctx } from "./fixture";

/*
 * Owner-Trustee: the Beneficiary may serve as trustee of its own trust once the protector appoints it and it
 * accepts. The office follows the beneficial interest -- it ends when the holder serving in it transfers the
 * deed (other than into a Functional Contract's custody), and the new holder may accept -- and the protector
 * removes an owner-trustee only for a permitted reason, installing an eligible successor.
 */
describe("AUDIT deed: owner-trustee", function () {
  let ctx: Ctx;
  let ot: any;

  beforeEach(async () => {
    ctx = await deployDeedTrack();
    // The roles extension ABI, at DeedNFT address (DeedNFT forwards these selectors).
    ot = await ethers.getContractAt("DeedRolesExtension", await ctx.deed.getAddress());
  });

  async function mintWithProtector(owner: any, salt = 1n) {
    return mintTrust(ctx, owner, { salt, protector: ctx.sponsor.address });
  }

  it("the protector appoints, the holder accepts and becomes trustee without being a Qualified Trustee", async () => {
    const { trust, sponsor, alice, bob } = ctx;
    const id = await mintWithProtector(alice);
    await expect(ot.connect(bob).appointOwnerTrustee(id)).to.be.revertedWithCustomError(ot, "NotProtector");
    await expect(ot.connect(sponsor).appointOwnerTrustee(id)).to.emit(ot, "OwnerTrusteeAppointed").withArgs(id, alice.address);
    await expect(ot.connect(bob).acceptOwnerTrustee(id)).to.be.revertedWithCustomError(ot, "NotOwnerTrusteeCandidate");
    await ot.connect(alice).acceptOwnerTrustee(id);
    expect((await trust.trustRecordOf(id)).trustee).to.equal(alice.address);
    const [allowed, pending] = await ot.ownerTrusteeOf(id);
    expect(allowed).to.equal(true);
    expect(pending).to.equal(ethers.ZeroAddress);
  });

  it("is not possible on a deed with no protector of record", async () => {
    const id = await mintTrust(ctx, ctx.alice, { salt: 2n });
    await expect(ot.connect(ctx.alice).appointOwnerTrustee(id)).to.be.revertedWithCustomError(ot, "NotProtector");
  });

  it("follows the beneficial interest: a transfer vacates the office and the new holder may accept", async () => {
    const { trust, sponsor, alice, bob } = ctx;
    const id = await mintWithProtector(alice, 3n);
    await ot.connect(sponsor).appointOwnerTrustee(id);
    await ot.connect(alice).acceptOwnerTrustee(id);

    await expect(ctx.deed.connect(alice).transferFrom(alice.address, bob.address, id))
      .to.emit(ctx.trust, "OwnerTrusteeVacated").withArgs(id, alice.address, bob.address);
    expect((await trust.trustRecordOf(id)).trustee).to.equal(ethers.ZeroAddress);
    expect((await ot.ownerTrusteeOf(id))[1]).to.equal(bob.address);

    await expect(ot.connect(alice).acceptOwnerTrustee(id)).to.be.revertedWithCustomError(ot, "NotOwnerTrusteeCandidate");
    await ot.connect(bob).acceptOwnerTrustee(id);
    expect((await trust.trustRecordOf(id)).trustee).to.equal(bob.address);
  });

  it("keeps the office when the deed goes into a Functional Contract's custody", async () => {
    const { trust, sponsor, alice, subdivide } = ctx;
    const id = await mintValidatedLand(ctx, alice, 0n, "Parcel OT", { protector: sponsor.address });
    await ot.connect(sponsor).appointOwnerTrustee(id);
    await ot.connect(alice).acceptOwnerTrustee(id);
    await subdivideDeed(ctx, alice, id, 2, true);
    expect(await ctx.deed.ownerOf(id)).to.equal(await subdivide.getAddress());
    expect((await trust.trustRecordOf(id)).trustee).to.equal(alice.address);
  });

  it("cannot be replaced by setTrustee; removal needs a permitted reason and an accepting successor", async () => {
    const { trust, sponsor, alice, trustee } = ctx;
    const id = await mintWithProtector(alice, 4n);
    await ot.connect(sponsor).appointOwnerTrustee(id);
    await ot.connect(alice).acceptOwnerTrustee(id);

    let nonce = (await trust.trustRecordOf(id)).nonce;
    let acc = await signTrust(ctx, trustee, "TrusteeAcceptance", { tokenId: id, trustee: trustee.address, nonce });
    await expect(trust.connect(sponsor).setTrustee(id, trustee.address, acc)).to.be.revertedWithCustomError(ctx.trust, "OwnerTrusteeRemovalOnly");
    await expect(ot.connect(sponsor).removeOwnerTrustee(id, 0, ethers.ZeroHash, trustee.address, acc))
      .to.be.revertedWithCustomError(ot, "InvalidRemovalReason");
    await expect(ot.connect(alice).removeOwnerTrustee(id, 1, ethers.ZeroHash, trustee.address, acc))
      .to.be.revertedWithCustomError(ot, "NotProtector");

    await expect(ot.connect(sponsor).removeOwnerTrustee(id, 1, ethers.id("holder asked"), trustee.address, acc))
      .to.emit(ot, "OwnerTrusteeRemoved").withArgs(id, alice.address, trustee.address, 1, ethers.id("holder asked"));
    expect((await trust.trustRecordOf(id)).trustee).to.equal(trustee.address);
    expect((await ot.ownerTrusteeOf(id))[0]).to.equal(false);
    await expect(ot.connect(alice).acceptOwnerTrustee(id)).to.be.revertedWithCustomError(ot, "NotOwnerTrusteeCandidate");
  });

  it("leaves every other deed's trustee rules as they were", async () => {
    const { trust, sponsor, alice, trustee } = ctx;
    const id = await mintWithProtector(alice, 5n);
    const nonce = (await trust.trustRecordOf(id)).nonce;
    const acc = await signTrust(ctx, alice, "TrusteeAcceptance", { tokenId: id, trustee: alice.address, nonce });
    await expect(trust.connect(sponsor).setTrustee(id, alice.address, acc)).to.be.reverted;
    expect((await trust.trustRecordOf(id)).trustee).to.equal(trustee.address);
  });
});
