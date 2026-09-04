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

  // Captured before anything is sent, so the confirmation below has something to compare against.
  const scWas = await implementationOf(stableCredit.address);
  const tiWas = await implementationOf(termIssuer.address);

  // The ledger first: TermIssuer's new function calls reversePurchase, which must exist by the
  // time anything can reach it.
  console.log("\nupgrading ClearCredit…");
  const sc = await upgrades.upgradeProxy(stableCredit.address, ClearCredit, { kind: "uups" });
  await sc.waitForDeployment();
  saveDeployment(network, "ClearCredit", stableCredit.address, JSON.parse(sc.interface.formatJson()));

  console.log("upgrading TermIssuer…");
  const ti = await upgrades.upgradeProxy(termIssuer.address, TermIssuer, { kind: "uups" });
  await ti.waitForDeployment();
  saveDeployment(network, "TermIssuer", termIssuer.address, JSON.parse(ti.interface.formatJson()));

  /*
   * Read the chain, not the manifest and not the local artifact.
   *
   * `upgrades.erc1967.getImplementationAddress` reported the OLD implementations on a run that had
   * just succeeded, and `getContractAt(...).someMethod` is always a function because the interface
   * comes from the artifact on disk — neither says anything about what is deployed. The EIP-1967
   * slot and the deployed bytecode do.
   */
  console.log("");
  await confirm("ClearCredit", stableCredit.address, "reversePurchase(address,uint256,address,uint256,address,uint256)", scWas);
  await confirm("TermIssuer", termIssuer.address, "closePlanForRefund(uint256,uint256,address,uint256)", tiWas);
}

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function implementationOf(proxy: string): Promise<string> {
  const raw = await ethers.provider.getStorage(proxy, IMPL_SLOT);
  return ethers.getAddress("0x" + raw.slice(26));
}

/**
 * Confirm against the chain, and wait for the chain to agree with itself.
 *
 * A read taken the instant an upgrade is mined can still be served from the node's previous state
 * — this reported the old implementation twice on runs that had in fact succeeded, which is a
 * worse failure than reporting nothing, because it is the kind that gets believed. So it polls
 * until the slot moves off what was there before, and only then checks the code.
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
