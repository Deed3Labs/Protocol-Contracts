import fs from "fs";
import path from "path";
import { getDeployment, saveDeployment } from "./helpers";

function parseSigners(raw: string | undefined, deployer: string): string[] {
  const fallback = raw?.trim() ? raw : deployer;
  const values = fallback
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return Array.from(new Set(values));
}

function getBaseSepoliaClrUsdFromDeployments(): string {
  const filePath = path.join("deployments", "base-sepolia", "ClearUSD.json");
  if (!fs.existsSync(filePath)) return "";

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return typeof parsed.address === "string" ? parsed.address : "";
  } catch {
    return "";
  }
}

async function main() {
  const hre = require("hardhat");
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  const deployedClearUsd = getDeployment(network.name, "ClearUSD")?.address || "";
  const clearUsdAddress = process.env.CLRUSD_ADDRESS?.trim() || deployedClearUsd;
  if (!clearUsdAddress) {
    throw new Error("Missing CLRUSD address. Set CLRUSD_ADDRESS or deploy ClearUSD first.");
  }

  const admin = process.env.CLRUSD_BRIDGE_ADMIN?.trim() || deployer.address;
  const signers = parseSigners(process.env.CLRUSD_BRIDGE_SIGNERS, deployer.address);
  const thresholdRaw = process.env.CLRUSD_BRIDGE_SIGNER_THRESHOLD?.trim() || "1";
  const threshold = Number(thresholdRaw);
  if (!Number.isInteger(threshold) || threshold <= 0 || threshold > signers.length) {
    throw new Error(
      `Invalid CLRUSD_BRIDGE_SIGNER_THRESHOLD (${thresholdRaw}); must be 1..${signers.length}`
    );
  }

  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name, `(${network.chainId})`);
  console.log("CLRUSD:", clearUsdAddress);
  console.log("Bridge admin:", admin);
  console.log("Bridge signers:", signers);
  console.log("Signer threshold:", threshold);

  const CLRUSDBridge = await hre.ethers.getContractFactory("CLRUSDBridge");
  const bridge = await CLRUSDBridge.deploy(clearUsdAddress, admin, signers, threshold);
  await bridge.waitForDeployment();
  const bridgeAddress = await bridge.getAddress();
  console.log("CLRUSDBridge deployed at:", bridgeAddress);

  const clearUsd = await hre.ethers.getContractAt("ClearUSD", clearUsdAddress);
  const minterRole = await clearUsd.MINTER_ROLE();
  const burnerRole = await clearUsd.BURNER_ROLE();

  const hasMinterRole = await clearUsd.hasRole(minterRole, bridgeAddress);
  const hasBurnerRole = await clearUsd.hasRole(burnerRole, bridgeAddress);

  if (!hasMinterRole || !hasBurnerRole) {
    console.log("Granting CLRUSD issuer roles to bridge...");
    const tx = await clearUsd.grantIssuerRoles(bridgeAddress);
    await tx.wait();
    console.log("Granted issuer roles to bridge:", tx.hash);
  } else {
    console.log("Bridge already has CLRUSD issuer roles");
  }

  const remoteChainIdRaw = process.env.CLRUSD_BRIDGE_REMOTE_CHAIN_ID?.trim() || "84532"; // base-sepolia
  const remoteChainId = Number(remoteChainIdRaw);
  const remoteBridge = process.env.CLRUSD_BRIDGE_REMOTE_BRIDGE?.trim() || "";
  const remoteToken =
    process.env.CLRUSD_BRIDGE_REMOTE_TOKEN?.trim() || getBaseSepoliaClrUsdFromDeployments();

  if (
    Number.isInteger(remoteChainId) &&
    remoteChainId > 0 &&
    remoteBridge &&
    remoteToken
  ) {
    const tx = await bridge.setRemoteChainConfig(remoteChainId, remoteBridge, remoteToken, true);
    await tx.wait();
    console.log(
      `Configured remote chain ${remoteChainId}: bridge=${remoteBridge}, token=${remoteToken}`
    );
  } else {
    console.log(
      "Skipped remote chain enablement (set CLRUSD_BRIDGE_REMOTE_BRIDGE and CLRUSD_BRIDGE_REMOTE_TOKEN to enable)."
    );
  }

  saveDeployment(
    network.name,
    "CLRUSDBridge",
    bridgeAddress,
    JSON.parse(bridge.interface.formatJson())
  );
  console.log("Saved deployment: deployments/" + network.name + "/CLRUSDBridge.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
