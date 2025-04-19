import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const wallet = ethers.Wallet.createRandom();
  const account = {
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic?.phrase
  };

  const accountsDir = path.join(__dirname, "..", "accounts");
  if (!fs.existsSync(accountsDir)) {
    fs.mkdirSync(accountsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(accountsDir, `account-${timestamp}.json`);

  fs.writeFileSync(
    filePath,
    JSON.stringify(account, null, 2)
  );

  console.log("New account generated:");
  console.log("Address:", account.address);
  console.log("Private key:", account.privateKey);
  if (account.mnemonic) {
    console.log("Mnemonic:", account.mnemonic);
  }
  console.log("\nAccount details saved to:", filePath);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 