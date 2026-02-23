import * as dotenv from "dotenv";
dotenv.config();

import hre from "hardhat";

function resolveEscrowAddress(chainId: bigint): string {
  const chainSpecific = process.env[`SEND_CLAIM_ESCROW_ADDRESS_${chainId}` as keyof NodeJS.ProcessEnv];
  if (typeof chainSpecific === "string" && chainSpecific.trim().length > 0) {
    return chainSpecific.trim();
  }

  const globalEscrow = (process.env.SEND_CLAIM_ESCROW_ADDRESS || "").trim();
  if (globalEscrow.length > 0) {
    return globalEscrow;
  }

  throw new Error("Missing SEND_CLAIM_ESCROW_ADDRESS (or chain-specific override)");
}

function resolveSettlerAddress(): string {
  const cliAddress = (process.env.CLAIM_ESCROW_NEW_SETTLER || "").trim();
  const fromSendCdp = (process.env.SEND_CDP_EVM_ACCOUNT_ADDRESS || "").trim();
  const fromRelayer = (process.env.SEND_RELAYER_WALLET_ADDRESS || "").trim();
  const picked = cliAddress || fromSendCdp || fromRelayer;

  if (!picked) {
    throw new Error(
      "Missing settler address. Set CLAIM_ESCROW_NEW_SETTLER or SEND_CDP_EVM_ACCOUNT_ADDRESS."
    );
  }

  if (!hre.ethers.isAddress(picked)) {
    throw new Error("Settler address is not a valid EVM address");
  }

  return picked;
}

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const escrowAddress = resolveEscrowAddress(network.chainId);
  const settlerAddress = resolveSettlerAddress();

  if (!hre.ethers.isAddress(escrowAddress)) {
    throw new Error("Escrow address is invalid");
  }

  const claimEscrow = await hre.ethers.getContractAt(
    [
      "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
      "function SETTLER_ROLE() view returns (bytes32)",
      "function hasRole(bytes32 role, address account) view returns (bool)",
      "function grantRole(bytes32 role, address account)",
    ],
    escrowAddress
  );

  const defaultAdminRole = await claimEscrow.DEFAULT_ADMIN_ROLE();
  const settlerRole = await claimEscrow.SETTLER_ROLE();
  const signerAddress = await signer.getAddress();

  console.log("Network:", network.name, `(chainId: ${network.chainId})`);
  console.log("Escrow:", escrowAddress);
  console.log("Signer:", signerAddress);
  console.log("New settler:", settlerAddress);

  const signerIsAdmin = await claimEscrow.hasRole(defaultAdminRole, signerAddress);
  if (!signerIsAdmin) {
    throw new Error(
      "Current signer does not have DEFAULT_ADMIN_ROLE on ClaimEscrow. Grant role using the admin account (or Safe admin module)."
    );
  }

  const alreadySettler = await claimEscrow.hasRole(settlerRole, settlerAddress);
  if (alreadySettler) {
    console.log("No-op: address already has SETTLER_ROLE");
    return;
  }

  const tx = await claimEscrow.grantRole(settlerRole, settlerAddress);
  const receipt = await tx.wait();

  if (!receipt || receipt.status !== 1) {
    throw new Error("grantRole transaction failed");
  }

  console.log("Granted SETTLER_ROLE");
  console.log("Tx hash:", tx.hash);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
