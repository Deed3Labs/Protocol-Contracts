import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * UUPS upgrade of OffersIssuer, same proxy address, so the Ops Safe can change the $10 offers' cap and
 * terms by owning the contract: `setCap` and `setTerms` take the owner or an operator, where they took
 * an operator alone. Then ownership goes to the Safe (its treasury), which makes it the one that can
 * change the cap and terms, name another treasury, and upgrade the contract. Giving offers stays an
 * operator's (the backend's).
 *
 * The Safe isn't made an AccessManager operator instead: that would hand it every issuer's operator
 * calls, not just this one's.
 *
 *   npx hardhat run scripts/upgrade_offers_owner.ts --network base-sepolia
 *
 * OFFERS_UPGRADE_DRY_RUN=1 validates and reports without sending. Needs OffersIssuer's current owner.
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

const DRY_RUN = process.env.OFFERS_UPGRADE_DRY_RUN === "1";

async function main() {
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  const [signer] = await ethers.getSigners();
  const record = getDeployment(network, "OffersIssuer");
  if (!record) throw new Error(`No OffersIssuer on ${network}.`);

  const current = await ethers.getContractAt("OffersIssuer", record.address);
  const owner: string = await current.owner();
  const safe: string = await current.treasury();
  console.log(`network        ${network} (${net.chainId})`);
  console.log(`signer         ${signer.address}`);
  console.log(`OffersIssuer   ${record.address}`);
  console.log(`owner          ${owner}`);
  console.log(`treasury       ${safe} (becomes the owner)`);

  const OffersIssuer = await ethers.getContractFactory("OffersIssuer");
  await upgrades.validateUpgrade(record.address, OffersIssuer, { kind: "uups" });
  console.log("validates as upgrade-safe against what is deployed");

  if (DRY_RUN) {
    console.log("\nOFFERS_UPGRADE_DRY_RUN=1: validated, nothing sent.");
    return;
  }
  if (owner.toLowerCase() !== signer.address.toLowerCase()) throw new Error("The signer isn't OffersIssuer's owner; the owner runs this.");

  const before = await implementationOf(record.address);
  console.log("\nupgrading OffersIssuer…");
  const o = await upgrades.upgradeProxy(record.address, OffersIssuer, { kind: "uups" });
  await o.waitForDeployment();
  saveDeployment(network, "OffersIssuer", record.address, JSON.parse(o.interface.formatJson()));
  let implementation = before;
  for (let i = 0; i < 20 && implementation === before; i++) {
    implementation = await implementationOf(record.address);
    if (implementation === before) await new Promise((r) => setTimeout(r, 1500));
  }
  if (implementation === before) throw new Error("OffersIssuer still runs its old implementation.");
  console.log(`implementation ${implementation}`);

  console.log("handing ownership to the Safe…");
  await (await o.getFunction("transferOwnership")(safe)).wait(1);
  console.log(`owner          ${await o.getFunction("owner")()}`);
}

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function implementationOf(proxy: string): Promise<string> {
  const raw = await ethers.provider.getStorage(proxy, IMPL_SLOT);
  return ethers.getAddress("0x" + raw.slice(26));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
