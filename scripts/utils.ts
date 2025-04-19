import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

export const DEPLOYMENTS_DIR = "./deployments";

export async function getContract(name: string, address?: string) {
  const artifact = await import(`../artifacts/contracts/${name}.sol/${name}.json`);
  const signer = await ethers.getSigner();
  return new ethers.Contract(
    address || artifact.address,
    artifact.abi,
    signer
  );
}

export function saveDeployment(network: string, contractName: string, address: string, abi: any) {
  const networkDir = path.join(DEPLOYMENTS_DIR, network);
  if (!fs.existsSync(networkDir)) {
    fs.mkdirSync(networkDir, { recursive: true });
  }

  const deployment = {
    address,
    abi,
    blockNumber: 0,
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

export async function getNetwork() {
  const network = await ethers.provider.getNetwork();
  return network.name;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
} 