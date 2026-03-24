import { ethers } from "hardhat";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { getDeployment } from "../deploy/helpers";
import { getChainConfigByKey } from "../config/chain-manifest-loader";

function normalizePrivateKey(rawValue: string | undefined): string {
  const trimmed = (rawValue || "").trim();
  if (!trimmed) return "";
  if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) return trimmed;
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return `0x${trimmed}`;
  return trimmed;
}

async function main() {
  const [sourceSigner] = await ethers.getSigners();
  const sourceNetwork = await ethers.provider.getNetwork();

  if (sourceNetwork.name !== "home-testnet" && Number(sourceNetwork.chainId) !== 92373) {
    throw new Error(
      `Run this script on home-testnet. Current: ${sourceNetwork.name} (${sourceNetwork.chainId})`
    );
  }

  const sourceBridgeAddress = getDeployment(sourceNetwork.name, "CLRUSDBridge")?.address || "";
  const sourceTokenAddress = getDeployment(sourceNetwork.name, "ClearUSD")?.address || "";
  const destBridgeAddress = getDeployment("base-sepolia", "CLRUSDBridge")?.address || "";
  const destTokenAddress = getDeployment("base-sepolia", "ClearUSD")?.address || "";

  if (!sourceBridgeAddress || !sourceTokenAddress || !destBridgeAddress || !destTokenAddress) {
    throw new Error("Missing CLRUSD/bridge deployments for home-testnet or base-sepolia.");
  }

  const baseCfg = getChainConfigByKey("base-sepolia");
  if (!baseCfg) throw new Error("Missing base-sepolia chain config.");
  const destRpcUrl = process.env.BASE_SEPOLIA_RPC_URL?.trim() || baseCfg.rpcUrl;

  const pk = normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY);
  if (!pk) throw new Error("Missing DEPLOYER_PRIVATE_KEY for destination bridgeIn tx signing.");

  const amountUnits = (process.env.BRIDGE_AMOUNT_CLRUSD || "1").trim();
  const amount = ethers.parseUnits(amountUnits, 6);
  const recipient = (process.env.BRIDGE_RECIPIENT || sourceSigner.address).trim();

  const sourceBridge = await ethers.getContractAt("CLRUSDBridge", sourceBridgeAddress);
  const sourceToken = await ethers.getContractAt("ClearUSD", sourceTokenAddress);

  const sourceBalanceBefore = await sourceToken.balanceOf(sourceSigner.address);
  if (sourceBalanceBefore < amount) {
    throw new Error(
      `Insufficient home CLRUSD. Need ${amount.toString()}, have ${sourceBalanceBefore.toString()}`
    );
  }

  const allowance = await sourceToken.allowance(sourceSigner.address, sourceBridgeAddress);
  if (allowance < amount) {
    const approveTx = await sourceToken.approve(sourceBridgeAddress, amount);
    await approveTx.wait();
    console.log("Approved source bridge:", approveTx.hash);
  }

  const remoteCfg = await sourceBridge.remoteChainConfig(84532);
  if (!remoteCfg.enabled) {
    throw new Error("Source bridge remote config for base-sepolia (84532) is disabled.");
  }

  console.log("Source signer:", sourceSigner.address);
  console.log("Source bridge:", sourceBridgeAddress);
  console.log("Source CLRUSD:", sourceTokenAddress);
  console.log("Destination bridge:", destBridgeAddress);
  console.log("Destination CLRUSD:", destTokenAddress);
  console.log("Recipient:", recipient);
  console.log("Amount (raw):", amount.toString());

  const outTx = await sourceBridge.bridgeOut(84532, recipient, amount);
  const outRcpt = await outTx.wait();

  let messageId: string | null = null;
  let nonce: bigint | null = null;
  for (const log of outRcpt.logs) {
    try {
      const parsed = sourceBridge.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed?.name === "BridgeOutInitiated") {
        messageId = parsed.args.messageId as string;
        nonce = parsed.args.nonce as bigint;
        break;
      }
    } catch {
      // ignore unrelated logs
    }
  }

  if (!messageId || nonce === null) {
    throw new Error("BridgeOutInitiated event not found.");
  }

  const message = {
    srcChainId: 92373n,
    dstChainId: 84532n,
    srcBridge: sourceBridgeAddress,
    srcToken: sourceTokenAddress,
    recipient,
    amount,
    nonce,
  };

  const localHash = await sourceBridge.hashMessage(message);
  if (localHash.toLowerCase() !== messageId.toLowerCase()) {
    throw new Error(`Message hash mismatch. event=${messageId} local=${localHash}`);
  }

  const signature = await sourceSigner.signMessage(ethers.getBytes(messageId));
  console.log("Bridge out tx:", outTx.hash);
  console.log("Message ID:", messageId);
  console.log("Nonce:", nonce.toString());

  const destProvider = new JsonRpcProvider(destRpcUrl);
  const destSigner = new Wallet(pk, destProvider);
  if (destSigner.address.toLowerCase() !== sourceSigner.address.toLowerCase()) {
    console.log(
      `Warning: destination signer ${destSigner.address} differs from source signer ${sourceSigner.address}`
    );
  }

  const bridgeAbi = getDeployment("base-sepolia", "CLRUSDBridge")?.abi;
  const tokenAbi = getDeployment("base-sepolia", "ClearUSD")?.abi;
  if (!bridgeAbi || !tokenAbi) {
    throw new Error("Missing ABI in base-sepolia deployment files.");
  }

  const destBridge = new Contract(destBridgeAddress, bridgeAbi, destSigner);
  const destToken = new Contract(destTokenAddress, tokenAbi, destSigner);

  const recipientBefore = await destToken.balanceOf(recipient);
  const inTx = await destBridge.bridgeIn(message, [signature]);
  await inTx.wait();
  const recipientAfter = await destToken.balanceOf(recipient);

  console.log("Bridge in tx:", inTx.hash);
  console.log("Destination recipient balance before:", recipientBefore.toString());
  console.log("Destination recipient balance after :", recipientAfter.toString());
  console.log("Destination delta:", (recipientAfter - recipientBefore).toString());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

