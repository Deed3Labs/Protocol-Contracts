import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
  deployAssuranceTimelock, deployAssurancePool, listMoneyPaths, governedCalls, assertNoAssuranceAdmin,
  ASSURANCE_TIMELOCK_DELAY,
} from "../../deploy/assurance_timelock_handover";

/**
 * The Assurance deploy wiring (section 13, decisions 5 and 6), run against a fresh chain: the
 * third timelock, the pool governed by it from its first block, the money-path list, and the
 * governed calls that finish the setup, executed through the timelock with two signers.
 */
describe("Assurance deployment", function () {
  it("deploys a 7-day board timelock and a pool it governs, leaving the deployer nothing", async function () {
    const [deployer, board, a, b, lendingCo, drawer, lossReserve, treasury, disbursement] = await ethers.getSigners();
    await expect(deployAssuranceTimelock(board.address, ASSURANCE_TIMELOCK_DELAY - 1)).to.be.rejectedWith("at least 7 days");
    const timelock: any = await deployAssuranceTimelock(board.address);
    expect(await timelock.getMinDelay()).to.equal(BigInt(ASSURANCE_TIMELOCK_DELAY));

    const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
    const registry: any = await upgrades.deployProxy(await ethers.getContractFactory("NetworkRegistry"), [deployer.address], { kind: "uups" });
    const pool: any = await deployAssurancePool(await usdc.getAddress(), await timelock.getAddress(), await registry.getAddress(), [a.address, b.address]);
    await assertNoAssuranceAdmin(pool, deployer.address);

    // The money-path list: every one given is listed once, and a second run changes nothing.
    const payout = ethers.Wallet.createRandom().address;
    await listMoneyPaths(registry, { PayoutPool: payout });
    await listMoneyPaths(registry, { PayoutPool: payout });
    expect(await registry.moneyPathKindOf(payout)).to.equal(ethers.encodeBytes32String("PAYOUT_POOL"));

    // The governed calls, proposed by the board, approved by two signers, 7 days later.
    const calls = governedCalls(pool, {
      lendingCoOperating: lendingCo.address, lendingCoDraw: drawer.address, lendingCoLossReserve: lossReserve.address,
      coopTreasury: treasury.address, disbursement: disbursement.address,
    });
    const target = await pool.getAddress();
    for (const [i, c] of calls.entries()) {
      await pool.connect(a).approveAction(c.action);
      await pool.connect(b).approveAction(c.action);
      await timelock.connect(board).schedule(target, 0, c.data, ethers.ZeroHash, ethers.toBeHex(i + 1, 32), ASSURANCE_TIMELOCK_DELAY);
    }
    await ethers.provider.send("evm_increaseTime", [ASSURANCE_TIMELOCK_DELAY]);
    await ethers.provider.send("evm_mine", []);
    for (const [i, c] of calls.entries()) {
      await timelock.connect(board).execute(target, 0, c.data, ethers.ZeroHash, ethers.toBeHex(i + 1, 32));
    }
    expect(await pool.payerTags(lendingCo.address)).to.equal(3n);
    expect(await pool.payerTags(treasury.address)).to.equal(12n);
    expect(await pool.drawAddress()).to.equal(drawer.address);
    expect(await pool.lossReserveAddress()).to.equal(lossReserve.address);
    expect(await pool.assuranceDisbursementAddress()).to.equal(disbursement.address);
    await assertNoAssuranceAdmin(pool, deployer.address);
  });
});
