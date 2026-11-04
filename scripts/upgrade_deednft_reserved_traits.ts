import hre from "hardhat";
import { getDeployment } from "../deploy/helpers";

/*
 * UUPS upgrade of DeedNFT for the reserved-trait fix (#869), same proxy address.
 *
 *   npx hardhat run scripts/upgrade_deednft_reserved_traits.ts --network base-sepolia
 *
 * The Base Sepolia proxy's implementation predates the OpenZeppelin manifest, so `upgradeProxy`
 * can't compare layouts against it, and `forceImport` with today's factory would register the
 * new bytecode under the old address and turn the upgrade into a no-op. Instead this deploys the
 * implementation, calls `upgradeTo` directly, and only then registers the result. Storage is
 * unchanged since the deployed source (commit ad097d2f): the fix adds a pure helper and checks.
 * The signer needs DEFAULT_ADMIN_ROLE (`_authorizeUpgrade`).
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

async function main() {
  const network = (await ethers.provider.getNetwork()).name;
  const proxy = getDeployment(network, "DeedNFT")?.address;
  if (!proxy) throw new Error(`No DeedNFT recorded for ${network}.`);
  const [signer] = await ethers.getSigners();

  const DeedNFT = await ethers.getContractFactory("DeedNFT");
  await upgrades.validateImplementation(DeedNFT, { kind: "uups" });

  const deed = DeedNFT.attach(proxy) as any;
  if (!(await deed.hasRole(ethers.ZeroHash, signer.address))) {
    throw new Error(`${signer.address} lacks DEFAULT_ADMIN_ROLE on ${proxy}.`);
  }

  const before = await upgrades.erc1967.getImplementationAddress(proxy);
  console.log("Proxy:", proxy, "\nCurrent implementation:", before);

  const impl = await DeedNFT.deploy();
  await impl.waitForDeployment();
  const implAddress = await impl.getAddress();
  console.log("New implementation deployed:", implAddress);

  const tx = await deed.upgradeTo(implAddress);
  console.log("upgradeTo:", tx.hash);
  await tx.wait();

  const after = await upgrades.erc1967.getImplementationAddress(proxy);
  if (after.toLowerCase() !== implAddress.toLowerCase()) throw new Error(`Implementation is ${after}`);
  console.log("Implementation now:", after);

  // Register the proxy and its new implementation in the manifest for future upgrades.
  await upgrades.forceImport(proxy, DeedNFT, { kind: "uups" });
  console.log("Manifest updated.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
