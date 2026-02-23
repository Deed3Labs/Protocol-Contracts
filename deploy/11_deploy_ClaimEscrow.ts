import { saveDeployment } from "./helpers";

async function main() {
  const hre = require("hardhat");
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  console.log("Deploying ClaimEscrow with:", deployer.address);
  console.log("Network:", network.name, "(chainId:", network.chainId, ")");

  let usdcAddress: string;
  if (network.chainId === 8453n) {
    usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base mainnet USDC
  } else if (network.chainId === 84532n) {
    usdcAddress = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia USDC
  } else {
    throw new Error(`Unsupported network for ClaimEscrow: ${network.name} (${network.chainId})`);
  }

  const payoutTreasury = process.env.SEND_PAYOUT_TREASURY || deployer.address;
  if (!hre.ethers.isAddress(payoutTreasury)) {
    throw new Error("SEND_PAYOUT_TREASURY must be a valid address");
  }

  console.log("USDC:", usdcAddress);
  console.log("Payout treasury:", payoutTreasury);

  const ClaimEscrow = await hre.ethers.getContractFactory("ClaimEscrow");
  const claimEscrow = await ClaimEscrow.deploy(usdcAddress, payoutTreasury, deployer.address);
  await claimEscrow.waitForDeployment();

  const claimEscrowAddress = await claimEscrow.getAddress();
  console.log("ClaimEscrow deployed to:", claimEscrowAddress);

  const abi = JSON.parse(claimEscrow.interface.formatJson());
  saveDeployment(network.name, "ClaimEscrow", claimEscrowAddress, abi);
  console.log("Saved deployment metadata for ClaimEscrow");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
