import { expect } from "chai";
import { ethers } from "hardhat";
import { MockERC20 } from "../../typechain-types/contracts/mocks/MockERC20";
import { ClaimEscrow } from "../../typechain-types/contracts/peripherals/ClaimEscrow";

describe("ClaimEscrow", function () {
  let usdc: MockERC20;
  let claimEscrow: ClaimEscrow;

  let deployer: any;
  let sender: any;
  let settler: any;
  let recipient: any;
  let treasury: any;

  const ONE_USDC = 10n ** 6n;
  const principal = 100n * ONE_USDC;
  const sponsorFee = 3n * ONE_USDC;
  const total = principal + sponsorFee;

  beforeEach(async function () {
    [deployer, sender, settler, recipient, treasury] = await ethers.getSigners();

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();

    const ClaimEscrowFactory = await ethers.getContractFactory("ClaimEscrow");
    claimEscrow = await ClaimEscrowFactory.deploy(
      await usdc.getAddress(),
      treasury.address,
      deployer.address
    );
    await claimEscrow.waitForDeployment();

    await claimEscrow.grantRole(await claimEscrow.SETTLER_ROLE(), settler.address);

    await usdc.mint(sender.address, 1_000_000n * ONE_USDC);
  });

  async function createTransfer(transferId: string, ttlSeconds: number = 3600) {
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const expiry = BigInt(now + ttlSeconds);

    await usdc.connect(sender).approve(await claimEscrow.getAddress(), total);

    await claimEscrow
      .connect(sender)
      .createTransfer(transferId, principal, sponsorFee, expiry, ethers.keccak256(ethers.toUtf8Bytes("recipient")));

    return expiry;
  }

  it("locks funds and stores transfer", async function () {
    const transferId = ethers.keccak256(ethers.toUtf8Bytes("t1"));
    const expiry = await createTransfer(transferId);

    const record = await claimEscrow.transfers(transferId);
    expect(record.sender).to.equal(sender.address);
    expect(record.principalUsdc).to.equal(principal);
    expect(record.sponsorFeeUsdc).to.equal(sponsorFee);
    expect(record.totalLockedUsdc).to.equal(total);
    expect(record.expiry).to.equal(expiry);
    expect(record.claimed).to.equal(false);
    expect(record.refunded).to.equal(false);

    expect(await usdc.balanceOf(await claimEscrow.getAddress())).to.equal(total);
  });

  it("allows settler to claim to wallet and routes sponsor fee to treasury", async function () {
    const transferId = ethers.keccak256(ethers.toUtf8Bytes("t2"));
    await createTransfer(transferId);

    const recipientBefore = await usdc.balanceOf(recipient.address);
    const treasuryBefore = await usdc.balanceOf(treasury.address);

    await claimEscrow.connect(settler).claimToWallet(transferId, recipient.address);

    expect(await usdc.balanceOf(recipient.address) - recipientBefore).to.equal(principal);
    expect(await usdc.balanceOf(treasury.address) - treasuryBefore).to.equal(sponsorFee);

    const record = await claimEscrow.transfers(transferId);
    expect(record.claimed).to.equal(true);

    await expect(
      claimEscrow.connect(settler).claimToWallet(transferId, recipient.address)
    ).to.be.revertedWith("ClaimEscrow: already claimed");
  });

  it("rejects non-settler claim", async function () {
    const transferId = ethers.keccak256(ethers.toUtf8Bytes("t3"));
    await createTransfer(transferId);

    await expect(
      claimEscrow.connect(sender).claimToWallet(transferId, recipient.address)
    ).to.be.reverted;
  });

  it("allows claim to payout treasury", async function () {
    const transferId = ethers.keccak256(ethers.toUtf8Bytes("t4"));
    await createTransfer(transferId);

    const treasuryBefore = await usdc.balanceOf(treasury.address);

    await claimEscrow.connect(settler).claimToPayoutTreasury(transferId);

    expect(await usdc.balanceOf(treasury.address) - treasuryBefore).to.equal(total);

    const record = await claimEscrow.transfers(transferId);
    expect(record.claimed).to.equal(true);
  });

  it("refunds expired transfer to sender", async function () {
    const transferId = ethers.keccak256(ethers.toUtf8Bytes("t5"));
    await createTransfer(transferId, 1);

    await ethers.provider.send("evm_increaseTime", [2]);
    await ethers.provider.send("evm_mine", []);

    const senderBefore = await usdc.balanceOf(sender.address);
    await claimEscrow.connect(recipient).refundExpired(transferId);

    expect(await usdc.balanceOf(sender.address) - senderBefore).to.equal(total);

    const record = await claimEscrow.transfers(transferId);
    expect(record.refunded).to.equal(true);

    await expect(
      claimEscrow.connect(recipient).refundExpired(transferId)
    ).to.be.revertedWith("ClaimEscrow: already refunded");
  });

  it("prevents refund before expiry", async function () {
    const transferId = ethers.keccak256(ethers.toUtf8Bytes("t6"));
    await createTransfer(transferId, 3600);

    await expect(
      claimEscrow.connect(recipient).refundExpired(transferId)
    ).to.be.revertedWith("ClaimEscrow: not expired");
  });
});
