import { getDeployment } from "../../deploy/helpers";

type RateLimiterConfig = {
  isEnabled: boolean;
  capacity: bigint;
  rate: bigint;
};

const DISABLED_RATE_LIMITER: RateLimiterConfig = {
  isEnabled: false,
  capacity: 0n,
  rate: 0n,
};

const TOKEN_ADMIN_REGISTRY_ABI = [
  "function acceptAdminRole(address token) external",
  "function setPool(address token, address pool) external",
];

const REGISTRY_MODULE_OWNER_CUSTOM_ABI = [
  "function registerAdminViaGetCCIPAdmin(address token) external",
  "function registerAccessControlDefaultAdmin(address token) external",
];

const BURN_MINT_POOL_ABI = [
  "function applyChainUpdates(uint64[] remoteChainSelectorsToRemove,(uint64 remoteChainSelector,bytes[] remotePoolAddresses,bytes remoteTokenAddress,(bool isEnabled,uint128 capacity,uint128 rate) outboundRateLimiterConfig,(bool isEnabled,uint128 capacity,uint128 rate) inboundRateLimiterConfig)[] chainsToAdd) external",
];

async function safeTx(label: string, fn: () => Promise<any>) {
  try {
    const tx = await fn();
    await tx.wait();
    console.log(`✓ ${label}`);
    return true;
  } catch (error: any) {
    const message = error?.shortMessage || error?.message || String(error);
    console.warn(`⚠ ${label} failed: ${message}`);
    return false;
  }
}

async function main() {
  const hre = require("hardhat");
  const [signer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  const tokenAddress =
    getDeployment(network.name, "ClearUSD")?.address ||
    process.env.CLRUSD_ADDRESS?.trim();
  const tokenPoolAddress =
    getDeployment(network.name, "CLRUSDTokenPool")?.address ||
    process.env.CLRUSD_TOKEN_POOL_ADDRESS?.trim();

  const tokenAdminRegistry = process.env.CCIP_TOKEN_ADMIN_REGISTRY?.trim();
  const registryModuleOwnerCustom =
    process.env.CCIP_REGISTRY_MODULE_OWNER_CUSTOM?.trim() || "";
  const remoteChainSelectorRaw = process.env.CCIP_REMOTE_CHAIN_SELECTOR?.trim();
  const remoteTokenAddress = process.env.CCIP_REMOTE_TOKEN_ADDRESS?.trim();
  const remotePoolAddress = process.env.CCIP_REMOTE_POOL_ADDRESS?.trim();

  if (!tokenAddress) throw new Error("Missing CLRUSD_ADDRESS (or ClearUSD deployment).");
  if (!tokenPoolAddress) {
    throw new Error(
      "Missing CLRUSD_TOKEN_POOL_ADDRESS (or CLRUSDTokenPool deployment)."
    );
  }
  if (!tokenAdminRegistry) {
    throw new Error("Missing CCIP_TOKEN_ADMIN_REGISTRY.");
  }
  if (!remoteChainSelectorRaw || !remoteTokenAddress || !remotePoolAddress) {
    throw new Error(
      "Missing one or more required remote vars: CCIP_REMOTE_CHAIN_SELECTOR, CCIP_REMOTE_TOKEN_ADDRESS, CCIP_REMOTE_POOL_ADDRESS."
    );
  }

  const remoteChainSelector = BigInt(remoteChainSelectorRaw);
  const encodedRemoteToken = hre.ethers.AbiCoder.defaultAbiCoder().encode(
    ["address"],
    [remoteTokenAddress]
  );
  const encodedRemotePool = hre.ethers.AbiCoder.defaultAbiCoder().encode(
    ["address"],
    [remotePoolAddress]
  );

  console.log("Signer:", signer.address);
  console.log("Network:", network.name, `(${network.chainId})`);
  console.log("CLRUSD:", tokenAddress);
  console.log("Token pool:", tokenPoolAddress);
  console.log("Token admin registry:", tokenAdminRegistry);
  console.log("Registry module owner custom:", registryModuleOwnerCustom || "(not provided)");
  console.log("Remote selector:", remoteChainSelector.toString());
  console.log("Remote token:", remoteTokenAddress);
  console.log("Remote pool:", remotePoolAddress);

  const clearUsd = await hre.ethers.getContractAt("ClearUSD", tokenAddress);
  await safeTx("Grant pool mint+burn roles", async () =>
    clearUsd.grantMintAndBurnRoles(tokenPoolAddress)
  );

  const registry = new hre.ethers.Contract(tokenAdminRegistry, TOKEN_ADMIN_REGISTRY_ABI, signer);
  if (registryModuleOwnerCustom) {
    const module = new hre.ethers.Contract(
      registryModuleOwnerCustom,
      REGISTRY_MODULE_OWNER_CUSTOM_ABI,
      signer
    );
    const registeredViaCCIPAdmin = await safeTx(
      "Register token admin via getCCIPAdmin",
      async () => module.registerAdminViaGetCCIPAdmin(tokenAddress)
    );
    if (!registeredViaCCIPAdmin) {
      await safeTx("Register token admin via AccessControl default admin", async () =>
        module.registerAccessControlDefaultAdmin(tokenAddress)
      );
    }
  }
  await safeTx("Accept token admin role", async () => registry.acceptAdminRole(tokenAddress));
  await safeTx("Set token pool in registry", async () =>
    registry.setPool(tokenAddress, tokenPoolAddress)
  );

  const tokenPool = new hre.ethers.Contract(tokenPoolAddress, BURN_MINT_POOL_ABI, signer);

  const updates = [
    {
      remoteChainSelector,
      remotePoolAddresses: [encodedRemotePool],
      remoteTokenAddress: encodedRemoteToken,
      outboundRateLimiterConfig: DISABLED_RATE_LIMITER,
      inboundRateLimiterConfig: DISABLED_RATE_LIMITER,
    },
  ];

  const removeList: bigint[] = [];
  await safeTx("Configure token pool chain update", async () =>
    tokenPool[
      "applyChainUpdates(uint64[],(uint64,bytes[],bytes,(bool,uint128,uint128),(bool,uint128,uint128))[])"
    ](removeList, updates)
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
