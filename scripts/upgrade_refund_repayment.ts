import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * UUPS upgrade of PayoutPool, ClearCredit and TermIssuer, same proxy addresses, for the half of a
 * refund that gives back what a member already paid.
 *
 * THE ORDER IS THE CALL GRAPH, and each one is useless before the one below it exists:
 *
 *   1. PayoutPool    gains `payRefund`, which the ledger calls to hand a member their money.
 *   2. ClearCredit   gains `repayRefund`, which calls `payRefund` and takes the shares back off
 *                    the merchant and the co-op.
 *   3. TermIssuer    calls `repayRefund` as one half of closing a plan for a refund.
 *
 * Upgrading downwards instead -- the issuer first -- would leave a refund calling a method the
 * ledger does not have, and every refund in that window would revert. Upgrading in this order
 * leaves each intermediate state working exactly as it does today: nothing calls the new methods
 * until the last one lands.
 *
 * `donate` is gone from the pool in this upgrade. Safe now and not before: the deployed ledger was
 * upgraded yesterday and calls `receiveRepayment`, so nothing old is left to call the old name.
 *
 *   npx hardhat run scripts/upgrade_refund_repayment.ts --network base-sepolia
 *
 * Add --dry-run (as REFUND_REPAY_UPGRADE_DRY_RUN=1) to validate and report without sending.
 * Needs admin on the AccessManager, DEFAULT_ADMIN_ROLE on the pool, and ownership of TermIssuer.
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

const DRY_RUN = process.env.REFUND_REPAY_UPGRADE_DRY_RUN === "1";

async function main() {
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  const [signer] = await ethers.getSigners();

  const pool = getDeployment(network, "PayoutPool");
  const credit = getDeployment(network, "ClearCredit");
  const term = getDeployment(network, "TermIssuer");
  if (!pool || !credit || !term) throw new Error(`Missing a deployment record for ${network}.`);

  console.log(`network       ${network} (${net.chainId})`);
  console.log(`signer        ${signer.address}`);
  console.log(`PayoutPool    ${pool.address}`);
  console.log(`ClearCredit   ${credit.address}`);
  console.log(`TermIssuer    ${term.address}`);

  /*
   * `donate` is dropped here, so the deployed ledger must already be the one that calls
   * `receiveRepayment`.
   *
   * Checked by what the ledger CARRIES, not by what it calls. A selector the compiler embeds for an
   * outbound call is not reliably a substring of the bytecode -- the local artifact, which
   * certainly calls `receiveRepayment`, does not contain that selector either -- while a function's
   * own dispatcher entry always is. `settleClaim` is only on the ledger that came with the rename,
   * so carrying it is the same fact, asked of something that can answer.
   */
  const ledgerCode = await ethers.provider.getCode(await implementationOf(credit.address));
  const renamed = ledgerCode.includes(ethers.id("settleClaim(address,uint256)").slice(2, 10));
  console.log(`ledger is the one that renamed donate   ${renamed}`);
  if (!renamed) {
    throw new Error("The deployed ledger predates the rename and still calls donate. Upgrade it first.");
  }

  const accessAddress: string = await (
    await ethers.getContractAt(["function access() view returns (address)"], credit.address)
  ).access();
  const access = await ethers.getContractAt(["function isAdmin(address) view returns (bool)"], accessAddress);
  const isAdmin: boolean = await access.isAdmin(signer.address);
  const poolAdmin: boolean = await (
    await ethers.getContractAt(["function hasRole(bytes32,address) view returns (bool)"], pool.address)
  ).hasRole(ethers.ZeroHash, signer.address);
  const owner: string = await (
    await ethers.getContractAt(["function owner() view returns (address)"], term.address)
  ).owner();
  const isOwner = owner.toLowerCase() === signer.address.toLowerCase();
  console.log(`admin on AccessManager          ${isAdmin}`);
  console.log(`DEFAULT_ADMIN_ROLE on the pool  ${poolAdmin}`);
  console.log(`owner of TermIssuer             ${isOwner}`);

  const PayoutPool = await ethers.getContractFactory("PayoutPool");
  const ClearCredit = await ethers.getContractFactory("ClearCredit");
  const TermIssuer = await ethers.getContractFactory("TermIssuer");

  // All three validated before any send: a layout problem should be a message, not a half-done set.
  await upgrades.validateUpgrade(pool.address, PayoutPool, { kind: "uups" });
  await upgrades.validateUpgrade(credit.address, ClearCredit, { kind: "uups" });
  await upgrades.validateUpgrade(term.address, TermIssuer, { kind: "uups" });
  console.log("all three validate as upgrade-safe against what is deployed");

  if (!isAdmin || !poolAdmin || !isOwner) {
    throw new Error(`${signer.address} cannot do all three halves of this upgrade.`);
  }
  if (DRY_RUN) {
    console.log("\nREFUND_REPAY_UPGRADE_DRY_RUN=1: validated, nothing sent.");
    return;
  }

  const was = {
    pool: await implementationOf(pool.address),
    credit: await implementationOf(credit.address),
    term: await implementationOf(term.address),
  };

  for (const [label, record, factory] of [
    ["PayoutPool", pool, PayoutPool],
    ["ClearCredit", credit, ClearCredit],
    ["TermIssuer", term, TermIssuer],
  ] as const) {
    console.log(`\nupgrading ${label}…`);
    const upgraded = await upgrades.upgradeProxy(record.address, factory, { kind: "uups" });
    await upgraded.waitForDeployment();
    saveDeployment(network, label, record.address, JSON.parse(upgraded.interface.formatJson()));
  }

  console.log("");
  await confirm("PayoutPool", pool.address, "payRefund(address,uint256)", was.pool);
  await confirm(
    "ClearCredit",
    credit.address,
    "repayRefund(address,uint256,address,uint256,address,uint256,uint256)",
    was.credit,
  );
  await confirm("TermIssuer", term.address, "refundedOf(uint256)", was.term);
}

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function implementationOf(proxy: string): Promise<string> {
  const raw = await ethers.provider.getStorage(proxy, IMPL_SLOT);
  return ethers.getAddress("0x" + raw.slice(26));
}

/** Confirm against the chain, waiting for it to agree with itself: a read taken the moment an
 *  upgrade is mined can still be served from the previous state. */
async function confirm(label: string, proxy: string, signature: string, before: string) {
  const selector = ethers.id(signature).slice(2, 10);
  let implementation = before;
  for (let i = 0; i < 20 && implementation === before; i++) {
    implementation = await implementationOf(proxy);
    if (implementation === before) await new Promise((r) => setTimeout(r, 1500));
  }
  const code = await ethers.provider.getCode(implementation);
  const present = code.includes(selector);
  console.log(`${label.padEnd(13)} implementation ${implementation}${implementation === before ? "  (unchanged)" : ""}`);
  console.log(`${"".padEnd(13)} ${signature.split("(")[0]} in deployed code: ${present}`);
  if (!present) throw new Error(`${label} at ${proxy} does not carry ${signature} after the upgrade.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
