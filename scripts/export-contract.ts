import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { getNetwork } from "./utils";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Exporting contracts with account:", deployer.address);

  const network = await getNetwork();
  console.log("Network:", network);

  const contractsDir = path.join(__dirname, "..", "contracts");
  const files = fs.readdirSync(contractsDir);

  for (const file of files) {
    if (file.endsWith(".sol")) {
      const contractName = path.basename(file, ".sol");
      console.log(`Exporting ${contractName}...`);

      try {
        const artifact = await import(`../artifacts/contracts/${contractName}.sol/${contractName}.json`);
        const exportPath = path.join(__dirname, "..", "exports", network);
        
        if (!fs.existsSync(exportPath)) {
          fs.mkdirSync(exportPath, { recursive: true });
        }

        fs.writeFileSync(
          path.join(exportPath, `${contractName}.json`),
          JSON.stringify(artifact, null, 2)
        );
        console.log(`Successfully exported ${contractName}`);
      } catch (error) {
        console.error(`Failed to export ${contractName}:`, error);
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 