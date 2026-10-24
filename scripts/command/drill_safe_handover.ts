/**
 * Rehearses the admin handover against a FORK of what's deployed on Base Sepolia (Phase 4c), the
 * same way scripts/drill_redemption.ts rehearses a redemption. Nothing touches the real chain.
 *
 *   FORK_RPC_URL=https://sepolia.base.org npx hardhat run scripts/command/drill_safe_handover.ts
 *
 * It makes a 2-of-3 Safe with three throwaway signers through Safe's own factory, runs the handover
 * as the (impersonated) deployer, and then checks:
 *   - the Safe holds every admin role and ownership the deployer had, and the deployer holds none
 *   - the deployer can no longer grant roles
 *   - two of the three signers can make the Safe call MerchantRegistry, as Command's proposals will
 * DEPLOYER=0x… if the deployer isn't TokenRegistry's owner.
 */
import { ethers, network } from "hardhat";
import { Contract, Wallet, concat, getAddress } from "ethers";
import { deployments, execute, plan, survey } from "./handover";

// Safe 1.4.1, at the same address on every chain Safe supports
const FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const SINGLETON = "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762";
const FALLBACK = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99";
const SAFE_ABI = [
  "function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 nonce) view returns (bytes32)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
];
const FACTORY_ABI = ["function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)", "event ProxyCreation(address indexed proxy, address singleton)"];

const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`  ok  ${what}`);
};

async function main() {
  if (!process.env.FORK_RPC_URL || network.name !== "hardhat")
    throw new Error("This drill only runs on a fork. Set FORK_RPC_URL and leave the network as `hardhat`.");
  // a fork's latest block IS the forked one, and Hardhat has no hardfork history for Base Sepolia:
  // mine one empty block first, so every read runs on a block of the fork's own
  await network.provider.request({ method: "evm_mine", params: [] });
  if ((await ethers.provider.getCode(FACTORY)) === "0x") throw new Error("Safe's factory isn't on this fork: is it Base Sepolia?");

  const list = deployments();
  const byName = Object.fromEntries(list.map((d) => [d.name, d]));
  const deployer = getAddress(process.env.DEPLOYER?.trim() || (await new Contract(byName.TokenRegistry.address, byName.TokenRegistry.abi, ethers.provider).owner()));
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [deployer] });
  await network.provider.request({ method: "hardhat_setBalance", params: [deployer, "0x56BC75E2D63100000"] });
  const dep = await ethers.getSigner(deployer);

  // a 2-of-3 Safe with throwaway signers, made the way Safe{Wallet} makes one
  const signers = [Wallet.createRandom(), Wallet.createRandom(), Wallet.createRandom()].map((w) => w.connect(ethers.provider));
  for (const w of signers) await network.provider.request({ method: "hardhat_setBalance", params: [w.address, "0xDE0B6B3A7640000"] });
  const singleton = new Contract(SINGLETON, SAFE_ABI, ethers.provider);
  const init = singleton.interface.encodeFunctionData("setup", [signers.map((w) => w.address), 2, ethers.ZeroAddress, "0x", FALLBACK, ethers.ZeroAddress, 0, ethers.ZeroAddress]);
  const factory = new Contract(FACTORY, FACTORY_ABI, signers[0]);
  const rc = await (await factory.createProxyWithNonce(SINGLETON, init, BigInt(Date.now()))).wait();
  const ev = rc!.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((x: any) => x?.name === "ProxyCreation");
  const safeAddr = getAddress(ev!.args.proxy);
  const safe = new Contract(safeAddr, SAFE_ABI, signers[0]);
  console.log(`Deployer ${deployer}\nSafe     ${safeAddr} (2 of 3)\n`);
  check(Number(await safe.getThreshold()) === 2 && (await safe.getOwners()).length === 3, "the Safe is 2 of 3");

  const before = await survey(ethers.provider, list, deployer, safeAddr);
  const { steps } = plan(before, deployer, safeAddr);
  check(before.find((c) => c.name === "MerchantRegistry")!.roles.some((r) => r.role === "DEFAULT_ADMIN_ROLE" && r.deployer), "the deployer is MerchantRegistry's admin before");
  console.log(`\nHandover, ${steps.length} steps:`);
  await execute(dep, list, steps, safeAddr, () => undefined);

  const after = await survey(ethers.provider, list, deployer, safeAddr);
  // what only the Safe can finish: accept two-step ownership, and the timed default-admin transfers
  const exec = async (to: string, data: string, by = [signers[0], signers[2]]) => {
    const n = await safe.nonce();
    const h = await safe.getTransactionHash(to, 0, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, n);
    const sorted = [...by].sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
    await (await safe.execTransaction(to, 0, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, concat(sorted.map((w) => w.signingKey.sign(h).serialized)))).wait();
  };
  const timed = after.filter((c) => c.adminRules?.pending === safeAddr);
  const wait = Math.max(0, ...timed.map((c) => c.adminRules!.delaySeconds));
  if (timed.length) {
    await network.provider.request({ method: "evm_increaseTime", params: [wait + 1] });
    await network.provider.request({ method: "evm_mine", params: [] });
  }
  // two-step ownership waiting for the Safe; Chainlink-style contracts (CLRUSDTokenPool) have no pendingOwner() to read, so the Safe just accepts
  const twoStep = after.filter((x) => x.twoStep && (x.pendingOwner === safeAddr || (x.pendingOwner === null && x.owner === deployer)));
  for (const c of [...timed, ...twoStep]) {
    const d = byName[c.name];
    await exec(d.address, d.abi.encodeFunctionData(c.adminRules?.pending === safeAddr ? "acceptDefaultAdminTransfer" : "acceptOwnership", []));
  }
  const settled = await survey(ethers.provider, list, deployer, safeAddr);
  check(timed.every((c) => settled.find((s) => s.name === c.name)!.adminRules!.admin === safeAddr), `the Safe accepted the timed admin transfer on ${timed.map((c) => c.name).join(", ") || "none"} after ${Math.round(wait / 3600)} h`);
  const leftAdmin = settled.flatMap((c) => c.roles.filter((r) => r.admin && r.deployer).map((r) => `${c.name}.${r.role}`));
  check(leftAdmin.length === 0, `the deployer holds no admin role anywhere${leftAdmin.length ? " (still: " + leftAdmin.join(", ") + ")" : ""}`);
  const moved = before.flatMap((c) => c.roles.filter((r) => r.admin && r.deployer).map((r) => [c.name, r.role]));
  check(moved.every(([n, role]) => settled.find((c) => c.name === n)!.roles.find((r) => r.role === role)!.safe), `the Safe holds all ${moved.length} admin roles the deployer had`);
  const owned = before.filter((c) => c.owner === deployer);
  const notMoved = owned.filter((c) => settled.find((a) => a.name === c.name)!.owner !== safeAddr).map((c) => `${c.name} (owner ${settled.find((a) => a.name === c.name)!.owner}, pending ${settled.find((a) => a.name === c.name)!.pendingOwner})`);
  check(notMoved.length === 0, `the Safe owns all ${owned.length} contracts the deployer owned (two-step ones accepted by the Safe)${notMoved.length ? ': not ' + notMoved.join(', ') : ''}`);

  const reg = new Contract(byName.MerchantRegistry.address, byName.MerchantRegistry.abi, dep);
  const op = await reg.OPERATOR_ROLE();
  let refused = false;
  try {
    await (await reg.grantRole(op, Wallet.createRandom().address)).wait();
  } catch {
    refused = true;
  }
  check(refused, "the deployer can no longer grant MerchantRegistry roles");

  // two of the three sign; the Safe calls MerchantRegistry like a Command proposal would
  const window = Number(await reg.defaultPayoutWindow()) + 3600;
  const data = reg.interface.encodeFunctionData("setDefaultPayoutWindow", [window]);
  await exec(String(reg.target), data);
  check(Number(await reg.defaultPayoutWindow()) === window, "two signers made the Safe change MerchantRegistry's payout window");
  let one = false;
  try {
    const n2 = await safe.nonce();
    const h2 = await safe.getTransactionHash(reg.target, 0, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, n2);
    await (await safe.execTransaction(reg.target, 0, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, signers[1].signingKey.sign(h2).serialized)).wait();
  } catch {
    one = true;
  }
  check(one, "one signature alone isn't enough");
  console.log("\nDrill passed.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
