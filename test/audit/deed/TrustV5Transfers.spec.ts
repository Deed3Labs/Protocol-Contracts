import { expect } from "chai";
import { ethers } from "hardhat";
import {
  deployDeedTrack, mintTrust, mintValidatedLand, subdivideDeed, signTrust, k, coder, Ctx, KIND_CUSTODY, KIND_COOP_AGENT,
} from "./fixture";
import { handOverDeedAdmin } from "../../../deploy/deed_admin_handover";

/*
 * Trust agreement v5: beneficial ownership (item 5), admin limits and the timelock (item 6), subdivision custody
 * (item 7), transfer policies and the Coop transfer agent (item 9). Each title names the brief item it covers.
 */
const DAY = 24 * 60 * 60;
const increase = async (s: number) => { await ethers.provider.send("evm_increaseTime", [s]); await ethers.provider.send("evm_mine", []); };
const LIFETIME = 3;
const SUSPENDED = 3;
const REVOKED = 4;

describe("AUDIT deed: trust agreement v5 transfers and custody", function () {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await deployDeedTrack(); });

  const program = (c: Ctx) => ({
    programId: k("coop"), sponsor: c.sponsor.address, titleAdministrator: c.trustee.address, paramsHash: k("coop-params"),
    rofrPeriodDays: 0, completionWindowDays: 0, versionConsentRequired: true,
  });

  // ---------------------------------------------------------------- item 5 + item 7
  it("items 5 and 7: Subdivide holds the parent for the depositor while units exist and releases it only on deactivation", async () => {
    const { deed, trust, subdivide, alice, carol } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await subdivideDeed(ctx, alice, id, 3, true);
    expect(await deed.ownerOf(id)).to.equal(await subdivide.getAddress());
    expect(await subdivide.beneficialOwnerOf(id)).to.equal(alice.address);
    expect(await trust.beneficialOwnerOf(id)).to.equal(alice.address);
    await subdivide.connect(alice).mintUnit(id, 0, carol.address);
    await expect(subdivide.connect(alice).deactivateSubdivision(id)).to.be.revertedWith("Outstanding units exist");
    await expect(deed.connect(alice).burnAsset(id)).to.be.revertedWith("Not deed owner");
    await subdivide.connect(carol).burnUnit(id, 0);
    await subdivide.connect(alice).deactivateSubdivision(id);
    expect(await deed.ownerOf(id)).to.equal(alice.address);
    expect(await subdivide.beneficialOwnerOf(id)).to.equal(ethers.ZeroAddress);
  });

  // ---------------------------------------------------------------- item 6
  it("item 6: pause never blocks a burn or a trust-role change, and admin has no path to a deed's holder, trustee or protector", async () => {
    const { deed, trust, alice, deployer, standby } = ctx;
    const id = await mintValidatedLand(ctx, alice);
    await deed.connect(deployer).pause();
    const nonce = (await trust.trustRecordOf(id)).nonce;
    await trust.connect(alice).setTrustee(id, standby.address,
      await signTrust(ctx, standby, "TrusteeAcceptance", { tokenId: id, trustee: standby.address, nonce }));
    await expect(trust.connect(deployer).setTrustee(id, deployer.address, "0x")).to.be.revertedWithCustomError(trust, "NotProtector");
    await expect(trust.connect(deployer).setProtector(id, deployer.address)).to.be.revertedWithCustomError(trust, "NotProtector");
    await expect(trust.connect(deployer).electAgreementVersion(id, ethers.ZeroHash, [], "0x")).to.be.revertedWithCustomError(trust, "NotHolder");
    await expect(deed.connect(deployer).transferFrom(alice.address, deployer.address, id)).to.be.reverted;
    await deed.connect(alice).burnAsset(id);
  });

  it("item 6: upgrade and pause sit behind the Foundation multisig plus a 7-day TimelockController", async () => {
    const { deed, deployer, carol, operator2 } = ctx;
    const multisig = operator2; // stands in for the Foundation Safe
    const TL = await ethers.getContractFactory("TimelockController");
    const timelock: any = await TL.deploy(7 * DAY, [multisig.address], [multisig.address], ethers.ZeroAddress);
    const c = {
      validatorRegistry: ctx.registry, metadataRenderer: ctx.renderer, validator: ctx.validator, deedNFT: deed,
      fundManager: ctx.fundManager, subdivide: ctx.subdivide, fractionalize: ctx.fractionalize, fractionTokenFactory: ctx.factory,
      functionalContractRegistry: ctx.fcRegistry,
    };
    await handOverDeedAdmin(c, deployer, {
      admin: await timelock.getAddress(), minter: carol.address, remover: multisig.address, requireTimelockDelay: 7 * DAY,
    });
    // neither the deployer nor the multisig can pause directly
    await expect(deed.connect(deployer).pause()).to.be.reverted;
    await expect(deed.connect(multisig).pause()).to.be.reverted;
    // through the timelock: schedule, wait 7 days, execute
    const data = deed.interface.encodeFunctionData("pause");
    const target = await deed.getAddress();
    await timelock.connect(multisig).schedule(target, 0, data, ethers.ZeroHash, ethers.ZeroHash, 7 * DAY);
    await expect(timelock.connect(multisig).execute(target, 0, data, ethers.ZeroHash, ethers.ZeroHash)).to.be.reverted;
    await increase(7 * DAY);
    await timelock.connect(multisig).execute(target, 0, data, ethers.ZeroHash, ethers.ZeroHash);
    expect(await deed.paused()).to.equal(true);
    // a shorter delay is refused by the timelock itself
    await expect(timelock.connect(multisig).schedule(target, 0, data, ethers.ZeroHash, k("salt"), DAY)).to.be.reverted;
    // FC registry additions are timelocked too, removals are immediate by the multisig
    await expect(ctx.fcRegistry.connect(multisig).register(await ctx.validator.getAddress(), KIND_CUSTODY)).to.be.reverted;
    await ctx.fcRegistry.connect(multisig).remove(await ctx.fractionalize.getAddress());
    expect(await ctx.fcRegistry.isActive(await ctx.fractionalize.getAddress())).to.equal(false);
    // a handover to a timelock with less than 7 days is refused
    const short: any = await TL.deploy(DAY, [multisig.address], [multisig.address], ethers.ZeroAddress);
    let threw = "";
    try {
      await handOverDeedAdmin(c, carol, { admin: await short.getAddress(), requireTimelockDelay: 7 * DAY });
    } catch (e: any) { threw = e.message; }
    expect(threw).to.contain("minimum delay");
  });

  // ---------------------------------------------------------------- item 9: Verified
  describe("item 9: transfer policies", () => {
    it("Verified: the recipient needs a membership record that is not revoked or suspended (DECISIONS #9)", async () => {
      const { deed, trust, membership, alice, bob, carol, mallory } = ctx;
      const id = await mintTrust(ctx, alice, { transferPolicy: 1 });
      expect(coder.decode(["uint8"], await deed.getTraitValue(id, k("transferPolicy")))[0]).to.equal(1n);
      await expect(deed.connect(alice).transferFrom(alice.address, bob.address, id))
        .to.be.revertedWithCustomError(trust, "TransferPolicyBlocked").withArgs(1);
      await membership.registerMember(bob.address, LIFETIME, 0, ethers.ZeroHash);
      await deed.connect(alice).transferFrom(alice.address, bob.address, id);
      // (b) bob refuses it: back to the exact address it came from is always allowed, member or not
      expect(await trust.lastFromOf(id)).to.equal(alice.address);
      await deed.connect(bob).transferFrom(bob.address, alice.address, id);
      // a suspended (fraud-flagged) or revoked record does not pass; an expired subscription does
      const latest = (await ethers.provider.getBlock("latest"))!.timestamp;
      await membership.registerMember(carol.address, 2, latest + 100, ethers.ZeroHash);
      await increase(200);
      await deed.connect(alice).transferFrom(alice.address, carol.address, id);
      await membership.registerMember(mallory.address, LIFETIME, 0, ethers.ZeroHash);
      await membership.setMemberStatus(await membership.walletToMemberId(mallory.address), SUSPENDED);
      await expect(deed.connect(carol).transferFrom(carol.address, mallory.address, id)).to.be.revertedWithCustomError(trust, "TransferPolicyBlocked");
      await membership.setMemberStatus(await membership.walletToMemberId(mallory.address), REVOKED);
      await expect(deed.connect(carol).transferFrom(carol.address, mallory.address, id)).to.be.revertedWithCustomError(trust, "TransferPolicyBlocked");
      // (a) burn by the holder is always allowed
      await deed.connect(carol).burnAsset(id);
    });

    it("(c) deposits into an active Functional Contract pass any policy; a removed one takes no new deposits but never traps", async () => {
      const { deed, trust, fractionalize, fcRegistry, alice, bob } = ctx;
      const id = await mintValidatedLand(ctx, alice, 0n, "Parcel F", { transferPolicy: 1 });
      await deed.connect(alice).approve(await fractionalize.getAddress(), id);
      const create = (tokenId: bigint) => fractionalize.connect(alice).createFraction({
        assetType: 0, originalTokenId: tokenId, name: "F", description: "", symbol: "F", collectionUri: "",
        totalShares: 100, burnable: true, approvalPercentage: 51,
      });
      await create(id);
      expect(await trust.beneficialOwnerOf(id)).to.equal(alice.address);
      await fcRegistry.remove(await fractionalize.getAddress());
      // leaving to a non-member is blocked by the policy, but back to the depositor always works
      await expect(fractionalize.connect(alice).unlockAsset({ fractionId: 1, to: bob.address, checkApprovals: false }))
        .to.be.revertedWithCustomError(trust, "TransferPolicyBlocked");
      await fractionalize.connect(alice).unlockAsset({ fractionId: 1, to: alice.address, checkApprovals: false });
      expect(await deed.ownerOf(id)).to.equal(alice.address);
      // no new deposit into the removed contract
      await deed.connect(alice).approve(await fractionalize.getAddress(), id);
      await expect(create(id)).to.be.revertedWithCustomError(trust, "TransferPolicyBlocked");
    });

    it("Open keeps today's behaviour (approved-marketplace list for operators)", async () => {
      const { deed, alice, bob, carol } = ctx;
      const id = await mintValidatedLand(ctx, alice);
      await deed.connect(alice).transferFrom(alice.address, bob.address, id);
      await expect(deed.connect(bob).approve(carol.address, id)).to.be.revertedWith("!mkt");
      await deed.connect(bob).transferFrom(bob.address, carol.address, id);
    });
  });

  // ---------------------------------------------------------------- item 9: Coop
  describe("item 9: Coop policy and the CoopTransferAgent", () => {
    let agent: any;
    beforeEach(async () => {
      agent = await (await ethers.getContractFactory("CoopTransferAgent")).deploy(await ctx.deed.getAddress());
      await ctx.fcRegistry.register(await agent.getAddress(), KIND_CUSTODY | KIND_COOP_AGENT);
    });
    const list = (c: Ctx, from: any, id: bigint, buyer: string) =>
      c.deed.connect(from)["safeTransferFrom(address,address,uint256,bytes)"](
        from.address, agent.target, id, coder.encode(["address", "bytes32"], [buyer, k("terms: $400,000")]));

    it("direct transfers revert; a sale completes only through the agent after the ROFR window", async () => {
      const { deed, trust, alice, bob } = ctx;
      const id = await mintTrust(ctx, alice, { program: program(ctx), trustee: ethers.ZeroAddress, transferPolicy: 2 });
      await expect(deed.connect(alice).transferFrom(alice.address, bob.address, id))
        .to.be.revertedWithCustomError(trust, "TransferPolicyBlocked").withArgs(2);
      await expect(list(ctx, alice, id, bob.address)).to.emit(agent, "Listed");
      expect(await trust.beneficialOwnerOf(id)).to.equal(alice.address);
      await expect(agent.connect(alice).complete(id)).to.be.revertedWithCustomError(agent, "WindowOpen");
      await expect(agent.connect(bob).complete(id)).to.be.revertedWithCustomError(agent, "NotSeller");
      await increase(30 * DAY);
      await expect(agent.connect(alice).complete(id)).to.emit(agent, "Completed");
      expect(await deed.ownerOf(id)).to.equal(bob.address);
      // a plain transfer by the new holder still reverts
      await expect(deed.connect(bob).transferFrom(bob.address, alice.address, id)).to.be.revertedWithCustomError(trust, "TransferPolicyBlocked");
    });

    it("the program sponsor may exercise the right of first refusal for a designee, or waive it", async () => {
      const { deed, alice, bob, carol, sponsor, mallory } = ctx;
      const id = await mintTrust(ctx, alice, { program: program(ctx), trustee: ethers.ZeroAddress, transferPolicy: 2 });
      await list(ctx, alice, id, bob.address);
      await expect(agent.connect(mallory).exercise(id, carol.address)).to.be.revertedWithCustomError(agent, "NotSponsor");
      await expect(agent.connect(sponsor).exercise(id, carol.address)).to.emit(agent, "RofrExercised");
      await agent.connect(alice).complete(id);
      expect(await deed.ownerOf(id)).to.equal(carol.address);

      const id2 = await mintTrust(ctx, alice, { salt: 2n, program: program(ctx), trustee: ethers.ZeroAddress, transferPolicy: 2 });
      await list(ctx, alice, id2, bob.address);
      await agent.connect(sponsor).waive(id2);
      await agent.connect(alice).complete(id2);
      expect(await deed.ownerOf(id2)).to.equal(bob.address);

      // after the window the sponsor can no longer exercise
      const id3 = await mintTrust(ctx, alice, { salt: 3n, program: program(ctx), trustee: ethers.ZeroAddress, transferPolicy: 2 });
      await list(ctx, alice, id3, bob.address);
      await increase(31 * DAY);
      await expect(agent.connect(sponsor).exercise(id3, carol.address)).to.be.revertedWithCustomError(agent, "WindowClosed");
    });

    it("the seller can withdraw any time before completion; a lapsed sale cannot complete; stray deposits are recovered", async () => {
      const { deed, trust, alice, bob } = ctx;
      const id = await mintTrust(ctx, alice, { program: program(ctx), trustee: ethers.ZeroAddress, transferPolicy: 2 });
      await list(ctx, alice, id, bob.address);
      await increase(121 * DAY); // past the 30-day window plus the 90-day completion window
      await expect(agent.connect(alice).complete(id)).to.be.revertedWithCustomError(agent, "CompletionLapsed");
      await agent.connect(alice).withdraw(id);
      expect(await deed.ownerOf(id)).to.equal(alice.address);
      // a plain transferFrom into the agent leaves no listing; anyone can send it back where it came from
      await deed.connect(alice).transferFrom(alice.address, agent.target, id);
      await agent.connect(bob).recover(id);
      expect(await deed.ownerOf(id)).to.equal(alice.address);
      // the agent lists Coop deeds only
      const open = await mintValidatedLand(ctx, alice);
      await expect(list(ctx, alice, open, bob.address)).to.be.revertedWithCustomError(agent, "NotCoopDeed");
      expect(await trust.isTrustDeed(open)).to.equal(true);
    });
  });
});
