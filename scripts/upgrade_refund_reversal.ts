import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * UUPS upgrade of ClearCredit and TermIssuer, same proxy addresses, for the refund reversal.
 *
 * The ledger proxy is `ClearCredit`, which extends StableCredit — so it is ClearCredit's factory
 * that is deployed here. Upgrading it with the base StableCredit factory would compile and send
 * happily, and would replace the live implementation with one that has none of ClearCredit's
 * overrides on it. The deployment record is under that name for the same reason.
 *
 * StableCredit gains `reversePurchase`, the inverse of `originatePurchase`; TermIssuer gains
 * `closePlanForRefund`, which calls it and closes the plan. Both changes are purely additive —
 * no new state variables, no struct fields — so there is no storage check to relax here, and the
 * absence of `unsafeSkipStorageCheck` below is deliberate rather than an oversight.
 *
 * The pair goes together. TermIssuer's new function calls a method that does not exist on the old
 * ledger implementation, so upgrading only the issuer leaves refunds reverting; the ledger goes
 * first for that reason. Between the two transactions the system is exactly as it is
 * today, because nothing calls the new method yet.
 *
 *   npx hardhat run scripts/upgrade_refund_reversal.ts --network base-sepolia
 *
 * Add --dry-run (as REFUND_UPGRADE_DRY_RUN=1) to validate and report without sending anything.
 * Needs the key that is admin on the AccessManager and owner of TermIssuer — NOT the credit
 * operator, which is neither.
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

const DRY_RUN = process.env.REFUND_UPGRADE_DRY_RUN === "1";

const ACCESS_ABI = ["function isAdmin(address) view returns (bool)"];
const OWNABLE_ABI = ["function owner() view returns (address)"];

async function main() {
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  const [signer] = await ethers.getSigners();

  const stableCredit = getDeployment(network, "ClearCredit");
  const termIssuer = getDeployment(network, "TermIssuer");
  if (!stableCredit) throw new Error(`No ClearCredit recorded for ${network}.`);
  if (!termIssuer) throw new Error(`No TermIssuer recorded for ${network}.`);

  console.log(`network       ${network} (${net.chainId})`);
  console.log(`signer        ${signer.address}`);
  console.log(`balance       ${ethers.formatEther(await ethers.provider.getBalance(signer.address))} ETH`);
  console.log(`ClearCredit   ${stableCredit.address}`);
  console.log(`TermIssuer    ${termIssuer.address}`);

  /*
   * Authority is checked here rather than discovered by a revert, because a half-done pair is the
   * one outcome worth avoiding: StableCredit upgraded and TermIssuer not is harmless, but finding
   * that out after the first transaction has landed is a worse way to learn it.
   */
  const access = await ethers.getContractAt(
    ACCESS_ABI,
    await (await ethers.getContractAt(["function access() view returns (address)"], stableCredit.address)).access(),
  );
  const isAdmin: boolean = await access.isAdmin(signer.address);
  const owner: string = await (await ethers.getContractAt(OWNABLE_ABI, termIssuer.address)).owner();
  const isOwner = owner.toLowerCase() === signer.address.toLowerCase();

  console.log(`admin on AccessManager  ${isAdmin}`);
  console.log(`owner of TermIssuer     ${isOwner}${isOwner ? "" : `  (it is ${owner})`}`);

  const ClearCredit = await ethers.getContractFactory("ClearCredit");
  const TermIssuer = await ethers.getContractFactory("TermIssuer");

  // Validated before either send, so a layout problem is a message rather than a failed upgrade.
  await upgrades.validateUpgrade(stableCredit.address, ClearCredit, { kind: "uups" });
  await upgrades.validateUpgrade(termIssuer.address, TermIssuer, { kind: "uups" });
  console.log("both validate as upgrade-safe against what is deployed");

  if (!isAdmin || !isOwner) {
    throw new Error(
      `${signer.address} cannot do both halves of this upgrade. ` +
        "It needs admin on the AccessManager and ownership of TermIssuer.",
    );
  }

  if (DRY_RUN) {
    console.log("\nREFUND_UPGRADE_DRY_RUN=1: validated, nothing sent.");
    return;
  }

  // The ledger first: TermIssuer's new function calls reversePurchase, which must exist by the
  // time anything can reach it.
  console.log("\nupgrading ClearCredit…");
  const sc = await upgrades.upgradeProxy(stableCredit.address, ClearCredit, { kind: "uups" });
  await sc.waitForDeployment();
  const scImpl = await upgrades.erc1967.getImplementationAddress(stableCredit.address);
  console.log(`  implementation ${scImpl}`);
  saveDeployment(network, "ClearCredit", stableCredit.address, JSON.parse(sc.interface.formatJson()));

  console.log("upgrading TermIssuer…");
  const ti = await upgrades.upgradeProxy(termIssuer.address, TermIssuer, { kind: "uups" });
  await ti.waitForDeployment();
  const tiImpl = await upgrades.erc1967.getImplementationAddress(termIssuer.address);
  console.log(`  implementation ${tiImpl}`);
  saveDeployment(network, "TermIssuer", termIssuer.address, JSON.parse(ti.interface.formatJson()));

  // Read the new methods back off the proxies rather than trusting the receipts.
  const live = await ethers.getContractAt("TermIssuer", termIssuer.address);
  console.log("\nclosePlanForRefund present:", typeof live.closePlanForRefund === "function");
  const liveSc = await ethers.getContractAt("ClearCredit", stableCredit.address);
  console.log("reversePurchase present:   ", typeof liveSc.reversePurchase === "function");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
