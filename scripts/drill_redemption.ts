import hre from "hardhat";
import { getDeployment } from "../deploy/helpers";

/*
 * Rehearses a merchant redemption against a FORK of what is actually deployed.
 *
 * The merchant wallets are Privy wallets: nobody here holds their key, so nobody here can send
 * `redeem` as a merchant on the live chain. A fork removes that problem without pretending the
 * state away -- it is the deployed implementations, the real balances, the real wiring, and an
 * impersonated merchant. What it cannot tell us is whether a merchant's own wallet can pay for
 * gas, because the fork hands it some.
 *
 *   FORK_RPC_URL=https://sepolia.base.org MERCHANT=0x… \
 *     npx hardhat run scripts/drill_redemption.ts
 *
 * The network must be a fork. Without FORK_RPC_URL the `hardhat` network is an empty chain where
 * every address below is unallocated code, and the script says so rather than reporting nonsense.
 *
 * REDEEM (dollars) redeems part of the balance instead of all of it; the default is everything.
 * It changes nothing outside the fork, so it is safe to run repeatedly and worth running before
 * any change to the payout path reaches a network anybody is using.
 */
const { ethers, network } = hre as typeof hre & {
  ethers: typeof import("hardhat").ethers;
};

const USDC = (x: bigint) => ethers.formatUnits(x, 6);

async function main() {
  const forking = (network.config as { forking?: { url?: string } }).forking;
  if (network.name !== "hardhat" || !forking?.url) {
    throw new Error(
      "This drill only runs on a fork. Set FORK_RPC_URL and leave the network as `hardhat`.\n" +
        "Running it against a live network would redeem somebody's real balance.",
    );
  }

  /*
   * One empty block before anything is read.
   *
   * A fork's `latest` IS the forked block, and EDR treats a call there as historical: it wants a
   * hardfork activation history for the remote chain and refuses the call without one, however
   * the config is written. Mining once moves `latest` past the fork point, where the node's own
   * hardfork applies and reads simply work. Nothing else about the state changes.
   */
  await network.provider.send("evm_mine");

  const merchant = process.env.MERCHANT?.trim();
  if (!merchant || !ethers.isAddress(merchant)) throw new Error("Set MERCHANT to the merchant's address.");

  // The deployment record for base-sepolia, because that is what we are forking.
  const at = (name: string) => {
    const record = getDeployment("base-sepolia", name);
    if (!record) throw new Error(`No ${name} recorded for base-sepolia.`);
    return record.address;
  };

  const pool = await ethers.getContractAt("PayoutPool", at("PayoutPool"));
  const credit = await ethers.getContractAt("ClearCredit", at("ClearCredit"));
  const registry = await ethers.getContractAt("MerchantRegistry", at("MerchantRegistry"));
  const usdc = await ethers.getContractAt("IERC20Upgradeable", await pool.reserveToken());
  const yieldPool = await pool.yieldPool();
  const reserve = await pool.reserve();

  const block = await ethers.provider.getBlockNumber();
  console.log(`forked from   ${forking.url} at block ${block}`);
  console.log(`merchant      ${merchant}`);
  console.log(`registered    ${await registry.isRegistered(merchant)}  active ${await registry.isActive(merchant)}`);
  const window = await registry.payoutWindowOf(merchant);
  console.log(`payout window ${window} seconds${window === 0n ? "  (due the moment it is claimed)" : ""}`);

  /*
   * Membership, which is not the same thing as being a registered merchant and is easy to miss.
   *
   * `StableCredit.senderIsMember` gates every outbound transfer, and `redeem` pulls the credits
   * with `transferFrom` -- so a merchant who was registered but never granted membership holds a
   * balance they cannot move, and redemption reverts with no reason string because the deployed
   * build strips them. The fixtures grant it, which is exactly why no test ever noticed.
   */
  const access = await ethers.getContractAt(
    [
      "function isMember(address) view returns (bool)",
      "function isOperator(address) view returns (bool)",
      "function grantMember(address) external",
    ],
    await credit.access(),
  );
  const isMember = await access.isMember(merchant);
  console.log(`network member ${isMember}${isMember ? "" : "  <== CANNOT REDEEM until granted"}`);

  const before = await snapshot();
  report("BEFORE", before);

  if (!isMember) {
    const operator = await firstOperator();
    console.log(`\n0. granting membership as ${operator} (a fork stand-in for an operator tx)`);
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [operator] });
    await network.provider.request({ method: "hardhat_setBalance", params: [operator, "0x8AC7230489E80000"] });
    await (await access.connect(await ethers.getSigner(operator)).grantMember(merchant)).wait();
  }

  /*
   * Impersonated, and given gas. A Privy wallet holding no ETH is a real problem for a real
   * redemption, but it is a problem about funding a wallet rather than about this code path, and
   * the fork is not the place to discover it.
   */
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [merchant] });
  await network.provider.request({ method: "hardhat_setBalance", params: [merchant, "0x8AC7230489E80000"] });
  const asMerchant = await ethers.getSigner(merchant);

  const holds = await credit.balanceOf(merchant);
  const asked = process.env.REDEEM ? ethers.parseUnits(process.env.REDEEM.trim(), 6) : holds;
  const redeeming = asked < holds ? asked : holds;
  if (redeeming === 0n) throw new Error(`${merchant} holds nothing to redeem.`);

  console.log(`\n1. approving the pool for ${USDC(redeeming)}`);
  await (await credit.connect(asMerchant).approve(await pool.getAddress(), redeeming)).wait();

  console.log(`2. redeem(${USDC(redeeming)})`);
  const tx = await (await pool.connect(asMerchant).redeem(redeeming)).wait();
  const redeemed = tx!.logs
    .map((l) => { try { return pool.interface.parseLog(l); } catch { return null; } })
    .find((l) => l?.name === "Redeemed");
  const paidNow = Boolean(redeemed?.args?.paidNow);
  const claimId = redeemed?.args?.claimId ?? 0n;
  console.log(`   paid now: ${paidNow}   claim ${claimId}`);
  for (const log of tx!.logs) {
    try {
      const parsed = pool.interface.parseLog(log);
      if (parsed && parsed.name !== "Redeemed") console.log(`   event ${parsed.name}(${parsed.args.map(String).join(", ")})`);
    } catch { /* another contract's log */ }
  }

  if (!paidNow) {
    const claim = await pool.claimAt(claimId);
    const due = Number(claim[3]) <= (await ethers.provider.getBlock("latest"))!.timestamp;
    console.log(`\n3. queued, due ${new Date(Number(claim[3]) * 1000).toISOString()}${due ? "  (already due)" : ""}`);
    if (!due) {
      console.log("   waiting out the window on the fork…");
      await network.provider.send("evm_setNextBlockTimestamp", [Number(claim[3]) + 1]);
      await network.provider.send("evm_mine");
    }
    console.log("4. drawForDueClaim()");
    const draw = await (await pool.drawForDueClaim()).wait();
    for (const log of draw!.logs) {
      try {
        const parsed = pool.interface.parseLog(log);
        if (parsed) console.log(`   event ${parsed.name}(${parsed.args.map(String).join(", ")})`);
      } catch { /* another contract's log */ }
    }
  }

  const after = await snapshot();
  report("\nAFTER", after);

  console.log("\nwhat moved");
  line("merchant USDC", before.merchantUsdc, after.merchantUsdc);
  line("merchant credits", before.merchantCredit, after.merchantCredit);
  line("pool USDC", before.poolUsdc, after.poolUsdc);
  line("pool position", before.poolCredit, after.poolCredit);
  line("co-op position", before.coopCredit, after.coopCredit);
  line("yield pool cash", before.yieldCash, after.yieldCash);
  line("reserve USDC", before.reserveUsdc, after.reserveUsdc);
  line("owed to yield pool", before.borrowedYield, after.borrowedYield);
  line("owed to reserve", before.borrowedReserve, after.borrowedReserve);
  line("credit supply", before.supply, after.supply);
  line("queued", before.queued, after.queued);

  console.log(
    "\nNothing here touched the live chain. The same sequence on Base Sepolia needs the merchant's\n" +
      "own wallet to sign, and gas in it.",
  );

  /** Somebody on chain who may grant membership, for the fork to borrow. */
  async function firstOperator(): Promise<string> {
    for (const candidate of [process.env.CREDIT_OPERATOR_ADDRESS, process.env.DEPLOYER_ACCOUNT]) {
      const who = candidate?.trim();
      if (who && ethers.isAddress(who) && (await access.isOperator(who))) return who;
    }
    throw new Error("No operator to impersonate: set CREDIT_OPERATOR_ADDRESS or DEPLOYER_ACCOUNT.");
  }

  async function snapshot() {
    return {
      merchantUsdc: await usdc.balanceOf(merchant!),
      merchantCredit: await credit.balanceOf(merchant!),
      poolUsdc: await pool.held(),
      poolCredit: await credit.balanceOf(await pool.getAddress()),
      coopCredit: await credit.balanceOf(await pool.coopTreasury()),
      yieldCash: yieldPool === ethers.ZeroAddress ? 0n : await usdc.balanceOf(yieldPool),
      reserveUsdc: reserve === ethers.ZeroAddress ? 0n : await usdc.balanceOf(reserve),
      borrowedYield: await pool.borrowedFromYield(),
      borrowedReserve: await pool.borrowedFromReserve(),
      supply: await credit.totalSupply(),
      queued: await pool.queuedTotal(),
      memberFunded: await pool.memberFunded(),
      inFlight: await pool.inFlight(),
      advancedTotal: await pool.advancedTotal(),
      poolAdvanced: await pool.advancedOf(await pool.getAddress()),
      coopCapital: await pool.capitalOf(await pool.coopTreasury()),
    };
  }

  function report(label: string, s: Awaited<ReturnType<typeof snapshot>>) {
    console.log(`\n${label}`);
    console.log(`  merchant      ${USDC(s.merchantCredit)} credits, ${USDC(s.merchantUsdc)} USDC`);
    console.log(`  pool          ${USDC(s.poolUsdc)} USDC held, ${USDC(s.queued)} queued, ${USDC(s.poolCredit)} position`);
    console.log(`  pool funding  memberFunded ${USDC(s.memberFunded)}, inFlight ${USDC(s.inFlight)}, advanced ${USDC(s.advancedTotal)} (pool's own ${USDC(s.poolAdvanced)})`);
    console.log(`  co-op         ${USDC(s.coopCredit)} position, ${USDC(s.coopCapital)} unspent capital`);
    console.log(`  lenders       yield pool ${USDC(s.yieldCash)} cash, reserve ${USDC(s.reserveUsdc)}; owed ${USDC(s.borrowedYield)} / ${USDC(s.borrowedReserve)}`);
    console.log(`  credit supply ${USDC(s.supply)}`);
  }

  function line(label: string, was: bigint, now: bigint) {
    const delta = now - was;
    const sign = delta > 0n ? "+" : "";
    console.log(`  ${label.padEnd(20)} ${USDC(was).padStart(12)} -> ${USDC(now).padStart(12)}   ${delta === 0n ? "" : sign + USDC(delta)}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
