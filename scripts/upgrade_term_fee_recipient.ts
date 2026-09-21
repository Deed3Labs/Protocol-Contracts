import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * UUPS upgrade of TermIssuer, same proxy address, to give the co-op's fee a recipient of its own.
 *
 * `carryTreasury` was two things at once: the carry recipient, and where `openPlan` mints the
 * co-op's share of every purchase. Moving carry to the payout pool -- the only way it reaches the
 * split that pays whoever bore the float -- took the fee along with it, so the split would have
 * handed funders a share of the co-op's income. `feeRecipient` separates them, and unset means the
 * carry treasury, so this upgrade changes nothing on its own.
 *
 *   npx hardhat run scripts/upgrade_term_fee_recipient.ts --network base-sepolia
 *
 * Add --dry-run (as TERM_FEE_UPGRADE_DRY_RUN=1) to validate and report without sending anything.
 * Needs the owner of TermIssuer.
 *
 * Afterwards: scripts/configure-carry-recipients.mjs --apply, which names the co-op as the fee
 * recipient FIRST and only then points carry at the pool. In between, the fee would be minted
 * wherever carry had gone -- which is the mistake this exists to make impossible.
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

const DRY_RUN = process.env.TERM_FEE_UPGRADE_DRY_RUN === "1";

async function main() {
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  const [signer] = await ethers.getSigners();

  const termIssuer = getDeployment(network, "TermIssuer");
  if (!termIssuer) throw new Error(`No TermIssuer recorded for ${network}.`);

  console.log(`network       ${network} (${net.chainId})`);
  console.log(`signer        ${signer.address}`);
  console.log(`TermIssuer    ${termIssuer.address}`);

  const current = await ethers.getContractAt(
    [
      "function owner() view returns (address)",
      "function carryTreasury() view returns (address)",
    ],
    termIssuer.address,
  );
  const owner: string = await current.owner();
  const carryTreasury: string = await current.carryTreasury();
  const isOwner = owner.toLowerCase() === signer.address.toLowerCase();
  console.log(`owner of TermIssuer   ${isOwner}${isOwner ? "" : `  (it is ${owner})`}`);
  console.log(`carryTreasury         ${carryTreasury}`);

  const TermIssuer = await ethers.getContractFactory("TermIssuer");
  await upgrades.validateUpgrade(termIssuer.address, TermIssuer, { kind: "uups" });
  console.log("validates as upgrade-safe against what is deployed");

  if (!isOwner) throw new Error(`${signer.address} does not own TermIssuer.`);
  if (DRY_RUN) {
    console.log("\nTERM_FEE_UPGRADE_DRY_RUN=1: validated, nothing sent.");
    return;
  }

  const was = await implementationOf(termIssuer.address);
  console.log("\nupgrading TermIssuer…");
  const upgraded = await upgrades.upgradeProxy(termIssuer.address, TermIssuer, { kind: "uups" });
  await upgraded.waitForDeployment();
  saveDeployment(network, "TermIssuer", termIssuer.address, JSON.parse(upgraded.interface.formatJson()));

  console.log("");
  await confirm("TermIssuer", termIssuer.address, "setFeeRecipient(address)", was);
  console.log(
    "\nfeeRecipient is unset, which still means the carry treasury -- nothing has moved.\n" +
      "Next: scripts/configure-carry-recipients.mjs --apply (fee first, then carry).",
  );
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
