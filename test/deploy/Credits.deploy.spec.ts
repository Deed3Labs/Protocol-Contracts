import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployCredits, handOverCredits } from "../../deploy/29_deploy_Credits";
import { deployDeedV5Agents, KIND_CUSTODY, KIND_COOP_AGENT } from "../../deploy/30_deploy_DeedV5";
import { deployDeedNFT } from "../helpers/deed";

const ONE = 10n ** 6n;
const RENT = ethers.encodeBytes32String("RENT");

/*
 * Deploy 29 (Clear Credits and the Housing Allowance) and the agent half of deploy 30 (Deed v5), run on a local
 * chain: what they deploy, how they wire it, the roles they grant, and the handover to a timelock.
 */
describe("DEPLOY credits (29) and Deed v5 agents (30)", function () {
  const quiet = () => {};
  let s: any[];
  let usdc: any;

  beforeEach(async function () {
    s = await ethers.getSigners();
    usdc = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
  });

  async function credits() {
    return deployCredits({
      usdc: await usdc.getAddress(),
      minter: s[1].address,
      reviewers: [s[2].address, s[3].address],
      housingWriter: s[4].address,
      capCredits: 1_000_000n,
      log: quiet,
    });
  }

  it("deploys and wires the credits stack", async function () {
    const c = await credits();
    const P = await c.points.getAddress();
    expect(await c.ledger.networkRegistry()).to.equal(await c.registry.getAddress());
    expect(await c.ledger.merchantRegistry()).to.equal(await c.merchants.getAddress());
    expect(await c.ledger.isSystemRecipient(P)).to.equal(true);
    expect(await c.registry.isIssuerOf(P, await c.ledger.getAddress())).to.equal(true);
    expect(await c.points.cap()).to.equal(1_000_000n * ONE);
    expect(await c.points.housingRecord()).to.equal(await c.housing.getAddress());
    expect(await c.access.hasRole(await c.points.CREDITS_MINTER_ROLE(), s[1].address)).to.equal(true);
    expect(await c.access.hasRole(await c.points.MEMBERS_ROLE(), s[1].address)).to.equal(true);
    expect(await c.housing.hasRole(await c.housing.HOUSING_WRITER_ROLE(), s[4].address)).to.equal(true);
    // The merchant registry is empty for good.
    expect(await c.merchants.hasRole(await c.merchants.DEFAULT_ADMIN_ROLE(), s[0].address)).to.equal(false);
    await expect(c.merchants.registerMerchant(s[9].address, 30, 0, 0)).to.be.reverted;
    // Credits mint and cannot be sent on.
    await c.points.connect(s[1]).mint(s[8].address, 10n * ONE, RENT, ethers.id("p1"));
    await expect(c.ledger.connect(s[8]).transfer(s[9].address, ONE)).to.be.reverted;
    // No reserve token, no payout pool.
    expect(await c.ledger.payoutPool()).to.equal(ethers.ZeroAddress);
  });

  it("refuses the same reviewer twice", async function () {
    await expect(
      deployCredits({ usdc: await usdc.getAddress(), minter: s[1].address, reviewers: [s[2].address, s[2].address], housingWriter: s[4].address, log: quiet })
    ).to.be.rejectedWith("different people");
  });

  it("hands every admin power to the timelock and leaves the deployer none", async function () {
    const c = await credits();
    const timelock = await (await ethers.getContractFactory("TimelockController")).deploy(7 * 86400, [s[5].address], [s[5].address], ethers.ZeroAddress);
    const T = await timelock.getAddress();
    await handOverCredits(c, T, quiet);
    expect(await c.points.owner()).to.equal(T);
    expect(await c.access.hasRole(ethers.ZeroHash, T)).to.equal(true);
    expect(await c.access.hasRole(ethers.ZeroHash, s[0].address)).to.equal(false);
    expect(await c.housing.hasRole(ethers.ZeroHash, T)).to.equal(true);
    expect(await c.housing.hasRole(ethers.ZeroHash, s[0].address)).to.equal(false);
    await expect(c.points.setCap(1n)).to.be.reverted;
  });

  it("deploys the registry and both agents, registers them, sets the deed's registries and names the record's deed contract", async function () {
    const c = await credits();
    const registry: any = await upgrades.deployProxy(await ethers.getContractFactory("ValidatorRegistry"), [], { kind: "uups" });
    const validator: any = await upgrades.deployProxy(await ethers.getContractFactory("Validator"), ["https://v/", "https://a/"], { kind: "uups" });
    const deed: any = await deployDeedNFT([await validator.getAddress(), await registry.getAddress()]);
    const membership = s[7].address; // any address: the deed only reads it for the Verified policy

    const a = await deployDeedV5Agents({
      deed: await deed.getAddress(),
      membershipRegistry: membership,
      housingRecord: await c.housing.getAddress(),
      log: quiet,
    });
    const [coopKinds, coopActive] = await a.fc.kindOf(await a.coop.getAddress());
    expect(coopActive).to.equal(true);
    expect(Number(coopKinds)).to.equal(KIND_CUSTODY | KIND_COOP_AGENT);
    const [rKinds] = await a.fc.kindOf(await a.redemption.getAddress());
    expect(Number(rKinds)).to.equal(KIND_CUSTODY | KIND_COOP_AGENT);
    expect(await c.housing.deedContract()).to.equal(await a.redemption.getAddress());
    // The registries are set once, ever.
    const trust = await ethers.getContractAt("DeedTrustExtension", await deed.getAddress());
    await expect(trust.setTrustRegistries(s[9].address, ethers.ZeroAddress)).to.be.reverted;
  });
});
