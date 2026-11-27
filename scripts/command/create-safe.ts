/**
 * Creates the Ops Safe on Base Sepolia (Phase 4): a 2-of-3 Safe through Safe's own factory, owned
 * by the three signers' wallets. The wallet that runs it only pays the gas and owns nothing; any
 * wallet with a little test ETH will do. Command never holds a key and never runs this.
 *
 * Check first (reads only, prints the address the Safe will have):
 *   OWNERS=0xKai…,0xDana…,0xBoard… npx hardhat run scripts/command/create-safe.ts --network base-sepolia
 *
 * Create it:
 *   OWNERS=… CONFIRM=create npx hardhat run scripts/command/create-safe.ts --network base-sepolia
 *
 * THRESHOLD defaults to 2. SALT makes a different address for the same owners (default 0), so a
 * second run with the same owners and salt finds the Safe already there instead of making another.
 */
import { ethers } from "hardhat";
import { Contract, getAddress, isAddress } from "ethers";
import { SAFE_ABI, SAFE_FACTORY, createSafe, predictSafe } from "./safe";

async function main() {
  const owners = (process.env.OWNERS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  if (owners.length < 2 || !owners.every(isAddress)) throw new Error("Set OWNERS to the signers' wallet addresses, comma-separated.");
  if (new Set(owners.map((o) => o.toLowerCase())).size !== owners.length) throw new Error("An owner is listed twice.");
  const threshold = Number(process.env.THRESHOLD ?? 2);
  if (!(threshold >= 1 && threshold <= owners.length)) throw new Error(`THRESHOLD must be 1 to ${owners.length}.`);
  const salt = BigInt(process.env.SALT ?? 0);
  if ((await ethers.provider.getCode(SAFE_FACTORY)) === "0x") throw new Error("Safe's factory isn't on this network: is it Base Sepolia?");

  // on a fork, mine a block first: Hardhat can't run reads on the forked block itself
  if ((await ethers.provider.getNetwork()).chainId === 31337n || process.env.FORK_RPC_URL) await ethers.provider.send("evm_mine", []);
  const [payer] = await ethers.getSigners();
  const at = await predictSafe(ethers.provider, owners, threshold, salt);
  console.log(`Owners    ${owners.map((o) => getAddress(o)).join(", ")}\nThreshold ${threshold} of ${owners.length}\nSafe      ${at}`);
  if ((await ethers.provider.getCode(at)) !== "0x") return console.log("\nThat Safe already exists. Use it, or set SALT for another.");
  if (process.env.CONFIRM !== "create") return console.log(`\nCheck only: nothing was sent. CONFIRM=create to make it, paid by ${await payer.getAddress()}.`);

  const made = await createSafe(payer, owners, threshold, salt);
  if (made.address !== at) throw new Error(`The factory made ${made.address}, not the ${at} it was going to: check before using it`);
  const safe = new Contract(made.address, SAFE_ABI, ethers.provider);
  const [o, t, v] = await Promise.all([safe.getOwners(), safe.getThreshold(), safe.VERSION()]);
  console.log(`\nMade ${made.address} (Safe ${v}, ${t} of ${o.length}) in ${made.tx}`);
  console.log(`\nNext:\n  1. Open it: https://app.safe.global/home?safe=basesep:${made.address}\n  2. Railway (dev): COMMAND_SAFE_ADDRESS=${made.address}\n  3. The role moves: SAFE_ADDRESS=${made.address} scripts/command/ops-roles.ts, then safe-handover.ts`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
