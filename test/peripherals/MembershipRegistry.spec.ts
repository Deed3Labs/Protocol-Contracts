import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

const hre = require("hardhat");
const upgrades = hre.upgrades;

describe("MembershipRegistry", function() {
  let membershipRegistry: any;
  let accessManager: any;
  let deployer: SignerWithAddress;
  let member: SignerWithAddress;
  let linkedWallet: SignerWithAddress;

  beforeEach(async function() {
    [deployer, member, linkedWallet] = await ethers.getSigners();

    const MembershipRegistry = await ethers.getContractFactory("MembershipRegistry");
    membershipRegistry = await upgrades.deployProxy(MembershipRegistry, [deployer.address]);
    await membershipRegistry.waitForDeployment();

    const AccessManager = await ethers.getContractFactory("AccessManager");
    accessManager = await upgrades.deployProxy(AccessManager, [deployer.address]);
    await accessManager.waitForDeployment();

    await accessManager.setMembershipRegistry(await membershipRegistry.getAddress());
  });

  it("resolves active registry members through AccessManager", async function() {
    await membershipRegistry.registerMember(member.address, 3, 0, ethers.ZeroHash);

    expect(await membershipRegistry.isActiveMember(member.address)).to.equal(true);
    expect(await accessManager.isMember(member.address)).to.equal(true);
  });

  it("supports linking and unlinking secondary wallets", async function() {
    await membershipRegistry.registerMember(member.address, 3, 0, ethers.ZeroHash);
    const registered = await membershipRegistry.getMemberByWallet(member.address);

    await membershipRegistry.linkWallet(registered.memberId, linkedWallet.address);
    expect(await accessManager.isMember(linkedWallet.address)).to.equal(true);

    await membershipRegistry.unlinkWallet(registered.memberId, linkedWallet.address);
    expect(await accessManager.isMember(linkedWallet.address)).to.equal(false);
  });

  it("removes access when membership is suspended or expired", async function() {
    const latestBlock = await ethers.provider.getBlock("latest");
    const expiresAt = Number(latestBlock!.timestamp) + 3600;

    await membershipRegistry.registerMember(member.address, 2, expiresAt, ethers.ZeroHash);
    const registered = await membershipRegistry.getMemberByWallet(member.address);

    expect(await accessManager.isMember(member.address)).to.equal(true);

    await membershipRegistry.setMemberStatus(registered.memberId, 3);
    expect(await membershipRegistry.isActiveMember(member.address)).to.equal(false);
    expect(await accessManager.isMember(member.address)).to.equal(false);

    await membershipRegistry.setMemberStatus(registered.memberId, 2);
    expect(await accessManager.isMember(member.address)).to.equal(true);

    await ethers.provider.send("evm_increaseTime", [7200]);
    await ethers.provider.send("evm_mine", []);

    expect(await membershipRegistry.isActiveMember(member.address)).to.equal(false);
    expect(await accessManager.isMember(member.address)).to.equal(false);
  });
});
