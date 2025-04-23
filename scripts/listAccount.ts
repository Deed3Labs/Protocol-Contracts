import * as fs from "fs";
import * as path from "path";

async function main() {
  const accountsDir = path.join(__dirname, "..", "accounts");
  
  if (!fs.existsSync(accountsDir)) {
    console.log("No accounts directory found. Run generateAccount.ts first.");
    return;
  }

  const files = fs.readdirSync(accountsDir);
  
  if (files.length === 0) {
    console.log("No accounts found. Run generateAccount.ts first.");
    return;
  }

  console.log("Found accounts:");
  console.log("=============");

  for (const file of files) {
    if (file.endsWith(".json")) {
      const accountPath = path.join(accountsDir, file);
      const account = JSON.parse(fs.readFileSync(accountPath, "utf8"));
      
      console.log(`\nFile: ${file}`);
      console.log("Address:", account.address);
      console.log("Private key:", account.privateKey);
      if (account.mnemonic) {
        console.log("Mnemonic:", account.mnemonic);
      }
      console.log("-------------------");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 