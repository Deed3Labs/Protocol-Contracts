import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployDeedTrack, mintTrust, k, Ctx, KIND_CUSTODY, KIND_COOP_AGENT } from "../audit/deed/fixture";

const ONE = 10n ** 6n;
const coder = ethers.AbiCoder.defaultAbiCoder();

/*
 * The RedemptionAgent holds a home's Coop-policy deed while its member pays toward it, and hands it to them
 * when their Housing Allowance reaches the price -- read from the HousingAllowanceRecord, which it marks
 * redeemed. Later sales by the member still go through the CoopTransferAgent and its first refusal.
 */
describe("RedemptionAgent", function () {
  let ctx: Ctx;
  let record: any, agent: any, writer: any, member: any, other: any;
  let home: bigint;
  const PRICE = 1_000n * ONE;

  const program = (c: Ctx) => ({
    programId: k("coop"), sponsor: c.sponsor.address, titleAdministrator: c.trustee.address, paramsHash: k("coop-params"),
    rofrPeriodDays: 0, completionWindowDays: 0, versionConsentRequired: true,
  });

  beforeEach(async function () {
    ctx = await deployDeedTrack();
    const s = await ethers.getSigners();
    [writer, member, other] = [s[15], s[16], s[17]];

    const usdc = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
    record = await upgrades.deployProxy(
      await ethers.getContractFactory("HousingAllowanceRecord"),
      [ctx.deployer.address, await usdc.getAddress(), ethers.ZeroAddress],
      { kind: "uups" }
    );
    await record.grantRole(await record.HOUSING_WRITER_ROLE(), writer.address);

    agent = await (await ethers.getContractFactory("RedemptionAgent")).deploy(await ctx.deed.getAddress(), await record.getAddress());
    await ctx.fcRegistry.register(await agent.getAddress(), KIND_CUSTODY | KIND_COOP_AGENT);
    await record.setDeedContract(await agent.getAddress());

    // The program sponsor (Clear) holds the home's Coop deed; the member signs an ELPA for it.
    home = await mintTrust(ctx, ctx.sponsor, { program: program(ctx), trustee: ethers.ZeroAddress, transferPolicy: 2 });
    await record.connect(writer).open(member.address, home, PRICE, 0, k("open"));
  });

  async function deposit(who = member, from = ctx.sponsor) {
    await ctx.deed.connect(from)["safeTransferFrom(address,address,uint256,bytes)"](
      from.address, await agent.getAddress(), home, coder.encode(["address"], [who.address])
    );
  }

  it("takes the deed from the sponsor for the member holding the live record", async function () {
    await deposit();
    expect(await ctx.deed.ownerOf(home)).to.equal(await agent.getAddress());
    expect(await agent.beneficialOwnerOf(home)).to.equal(ctx.sponsor.address);
    expect((await agent.holdOf(home)).member).to.equal(member.address);
  });

  it("accepts deeds only from DeedNFT itself", async function () {
    await expect(
      agent.connect(other).onERC721Received(other.address, ctx.sponsor.address, home, coder.encode(["address"], [member.address]))
    ).to.be.revertedWithCustomError(agent, "NotDeedNFT");
  });

  it("refuses a deposit naming anyone but the occupant", async function () {
    await expect(deposit(other)).to.be.revertedWithCustomError(agent, "NotOccupant");
  });

  it("refuses a non-Coop deed", async function () {
    const open = await mintTrust(ctx, ctx.sponsor, { salt: 9n });
    await expect(
      ctx.deed.connect(ctx.sponsor)["safeTransferFrom(address,address,uint256,bytes)"](
        ctx.sponsor.address, await agent.getAddress(), open, coder.encode(["address"], [member.address])
      )
    ).to.be.revertedWithCustomError(agent, "NotCoopDeed");
  });

  it("will not redeem before the Housing Allowance reaches the price", async function () {
    await deposit();
    await record.connect(writer).recordPayment(member.address, home, PRICE - 1n, k("p1"));
    await expect(agent.redeemHome(home)).to.be.revertedWithCustomError(record, "HousingNotRedeemable");
  });

  it("hands the deed to the member at the price, marks the record redeemed, and needs no first-refusal window", async function () {
    await deposit();
    await record.connect(writer).recordPayment(member.address, home, PRICE + 50n * ONE, k("p1"));
    await expect(agent.connect(other).redeemHome(home)).to.emit(agent, "Redeemed").withArgs(home, member.address);
    expect(await ctx.deed.ownerOf(home)).to.equal(member.address);
    const r = await record.recordOf(member.address, home);
    expect(r.status).to.equal(2n);
    expect(r.refundDue).to.equal(50n * ONE);
    await expect(agent.redeemHome(home)).to.be.revertedWithCustomError(agent, "NotHeld");
  });

  it("only the agent the record names can mark a home redeemed", async function () {
    await record.connect(writer).recordPayment(member.address, home, PRICE, k("p1"));
    await expect(record.connect(other).markRedeemed(home)).to.be.revertedWithCustomError(record, "HousingNotDeed");
  });

  it("gives the deed back to the depositor only once the record is no longer live", async function () {
    await deposit();
    await expect(agent.connect(ctx.sponsor).release(home)).to.be.revertedWithCustomError(agent, "StillLive");
    await expect(agent.connect(other).release(home)).to.be.revertedWithCustomError(agent, "NotDepositor");
    await record.connect(writer).end(member.address, home, 0, k("end"));
    await agent.connect(ctx.sponsor).release(home);
    expect(await ctx.deed.ownerOf(home)).to.equal(ctx.sponsor.address);
  });
});
