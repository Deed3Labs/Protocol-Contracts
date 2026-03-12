import { getDeployment, saveDeployment } from "./helpers";

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

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
