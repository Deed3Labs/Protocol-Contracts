import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * UUPS upgrade of TermIssuer, same proxy address, for late handling and mandated collection.
 *
 *   - behind on a plan freezes new plans; a member cannot re-split while behind, more than three
 *     times, or more than once an installment period
 *   - `declareDefault` once a plan is two installments overdue: writes off term plans only, keeps
 *     the member's card, savings and membership (the old `_onDefault` revoked membership)
 *   - `repayWrittenOff` into the assurance reserve, and `reinstate`
 *   - `collectForMember` under the revolving line's automatic-repayment mandate, and
 *     `payResidualCarry` for carry a refunded plan left on nothing
 *
 * New state comes out of __gap (42 -> 36), so the storage check runs as normal. After the upgrade
 * the mandate source is pointed at RevolvingIssuer, whose mandate and card settlers it honours.
 *
 *   npx hardhat run scripts/upgrade_term_late_handling.ts --network base-sepolia
 *
 * TERM_UPGRADE_DRY_RUN=1 validates and reports without sending. Needs the owner of TermIssuer for
 * the upgrade and an operator for setMandateSource. Idempotent: re-running skips what is done.
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

const DRY_RUN = process.env.TERM_UPGRADE_DRY_RUN === "1";
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const PROBE = "declareDefault(address)";

async function implementationOf(proxy: string): Promise<string> {
  const raw = await ethers.provider.getStorage(proxy, IMPL_SLOT);
  return ethers.getAddress("0x" + raw.slice(26));
}

async function carries(proxy: string, signature: string): Promise<boolean> {
  const code = await ethers.provider.getCode(await implementationOf(proxy));
  return code.includes(ethers.id(signature).slice(2, 10));
}

async function main() {
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  const [signer] = await ethers.getSigners();
  const term = getDeployment(network, "TermIssuer");
  const revolving = getDeployment(network, "RevolvingIssuer");
  if (!term) throw new Error(`No TermIssuer recorded for ${network}.`);
  if (!revolving) throw new Error(`No RevolvingIssuer recorded for ${network}.`);

  console.log(`network         ${network} (${net.chainId})`);
  console.log(`signer          ${signer.address}`);
  console.log(`TermIssuer      ${term.address}`);
  console.log(`RevolvingIssuer ${revolving.address}`);

  const TermIssuer = await ethers.getContractFactory("TermIssuer");
  await upgrades.validateUpgrade(term.address, TermIssuer, { kind: "uups" });
  console.log("validates as upgrade-safe against what is deployed");

  const current = await carries(term.address, PROBE);
  if (DRY_RUN) {
    console.log(`\nTERM_UPGRADE_DRY_RUN=1: ${current ? "already current" : "would upgrade"}; nothing sent.`);
    return;
  }

  if (!current) {
    const was = await implementationOf(term.address);
    console.log("\nupgrading TermIssuer…  from", was);
    const upgraded = await upgrades.upgradeProxy(term.address, TermIssuer, { kind: "uups" });
    await upgraded.waitForDeployment();
    saveDeployment(network, "TermIssuer", term.address, JSON.parse(upgraded.interface.formatJson()));
    // Read the slot, not the manifest: a read straight after mining can still be the old state.
    let now = was;
    for (let i = 0; i < 20 && now === was; i++) {
      now = await implementationOf(term.address);
      if (now === was) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!(await carries(term.address, PROBE))) throw new Error("TermIssuer does not carry declareDefault after the upgrade.");
    console.log("                         to  ", now);
  } else {
    console.log("TermIssuer already carries late handling; skipping the upgrade.");
  }

  const issuer = await ethers.getContractAt("TermIssuer", term.address);
  const source: string = await issuer.mandateSource();
  if (source.toLowerCase() !== revolving.address.toLowerCase()) {
    const tx = await issuer.setMandateSource(revolving.address);
    await tx.wait();
    console.log("mandate source ->", revolving.address, tx.hash);
  } else {
    console.log("mandate source already RevolvingIssuer");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
