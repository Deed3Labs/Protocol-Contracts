import * as fs from "fs";
import * as path from "path";

const DEPLOYMENTS_DIR = "./deployments";

export function saveDeployment(network: string, contractName: string, address: string, abi: any) {
  const networkDir = path.join(DEPLOYMENTS_DIR, network);
  if (!fs.existsSync(networkDir)) {
    fs.mkdirSync(networkDir, { recursive: true });
  }

  const deployment = {
    address,
    abi,
    blockNumber: 0, // You might want to get this from the deployment transaction
  };

  fs.writeFileSync(
    path.join(networkDir, `${contractName}.json`),
    JSON.stringify(deployment, null, 2)
  );
}

export function getDeployment(network: string, contractName: string): { address: string; abi: any } | null {
  const filePath = path.join(DEPLOYMENTS_DIR, network, `${contractName}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const deployment = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    address: deployment.address,
    abi: deployment.abi,
  };
}

/**
 * Refuses to go on against Base mainnet (or Ethereum mainnet) unless CONFIRM_MAINNET=1 is set.
 * ESADepositVault and ClaimEscrow are live there; a script that sends, or that prepares a batch
 * for a Safe, asks for the confirmation first.
 */
export function requireMainnetConfirmation(network: string, what: string) {
  if ((network === "base" || network === "mainnet") && process.env.CONFIRM_MAINNET !== "1") {
    throw new Error(`${what} would act on ${network}. Set CONFIRM_MAINNET=1 to confirm that is meant.`);
  }
}