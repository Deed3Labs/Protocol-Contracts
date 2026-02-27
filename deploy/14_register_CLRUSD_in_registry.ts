import { getDeployment } from "./helpers";

async function main() {
  const hre = require("hardhat");
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  const tokenRegistryAddress =
    process.env.TOKEN_REGISTRY_ADDRESS?.trim() ||
    getDeployment(network.name, "TokenRegistry")?.address;
  const clearUsdAddress =
    getDeployment(network.name, "ClearUSD")?.address ||
    process.env.CLRUSD_ADDRESS?.trim();

  if (!tokenRegistryAddress) {
    throw new Error(
      "Missing TokenRegistry address. Set TOKEN_REGISTRY_ADDRESS or deploy TokenRegistry first."
    );
  }
  if (!clearUsdAddress) {
    throw new Error(
      "Missing CLRUSD address. Set CLRUSD_ADDRESS or deploy ClearUSD first."
    );
  }

  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name, `(${network.chainId})`);
  console.log("TokenRegistry:", tokenRegistryAddress);
  console.log("CLRUSD:", clearUsdAddress);

  const registry = await hre.ethers.getContractAt("TokenRegistry", tokenRegistryAddress);

  console.log("Setting CLRUSD metadata...");
  await (await registry.setTokenMetadata(clearUsdAddress, "CLRUSD", "Clear USD", 6)).wait();

  console.log("Setting CLRUSD stablecoin flag...");
  await (await registry.setStablecoin(clearUsdAddress, true)).wait();

  const fallbackPrice = hre.ethers.parseEther("1");
  console.log("Registering CLRUSD for current chain...");
  await (
    await registry.registerToken(
      clearUsdAddress,
      Number(network.chainId),
      clearUsdAddress,
      fallbackPrice
    )
  ).wait();

  const remoteChainIdRaw = process.env.CLRUSD_REMOTE_CHAIN_ID?.trim();
  const remoteAddress = process.env.CLRUSD_REMOTE_ADDRESS?.trim();
  if (remoteChainIdRaw && remoteAddress) {
    const remoteChainId = Number(remoteChainIdRaw);
    console.log(
      `Setting remote CLRUSD chain mapping chainId=${remoteChainId} -> ${remoteAddress}`
    );
    await (await registry.setChainAddress(clearUsdAddress, remoteChainId, remoteAddress)).wait();
  }

  console.log("CLRUSD registration complete.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
