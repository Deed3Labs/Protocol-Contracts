import { ethers } from "hardhat";
import { getDeployment } from "../deploy/helpers";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim() || "";
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  const bridgeAddress =
    process.env.CLRUSD_BRIDGE_ADDRESS?.trim() ||
    getDeployment(network.name, "CLRUSDBridge")?.address ||
    "";
  if (!bridgeAddress) {
    throw new Error("Missing CLRUSDBridge deployment/address on this network.");
  }

  const remoteChainId = Number(requireEnv("CLRUSD_BRIDGE_REMOTE_CHAIN_ID"));
  const remoteBridge = requireEnv("CLRUSD_BRIDGE_REMOTE_BRIDGE");
  const remoteToken = requireEnv("CLRUSD_BRIDGE_REMOTE_TOKEN");
  const enabledRaw = (process.env.CLRUSD_BRIDGE_REMOTE_ENABLED || "true").trim().toLowerCase();
  const enabled = !["0", "false", "no", "off"].includes(enabledRaw);

  if (!Number.isInteger(remoteChainId) || remoteChainId <= 0) {
    throw new Error("CLRUSD_BRIDGE_REMOTE_CHAIN_ID must be a positive integer.");
  }

  const bridge = await ethers.getContractAt("CLRUSDBridge", bridgeAddress);

  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name, `(${network.chainId})`);
  console.log("Bridge:", bridgeAddress);
  console.log(
    "Target config:",
    `chainId=${remoteChainId}, remoteBridge=${remoteBridge}, remoteToken=${remoteToken}, enabled=${enabled}`
  );

  const current = await bridge.remoteChainConfig(remoteChainId);
  const currentMatches =
    current.remoteBridge.toLowerCase() === remoteBridge.toLowerCase() &&
    current.remoteToken.toLowerCase() === remoteToken.toLowerCase() &&
    current.enabled === enabled;

  if (currentMatches) {
    console.log("Remote chain config already up to date.");
  } else {
    const tx = await bridge.setRemoteChainConfig(remoteChainId, remoteBridge, remoteToken, enabled);
    await tx.wait();
    console.log("Updated remote chain config tx:", tx.hash);
  }

  const updated = await bridge.remoteChainConfig(remoteChainId);
  console.log("Remote chain config now:");
  console.log("  remoteBridge:", updated.remoteBridge);
  console.log("  remoteToken :", updated.remoteToken);
  console.log("  enabled     :", updated.enabled);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

