import { getDeployment, saveDeployment } from "./helpers";

/** Where a factory from before Phase 2d is kept on record when this deploys its replacement. */
export const PRE2D_FACTORY_RECORD = "SavingsIntentFactoryPre2d";

/**
 * What to do with the recorded SavingsIntentFactory (DEPLOY-RUNBOOK §2.2 C4). The factory is not
 * upgradeable, so Phase 2d (`isIntentEscrow`, the H-4 salt) needs a new one, and this script used to
 * overwrite the record with no copy of the old address, leaving the runbook's "keep the old one
 * under another name first" to be done by hand. Now:
 * - nothing recorded: "deploy";
 * - a factory from before Phase 2d (no `isIntentEscrow`): its record is kept as
 *   `SavingsIntentFactoryPre2d` (once), then "deploy";
 * - a Phase 2d factory: "reuse", so running this again does not deploy a second one.
 */
export async function planSavingsFactory(network: string, log: (m: string) => void = console.log): Promise<"deploy" | "reuse"> {
  const { ethers } = require("hardhat");
  const current = getDeployment(network, "SavingsIntentFactory");
  if (!current) return "deploy";
  const probe = new ethers.Contract(current.address, ["function isIntentEscrow(address) view returns (bool)"], ethers.provider);
  if (await probe.isIntentEscrow(ethers.ZeroAddress).then(() => true, () => false)) {
    log(`= SavingsIntentFactory already at ${current.address} (Phase 2d)`);
    return "reuse";
  }
  if (!getDeployment(network, PRE2D_FACTORY_RECORD)) {
    saveDeployment(network, PRE2D_FACTORY_RECORD, current.address, current.abi);
    log(`  SavingsIntentFactory ${current.address} predates Phase 2d: kept on record as ${PRE2D_FACTORY_RECORD}`);
  }
  return "deploy";
}

function resolveRelayerAddress(chainId: number): string {
  const chainSpecific = process.env[`SAVINGS_RELAYER_ADDRESS_${chainId}`]?.trim();
  if (chainSpecific) return chainSpecific;

  const globalSavings = process.env.SAVINGS_RELAYER_ADDRESS?.trim();
  if (globalSavings) return globalSavings;

  const sendChainSpecific = process.env[`SEND_CDP_EVM_ACCOUNT_ADDRESS_${chainId}`]?.trim();
  if (sendChainSpecific) return sendChainSpecific;

  return process.env.SEND_CDP_EVM_ACCOUNT_ADDRESS?.trim() || "";
}

async function main() {
  const hre = require("hardhat");
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  const admin = process.env.SAVINGS_FACTORY_ADMIN?.trim() || deployer.address;

  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name, `(${network.chainId})`);
  console.log("Factory admin:", admin);

  if ((await planSavingsFactory(network.name)) === "reuse") return;

  const SavingsIntentFactory = await hre.ethers.getContractFactory("SavingsIntentFactory");
  const factory = await SavingsIntentFactory.deploy(admin);
  await factory.waitForDeployment();

  const factoryAddress = await factory.getAddress();
  console.log("SavingsIntentFactory deployed at:", factoryAddress);

  const relayerAddress = resolveRelayerAddress(Number(network.chainId));
  if (relayerAddress) {
    const creatorRole = await factory.CREATOR_ROLE();
    const settlerRole = await factory.SETTLER_ROLE();

    if (!(await factory.hasRole(creatorRole, relayerAddress))) {
      console.log("Granting CREATOR_ROLE to relayer:", relayerAddress);
      await (await factory.grantRole(creatorRole, relayerAddress)).wait();
    }

    if (!(await factory.hasRole(settlerRole, relayerAddress))) {
      console.log("Granting SETTLER_ROLE to relayer:", relayerAddress);
      await (await factory.grantRole(settlerRole, relayerAddress)).wait();
    }
  } else {
    console.warn("No savings relayer address configured. Grant roles manually after provisioning the server wallet.");
  }

  saveDeployment(
    network.name,
    "SavingsIntentFactory",
    factoryAddress,
    JSON.parse(factory.interface.formatJson())
  );
  console.log(
    "Saved deployment: deployments/" + network.name + "/SavingsIntentFactory.json"
  );

  const existingVault = getDeployment(network.name, "ESADepositVault")?.address;
  if (existingVault) {
    console.log("Existing ESADepositVault deployment:", existingVault);
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
