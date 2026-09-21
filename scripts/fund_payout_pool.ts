import hre from "hardhat";

/*
 * Put working capital into the PayoutPool.
 *
 * Whoever funds it holds the positions that money pays for and earns carry on the float they bear,
 * so this is deliberately a script somebody runs as a chosen address rather than something a sweep
 * does. Amount in whole USDC: FUND_USDC=6.
 *
 *   npx hardhat run scripts/fund_payout_pool.ts --network base-sepolia
 */
const { ethers } = hre;

const POOL = process.env.PAYOUT_POOL_84532 || "0xe9d1bb0cbDFf7e1Ef8Ff30104C21318c3Bca7D66";
const USDC = process.env.USDC_84532 || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

async function main() {
  const [signer] = await ethers.getSigners();
  const amount = ethers.parseUnits(process.env.FUND_USDC || "6", 6);
  const u = (v: bigint) => ethers.formatUnits(v, 6);

  const usdc = await ethers.getContractAt(
    ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"],
    USDC,
  );
  const pool = await ethers.getContractAt(
    [
      "function FUNDER_ROLE() view returns (bytes32)",
      "function hasRole(bytes32,address) view returns (bool)",
      "function grantRole(bytes32,address)",
      "function fund(uint256)",
      "function held() view returns (uint256)",
      "function capitalOf(address) view returns (uint256)",
      "function idleCapitalOf(address) view returns (uint256)",
    ],
    POOL,
  );

  const balance: bigint = await usdc.balanceOf(signer.address);
  console.log(`funder   ${signer.address}`);
  console.log(`holds    ${u(balance)} USDC`);
  console.log(`funding  ${u(amount)} USDC`);
  if (amount === 0n) throw new Error("Nothing to fund. Set FUND_USDC to an amount.");
  if (balance < amount) throw new Error(`Only ${u(balance)} USDC there; asked for ${u(amount)}.`);

  const role = await pool.FUNDER_ROLE();
  if (!(await pool.hasRole(role, signer.address))) {
    console.log("granting FUNDER_ROLE…");
    await (await pool.grantRole(role, signer.address)).wait(1);
  }

  await (await usdc.approve(POOL, amount)).wait(1);
  const held: bigint = await pool.held();
  const tx = await pool.fund(amount);
  await tx.wait(1);
  console.log(`funded   ${tx.hash}`);

  /*
   * Wait for the node to agree with itself before reporting.
   *
   * A read taken the moment a transaction is mined can still be served from the previous state:
   * this printed zeros for a funding that had in fact landed, which is a worse outcome than
   * printing nothing, because it invites somebody to send the money a second time. So it polls
   * until `held` moves off what it was, and reports what the chain then says.
   */
  let now: bigint = held;
  for (let i = 0; i < 20 && now === held; i++) {
    now = await pool.held();
    if (now === held) await new Promise((r) => setTimeout(r, 1500));
  }
  if (now === held) {
    throw new Error(
      `Sent ${tx.hash}, but the pool still holds ${u(held)} USDC. ` +
        "Check the transaction before funding again — it may simply not have been seen yet.",
    );
  }

  console.log({
    poolHeld: u(now),
    capitalOfFunder: u(await pool.capitalOf(signer.address)),
    idleCapitalOfFunder: u(await pool.idleCapitalOf(signer.address)),
    funderUSDCLeft: u(await usdc.balanceOf(signer.address)),
  });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
