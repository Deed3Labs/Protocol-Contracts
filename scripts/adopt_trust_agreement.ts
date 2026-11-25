import { getDeployment, requireMainnetConfirmation } from "../deploy/helpers";

/**
 * Trust deed setup on the v5 Validator and ValidatorRegistry (after deploy 30):
 *
 *   1. Adopt the real-property trust agreement version for Land (0) and Estate (2). A trust deed mints only
 *      with an agreement hash its validator has adopted for its asset type; Vehicle and CommercialEquipment
 *      never take one. The hash is the agreement's content hash, fixed once its text is final.
 *        DEED_AGREEMENT_V5_HASH   bytes32 (or DEED_AGREEMENT_FILE: keccak256 of that file's bytes)
 *        DEED_AGREEMENT_V5_URI    where the agreement text is published
 *        DEED_AGREEMENT_V5_NAME   optional, default "Deed Trust Agreement v5"
 *   2. List licensed trustees: trust companies or nonprofit trustees that are not validators. Signers of an
 *      active validator are eligible trustees without this.
 *        DEED_LICENSED_TRUSTEES   comma-separated addresses
 *        DEED_LICENSE_REF         bytes32 hash of the license or charter document
 *
 * Prints what it would do; EXECUTE=1 sends it (the deployer must hold the Validator's METADATA_ROLE and own
 * the registry; after deed_admin_handover.ts these are the Deed timelock's and this prints the calls instead).
 *
 *   DEED_AGREEMENT_V5_HASH=0x... DEED_AGREEMENT_V5_URI=ipfs://... npx hardhat run scripts/adopt_trust_agreement.ts --network base-sepolia
 */
async function main() {
  const { ethers } = require("hardhat");
  const fs = require("fs");
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  requireMainnetConfirmation(network, "scripts/adopt_trust_agreement.ts");
  const execute = process.env.EXECUTE === "1";
  const [signer] = await ethers.getSigners();
  const need = (name: string) => {
    const r = getDeployment(network, name);
    if (!r) throw new Error(`No ${name} recorded for ${network}.`);
    return r.address;
  };
  const validator = await ethers.getContractAt("Validator", need("Validator"));
  const registry = await ethers.getContractAt("ValidatorRegistry", need("ValidatorRegistry"));

  let hash = process.env.DEED_AGREEMENT_V5_HASH;
  if (!hash && process.env.DEED_AGREEMENT_FILE) hash = ethers.keccak256(fs.readFileSync(process.env.DEED_AGREEMENT_FILE));
  const uri = process.env.DEED_AGREEMENT_V5_URI;
  const name = process.env.DEED_AGREEMENT_V5_NAME || "Deed Trust Agreement v5";
  const calls: { to: string; what: string; data: string; send: () => Promise<any> }[] = [];

  if (hash || uri) {
    if (!hash || !ethers.isHexString(hash, 32) || hash === ethers.ZeroHash) throw new Error("DEED_AGREEMENT_V5_HASH must be a non-zero bytes32");
    if (!uri) throw new Error("DEED_AGREEMENT_V5_URI is required with the hash");
    for (const t of [0, 2]) {
      if ((await validator.agreementVersionURI(t, hash)) === uri) {
        console.log(`= asset type ${t}: version ${hash} already adopted`);
        continue;
      }
      calls.push({
        to: await validator.getAddress(),
        what: `adopt ${hash} for asset type ${t}`,
        data: validator.interface.encodeFunctionData("adoptAgreementVersion", [t, hash, uri, name]),
        send: () => validator.adoptAgreementVersion(t, hash, uri, name),
      });
    }
  } else {
    console.log("No DEED_AGREEMENT_V5_HASH/URI: no agreement version to adopt.");
  }

  const trustees = (process.env.DEED_LICENSED_TRUSTEES || "").split(",").map((a) => a.trim()).filter(Boolean);
  const ref = process.env.DEED_LICENSE_REF || ethers.ZeroHash;
  for (const a of trustees) {
    if (!ethers.isAddress(a)) throw new Error(`not an address: ${a}`);
    if (await registry.isLicensedTrustee(a)) {
      console.log(`= ${a} is already a licensed trustee`);
      continue;
    }
    calls.push({
      to: await registry.getAddress(),
      what: `licensed trustee ${a}`,
      data: registry.interface.encodeFunctionData("setLicensedTrustee", [a, true, ref]),
      send: () => registry.setLicensedTrustee(a, true, ref),
    });
  }

  const canSend =
    (await validator.hasRole(await validator.METADATA_ROLE(), signer.address)) &&
    (await registry.owner()).toLowerCase() === signer.address.toLowerCase();
  for (const c of calls) {
    if (execute && canSend) {
      await (await c.send()).wait();
      console.log(`+ ${c.what}`);
    } else {
      console.log(`${execute ? "propose" : "would send"}: ${c.what}\n  to ${c.to}\n  data ${c.data}`);
    }
  }
  if (!calls.length) console.log("Nothing to do.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
