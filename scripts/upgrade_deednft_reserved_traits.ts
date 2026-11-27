import hre from "hardhat";
import { getDeployment, requireMainnetConfirmation } from "../deploy/helpers";

/*
 * UUPS upgrade of DeedNFT, same proxy address, to the current source with its two extensions.
 *
 * Only for the case where the owner keeps the Base Sepolia Deed track instead of redeploying it.
 * The runbook recommends the redeploy (`deploy/deploy_all.ts`; DEPLOY-RUNBOOK §1.1): deeds minted
 * before v5 have no per-token key sets and no trust record (PHASE-1-REPORT §5 item 6; PHASE-3-REPORT
 * §6). DeedNFT's layout is compatible with the recorded implementation (DEPLOY-RUNBOOK §1.1).
 *
 *   npx hardhat run scripts/upgrade_deednft_reserved_traits.ts --network base-sepolia                     # validate
 *   DEED_UPGRADE=1 npx hardhat run scripts/upgrade_deednft_reserved_traits.ts --network base-sepolia      # deploy and upgrade
 *
 * DeedNFT takes DeedNFTMintExtension and DeedTrustExtension as constructor arguments (EIP-3860
 * size), so both are deployed first and passed to the implementation, as deploy 03 and deploy_all.ts
 * do. The Base Sepolia proxy's first implementation predates the OpenZeppelin manifest, so
 * `upgradeProxy` cannot compare layouts against it: this validates the implementation, deploys it,
 * calls `upgradeTo` (from DEFAULT_ADMIN_ROLE) and only then registers the proxy (`forceImport`).
 * Without the admin role (after `deed_admin_handover.ts`, the Deed timelock) it deploys the
 * implementation and prints the `upgradeTo` call for the Foundation Safe to propose.
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

async function main() {
  const network = (await ethers.provider.getNetwork()).name;
  requireMainnetConfirmation(network, "scripts/upgrade_deednft_reserved_traits.ts");
  const proxy = getDeployment(network, "DeedNFT")?.address;
  if (!proxy) throw new Error(`No DeedNFT recorded for ${network}.`);
  const [signer] = await ethers.getSigners();

  const DeedNFT = await ethers.getContractFactory("DeedNFT");
  await upgrades.validateImplementation(DeedNFT, { kind: "uups" });
  console.log("DeedNFT validates as an upgradeable implementation.");
  if (process.env.DEED_UPGRADE !== "1") {
    console.log("Nothing deployed. DEED_UPGRADE=1 deploys the extensions and the implementation.");
    return;
  }

  const before = await upgrades.erc1967.getImplementationAddress(proxy);
  console.log("Proxy:", proxy, "\nCurrent implementation:", before);

  const mintExt = await (await ethers.getContractFactory("DeedNFTMintExtension")).deploy();
  await mintExt.waitForDeployment();
  const trustExt = await (await ethers.getContractFactory("DeedTrustExtension")).deploy();
  await trustExt.waitForDeployment();
  const rolesExt = await (await ethers.getContractFactory("DeedRolesExtension")).deploy();
  await rolesExt.waitForDeployment();
  const impl = await DeedNFT.deploy(await mintExt.getAddress(), await trustExt.getAddress(), await rolesExt.getAddress());
  await impl.waitForDeployment();
  const implAddress = await impl.getAddress();
  console.log(`New implementation ${implAddress} (extensions ${await mintExt.getAddress()}, ${await trustExt.getAddress()})`);

  const deed = DeedNFT.attach(proxy) as any;
  if (!(await deed.hasRole(ethers.ZeroHash, signer.address))) {
    console.log(`\n${signer.address} lacks DEFAULT_ADMIN_ROLE on ${proxy}: nothing upgraded. Propose (the Deed timelock, after deed_admin_handover.ts):`);
    console.log(`  to ${proxy}  data ${DeedNFT.interface.encodeFunctionData("upgradeTo", [implAddress])}`);
    return;
  }
  const tx = await deed.upgradeTo(implAddress);
  console.log("upgradeTo:", tx.hash);
  await tx.wait();

  const after = await upgrades.erc1967.getImplementationAddress(proxy);
  if (after.toLowerCase() !== implAddress.toLowerCase()) throw new Error(`Implementation is ${after}`);
  console.log("Implementation now:", after);

  // Register the proxy and its new implementation in the manifest for future upgrades.
  await upgrades.forceImport(proxy, DeedNFT, {
    kind: "uups",
    constructorArgs: [await mintExt.getAddress(), await trustExt.getAddress(), await rolesExt.getAddress()],
  } as any);
  console.log("Manifest updated.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
