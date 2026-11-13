import { ethers, upgrades } from "hardhat";

/**
 * DeedNFT takes its two delegatecall extensions as constructor arguments (they are too large to create in its
 * constructor under EIP-3860). Every test that deploys DeedNFT goes through here.
 */
export async function deployDeedExtensions(): Promise<[string, string]> {
  const mint = await (await ethers.getContractFactory("DeedNFTMintExtension")).deploy();
  const trust = await (await ethers.getContractFactory("DeedTrustExtension")).deploy();
  return [await mint.getAddress(), await trust.getAddress()];
}

export async function deployDeedNFT(initArgs: unknown[], opts: Record<string, unknown> = {}): Promise<any> {
  const F = await ethers.getContractFactory("DeedNFT");
  return upgrades.deployProxy(F, initArgs, {
    kind: "uups",
    ...opts,
    constructorArgs: await deployDeedExtensions(),
    unsafeAllow: ["constructor", "delegatecall", "state-variable-immutable"],
  });
}

/** The IDeedTrust view of a DeedNFT proxy (the functions its fallback serves). */
export async function trustOf(deed: any): Promise<any> {
  return ethers.getContractAt("IDeedTrust", await deed.getAddress());
}
