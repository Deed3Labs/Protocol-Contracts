import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * UUPS upgrade of PayoutPool and ClearCredit, same proxy addresses, for payables routing.
 *
 * PayoutPool gains per-funder capital, the carry split, the co-op's fee withdrawal and the
 * settle-or-advance rule; ClearCredit gains `settleClaim`, reserves repayments against payables
 * rather than against the queue, and stops turning the pool away at the membership check.
 *
 * THE ORDER IS NOT INTERCHANGEABLE, and the reason is worth reading before running this.
 *
 * The two are separate proxies and cannot be upgraded in one transaction, so between the two sends
 * one of them is old. The ledger calls the pool on every repayment — `donate` before this change,
 * `receiveRepayment` after — so the wrong order breaks every repayment in that window:
 *
 *   pool first   old ledger calls donate -> the new pool still has it (kept as an alias for this
 *                very moment), so repayments keep working throughout.
 *   ledger first new ledger calls receiveRepayment -> the old pool does not have it, and every
 *                repayment reverts until the second send lands.
 *
 * So: pool, then ledger. The alias is deleted in a later change, once nothing old can call it.
 *
 * One narrower window remains and is closed by the pre-step below. The new pool holds a position
 * between a merchant redeeming and their claim being paid, which the OLD ledger's membership check
 * refuses. Granting the pool membership first removes that window; the new ledger exempts it
 * anyway, so the grant is harmless afterwards and is not worth undoing.
 *
 *   npx hardhat run scripts/upgrade_payables_routing.ts --network base-sepolia
 *
 * Add --dry-run (as ROUTING_UPGRADE_DRY_RUN=1) to validate and report without sending anything.
 * Needs the key that is admin on the AccessManager (ClearCredit's upgrade authority) and holds
 * DEFAULT_ADMIN_ROLE on PayoutPool. NOT the credit operator, which is neither.
 *
 * Afterwards, in this order:
 *   1. node scripts/configure-carry-recipients.mjs --apply   (carry can only be split once the
 *      pool that splits it is the one deployed)
 *   2. fund the pool: on Base Sepolia the ~125 USDC already in the assurance buffer cannot be
 *      moved to it, so nothing can be paid out until it is funded directly.
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

const DRY_RUN = process.env.ROUTING_UPGRADE_DRY_RUN === "1";

const ACCESS_ABI = [
  "function isAdmin(address) view returns (bool)",
  "function isMember(address) view returns (bool)",
  "function grantMember(address) external",
];
const ROLE_ABI = ["function hasRole(bytes32,address) view returns (bool)"];

async function main() {
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  const [signer] = await ethers.getSigners();

  const stableCredit = getDeployment(network, "ClearCredit");
  const payoutPool = getDeployment(network, "PayoutPool");
  if (!stableCredit) throw new Error(`No ClearCredit recorded for ${network}.`);
  if (!payoutPool) throw new Error(`No PayoutPool recorded for ${network}.`);

  console.log(`network       ${network} (${net.chainId})`);
  console.log(`signer        ${signer.address}`);
  console.log(`balance       ${ethers.formatEther(await ethers.provider.getBalance(signer.address))} ETH`);
  console.log(`PayoutPool    ${payoutPool.address}`);
  console.log(`ClearCredit   ${stableCredit.address}`);

  /*
   * The pool the LEDGER points at, not the one in the deployment record. Upgrading a pool the
   * ledger does not use would report success and change nothing that matters.
   */
  const wired: string = await (
    await ethers.getContractAt(["function payoutPool() view returns (address)"], stableCredit.address)
  ).payoutPool();
  console.log(`ledger points at  ${wired}${
    wired.toLowerCase() === payoutPool.address.toLowerCase() ? "" : "  (NOT the pool above)"
  }`);
  if (wired.toLowerCase() !== payoutPool.address.toLowerCase()) {
    throw new Error("The ledger's payout pool is not the one recorded. Sort that out before upgrading.");
  }

  // Authority for both halves, checked before either send: a half-done pair is the outcome to avoid.
  const accessAddress: string = await (
    await ethers.getContractAt(["function access() view returns (address)"], stableCredit.address)
  ).access();
  const access = await ethers.getContractAt(ACCESS_ABI, accessAddress);
  const isAdmin: boolean = await access.isAdmin(signer.address);
  const pool = await ethers.getContractAt(ROLE_ABI, payoutPool.address);
  const hasPoolAdmin: boolean = await pool.hasRole(ethers.ZeroHash, signer.address);

  console.log(`admin on AccessManager        ${isAdmin}`);
  console.log(`DEFAULT_ADMIN_ROLE on pool    ${hasPoolAdmin}`);

  const PayoutPool = await ethers.getContractFactory("PayoutPool");
  const ClearCredit = await ethers.getContractFactory("ClearCredit");

  // Validated before either send, so a layout problem is a message rather than a failed upgrade.
  // PayoutPool takes four slots from its gap, which is what a gap is for and validates as safe.
  await upgrades.validateUpgrade(payoutPool.address, PayoutPool, { kind: "uups" });
  await upgrades.validateUpgrade(stableCredit.address, ClearCredit, { kind: "uups" });
  console.log("both validate as upgrade-safe against what is deployed");

  if (!isAdmin || !hasPoolAdmin) {
    throw new Error(
      `${signer.address} cannot do both halves of this upgrade. ` +
        "It needs admin on the AccessManager and DEFAULT_ADMIN_ROLE on the PayoutPool.",
    );
  }

  const poolIsMember: boolean = await access.isMember(payoutPool.address);
  console.log(`pool is a network member      ${poolIsMember}${poolIsMember ? "" : "  (will be granted)"}`);

  if (DRY_RUN) {
    console.log("\nROUTING_UPGRADE_DRY_RUN=1: validated, nothing sent.");
    return;
  }

  /*
   * Membership first. The new pool holds a position between redemption and payment, and until the
   * ledger is upgraded it is the old membership check deciding whether that is allowed.
   */
  if (!poolIsMember) {
    console.log("\ngranting the pool membership…");
    const grant = access.connect(signer).getFunction("grantMember");
    await (await grant(payoutPool.address)).wait();
  }

  const poolWas = await implementationOf(payoutPool.address);
  const creditWas = await implementationOf(stableCredit.address);

  // The pool first: it keeps `donate`, so the old ledger's repayments carry on working until the
  // second send lands. The other order breaks every repayment in between.
  console.log("\nupgrading PayoutPool…");
  const up = await upgrades.upgradeProxy(payoutPool.address, PayoutPool, { kind: "uups" });
  await up.waitForDeployment();
  saveDeployment(network, "PayoutPool", payoutPool.address, JSON.parse(up.interface.formatJson()));

  console.log("upgrading ClearCredit…");
  const uc = await upgrades.upgradeProxy(stableCredit.address, ClearCredit, { kind: "uups" });
  await uc.waitForDeployment();
  saveDeployment(network, "ClearCredit", stableCredit.address, JSON.parse(uc.interface.formatJson()));

  // Read the chain, not the manifest and not the local artifact: an interface from the artifact on
  // disk says nothing about what is deployed.
  console.log("");
  await confirm("PayoutPool", payoutPool.address, "distributeCarry()", poolWas);
  await confirm("ClearCredit", stableCredit.address, "settleClaim(address,uint256)", creditWas);

  console.log(
    "\nNext: scripts/configure-carry-recipients.mjs --apply, then fund the pool — nothing can be\n" +
      "paid out of it until somebody does, because the buffer's cash cannot be moved there.",
  );
}

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function implementationOf(proxy: string): Promise<string> {
  const raw = await ethers.provider.getStorage(proxy, IMPL_SLOT);
  return ethers.getAddress("0x" + raw.slice(26));
}

/**
 * Confirm against the chain, and wait for the chain to agree with itself.
 *
 * A read taken the instant an upgrade is mined can still be served from the node's previous state,
 * which reports the old implementation on a run that in fact succeeded — a worse failure than
 * reporting nothing, because it is the kind that gets believed. So it polls until the slot moves,
 * and only then checks the code.
 */
async function confirm(label: string, proxy: string, signature: string, before: string) {
  const selector = ethers.id(signature).slice(2, 10);
  let implementation = before;
  for (let i = 0; i < 20 && implementation === before; i++) {
    implementation = await implementationOf(proxy);
    if (implementation === before) await new Promise((r) => setTimeout(r, 1500));
  }

  const code = await ethers.provider.getCode(implementation);
  const present = code.includes(selector);
  const moved = implementation !== before;
  console.log(`${label.padEnd(13)} implementation ${implementation}${moved ? "" : "  (unchanged)"}`);
  console.log(`${"".padEnd(13)} ${signature.split("(")[0]} in deployed code: ${present}`);
  if (!present) {
    throw new Error(`${label} at ${proxy} does not carry ${signature} after the upgrade.`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
