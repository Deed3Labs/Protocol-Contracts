import { getDeployment } from "../deploy/helpers";

/*
 * Testnet helper: top up the ESADepositVault with USDC so existing CLRUSD (e.g. minted by an older
 * vault before a migration) stays redeemable. In production every CLRUSD is backed 1:1 by USDC the
 * vault already holds, so this is only for testnets. Usage:
 *   SEED_AMOUNT=3 npx hardhat run scripts/seed_vault_usdc.ts --network base-sepolia
 */
const USDC_BY_CHAIN: Record<number, string> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

async function main() {
  const hre = require("hardhat");
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  const vault = process.env.SEED_VAULT?.trim() || getDeployment(network.name, "ESADepositVault")?.address;
  if (!vault) throw new Error(`No ESADepositVault on ${network.name}`);
  const usdcAddr = process.env.SEED_USDC?.trim() || USDC_BY_CHAIN[Number(network.chainId)];
  if (!usdcAddr) throw new Error(`No USDC configured for chain ${network.chainId}`);
  const amount = process.env.SEED_AMOUNT?.trim() || "3";

  const usdc = await hre.ethers.getContractAt(
    [
      "function transfer(address,uint256) returns (bool)",
      "function balanceOf(address) view returns (uint256)",
      "function decimals() view returns (uint8)",
    ],
    usdcAddr,
  );
  const dec = await usdc.decimals();
  const amt = hre.ethers.parseUnits(amount, dec);

  console.log(`Seeding ${amount} USDC from ${deployer.address} → vault ${vault}`);
  console.log("Vault USDC before:", hre.ethers.formatUnits(await usdc.balanceOf(vault), dec));
  await (await usdc.transfer(vault, amt)).wait();
  console.log("Vault USDC after :", hre.ethers.formatUnits(await usdc.balanceOf(vault), dec));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
