import hre from "hardhat";
import { getDeployment } from "../../deploy/helpers";
import { SAFE_ABI } from "./safe";

/*
 * The treasury's caps: the Safe's USDC allowances to the contracts that may draw on it.
 *
 *  - BondVault: pays a maturing bond the vault can't, after the vault and before the AssurancePool.
 *  - PayoutPool: pays a claim that has come due, after the yield pool and BondVault, as capital.
 *  - OffersIssuer: pays the $10 offers' line down (settle()).
 *
 * An allowance moves nothing by itself; each contract takes only what it's short, and never more
 * than the Safe holds. Sent as Safe transactions from an owner, which works as-is only on a Safe
 * whose threshold is 1 (the owner's own call is its signature). On a Safe that needs more, this prints
 * the transactions to propose instead.
 *
 *   npx hardhat run scripts/command/approve_treasury_caps.ts --network base-sepolia
 *
 * Caps in dollars: BOND_VAULT_CAP (500), PAYOUT_POOL_CAP (500), OFFERS_CAP (1000, the offers line's
 * cap). TREASURY_CAPS_DRY_RUN=1 reports without sending.
 */
const { ethers } = hre as any;
const DRY_RUN = process.env.TREASURY_CAPS_DRY_RUN === "1";

async function main() {
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  const [signer] = await ethers.getSigners();
  const at = (n: string) => {
    const d = getDeployment(network, n);
    if (!d) throw new Error(`No ${n} on ${network}.`);
    return d.address;
  };

  const payout = await ethers.getContractAt(["function coopTreasury() view returns (address)"], at("PayoutPool"));
  const safeAddress: string = await payout.coopTreasury();
  const pool = await ethers.getContractAt(["function reserveToken() view returns (address)"], at("AssurancePool"));
  const usdc = await ethers.getContractAt(
    ["function decimals() view returns (uint8)", "function allowance(address,address) view returns (uint256)", "function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"],
    await pool.reserveToken()
  );
  const decimals = Number(await usdc.decimals());
  const cap = (env: string, fallback: string) => ethers.parseUnits(process.env[env]?.trim() || fallback, decimals);
  const caps: [string, string, bigint][] = [
    ["BondVault", at("BondVault"), cap("BOND_VAULT_CAP", "500")],
    ["PayoutPool", at("PayoutPool"), cap("PAYOUT_POOL_CAP", "500")],
    ["OffersIssuer", at("OffersIssuer"), cap("OFFERS_CAP", "1000")],
  ];

  const safe = await ethers.getContractAt(SAFE_ABI, safeAddress);
  const owners: string[] = (await safe.getOwners()).map((o: string) => o.toLowerCase());
  const threshold = Number(await safe.getThreshold());
  const f = (v: bigint) => ethers.formatUnits(v, decimals);
  console.log(`network   ${network} (${net.chainId})`);
  console.log(`Safe      ${safeAddress} · ${threshold} of ${owners.length} · holds ${f(await usdc.balanceOf(safeAddress))} USDC`);
  console.log(`signer    ${signer.address}${owners.includes(signer.address.toLowerCase()) ? " (an owner)" : " (NOT an owner)"}`);

  for (const [name, spender, amount] of caps) {
    const now: bigint = await usdc.allowance(safeAddress, spender);
    const data = usdc.interface.encodeFunctionData("approve", [spender, amount]);
    console.log(`\n${name.padEnd(13)} ${spender} · allowance ${f(now)} -> ${f(amount)}`);
    if (now === amount) {
      console.log("  already set");
      continue;
    }
    if (DRY_RUN || threshold !== 1 || !owners.includes(signer.address.toLowerCase())) {
      console.log(`  propose to the Safe: to ${await usdc.getAddress()} · value 0 · data ${data}`);
      continue;
    }
    // An owner's own call is its signature (v = 1, r = the owner), which is all a 1-of-n Safe needs.
    const sig = ethers.concat([ethers.zeroPadValue(signer.address, 32), ethers.ZeroHash, "0x01"]);
    const tx = await safe.execTransaction(await usdc.getAddress(), 0, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, sig);
    await tx.wait(1);
    console.log(`  set (${tx.hash}) · now ${f(await usdc.allowance(safeAddress, spender))}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
