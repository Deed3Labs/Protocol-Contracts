import { saveDeployment } from "./helpers";
import { assertChainHasTokenAddresses, requireChainConfigById } from "../config/chain-manifest-loader";

async function main() {
  const hre = require("hardhat");
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  console.log("Deploying ClaimEscrow with:", deployer.address);
  console.log("Network:", network.name, "(chainId:", network.chainId, ")");

  const chainConfig = requireChainConfigById(Number(network.chainId));
  assertChainHasTokenAddresses(chainConfig, ["usdc"]);
  const usdcAddress = chainConfig.tokens.usdc;

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
