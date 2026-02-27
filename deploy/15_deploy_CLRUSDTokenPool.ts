import { getDeployment, saveDeployment } from "./helpers";
import fs from "fs";
import path from "path";

const TOKEN_POOL_MINIMAL_ABI = [
  "function applyChainUpdates(uint64[] remoteChainSelectorsToRemove,(uint64 remoteChainSelector,bool allowed,bytes remotePoolAddress,bytes remoteTokenAddress,(bool isEnabled,uint128 capacity,uint128 rate) outboundRateLimiterConfig,(bool isEnabled,uint128 capacity,uint128 rate) inboundRateLimiterConfig)[] chainsToAdd) external",
];

async function main() {
  const hre = require("hardhat");
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  const existing = process.env.CLRUSD_TOKEN_POOL_ADDRESS?.trim();
  if (existing) {
    console.log("Using pre-deployed CLRUSD token pool:", existing);
    saveDeployment(network.name, "CLRUSDTokenPool", existing, TOKEN_POOL_MINIMAL_ABI);
    console.log(
      "Saved deployment: deployments/" + network.name + "/CLRUSDTokenPool.json"
    );
    return;
  }

  const tokenAddress =
    getDeployment(network.name, "ClearUSD")?.address ||
    process.env.CLRUSD_ADDRESS?.trim();
  const ccipRouter = process.env.CCIP_ROUTER?.trim();
  const ccipRmnProxy = process.env.CCIP_RMN_PROXY?.trim();

  if (!tokenAddress || !ccipRouter || !ccipRmnProxy) {
    throw new Error(
      "Missing CLRUSD pool deployment inputs. Set CLRUSD_TOKEN_POOL_ADDRESS or set CLRUSD_ADDRESS, CCIP_ROUTER, and CCIP_RMN_PROXY."
    );
  }

  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name, `(${network.chainId})`);
  console.log("CLRUSD:", tokenAddress);
  console.log("CCIP router:", ccipRouter);
  console.log("CCIP RMN proxy:", ccipRmnProxy);

  const clearUsd = await hre.ethers.getContractAt("ClearUSD", tokenAddress);
  const tokenDecimals = Number(await clearUsd.decimals());
  console.log("CLRUSD decimals:", tokenDecimals);

  try {
    const BurnMintTokenPool = await hre.ethers.getContractFactory("BurnMintTokenPool");
    const pool = await BurnMintTokenPool.deploy(
      tokenAddress,
      tokenDecimals,
      [],
      ccipRmnProxy,
      ccipRouter
    );
    await pool.waitForDeployment();
    const poolAddress = await pool.getAddress();
    console.log("Deployed CLRUSD token pool:", poolAddress);
    saveDeployment(
      network.name,
      "CLRUSDTokenPool",
      poolAddress,
      JSON.parse(pool.interface.formatJson())
    );
  } catch (error: any) {
    console.warn(
      "Hardhat artifact deployment path unavailable, trying @chainlink/contracts-ccip package ABI/bytecode fallback..."
    );

    const abiPath = path.join(
      process.cwd(),
      "node_modules",
      "@chainlink",
      "contracts-ccip",
      "abi",
      "v1_6_1",
      "burn_mint_token_pool.json"
    );
    const bytecodePath = path.join(
      process.cwd(),
      "node_modules",
      "@chainlink",
      "contracts-ccip",
      "bytecode",
      "v1_6_1",
      "burn_mint_token_pool.bin"
    );

    if (!fs.existsSync(abiPath) || !fs.existsSync(bytecodePath)) {
      throw new Error(
        "BurnMintTokenPool artifact and fallback package files are unavailable. Set CLRUSD_TOKEN_POOL_ADDRESS from an external deployment. Root error: " +
          (error?.message || String(error))
      );
    }

    const abi = JSON.parse(fs.readFileSync(abiPath, "utf8"));
    const bytecode = fs.readFileSync(bytecodePath, "utf8").trim();
    const fallbackFactory = new hre.ethers.ContractFactory(abi, bytecode, deployer);
    const pool = await fallbackFactory.deploy(
      tokenAddress,
      tokenDecimals,
      [],
      ccipRmnProxy,
      ccipRouter
    );
    await pool.waitForDeployment();
    const poolAddress = await pool.getAddress();
    console.log("Deployed CLRUSD token pool via fallback:", poolAddress);
    saveDeployment(network.name, "CLRUSDTokenPool", poolAddress, abi);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
