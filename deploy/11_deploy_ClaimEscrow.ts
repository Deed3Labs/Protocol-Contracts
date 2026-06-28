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

  // UUPS proxy — the returned address is stable across future upgrades.
  const ClaimEscrow = await hre.ethers.getContractFactory("ClaimEscrow");
  const claimEscrow = await hre.upgrades.deployProxy(
    ClaimEscrow,
    [usdcAddress, payoutTreasury, deployer.address],
    { initializer: "initialize", kind: "uups" },
  );
  await claimEscrow.waitForDeployment();

  const claimEscrowAddress = await claimEscrow.getAddress();
  console.log("ClaimEscrow (proxy) deployed to:", claimEscrowAddress);

  // Grant SETTLER_ROLE to the relayer that submits gasless creates + claim releases.
  const relayer = process.env.SEND_RELAYER_ADDRESS;
  if (relayer && hre.ethers.isAddress(relayer)) {
    const SETTLER_ROLE = await claimEscrow.SETTLER_ROLE();
    const tx = await claimEscrow.grantRole(SETTLER_ROLE, relayer);
    await tx.wait();
    console.log("Granted SETTLER_ROLE to relayer:", relayer);
  } else {
    console.warn("SEND_RELAYER_ADDRESS not set — grant SETTLER_ROLE to the relayer manually.");
  }

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
