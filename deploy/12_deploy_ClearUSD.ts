import { getDeployment, saveDeployment } from "./helpers";

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function parseSalt(hre: any, value: string | undefined): string {
  const raw = (value || "CLRUSD_V1").trim();
  if (raw.startsWith("0x") && raw.length === 66) return raw;
  return hre.ethers.id(raw);
}

async function main() {
  const hre = require("hardhat");
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  const admin = process.env.CLRUSD_ADMIN?.trim() || deployer.address;
  const maxSupplyUnits = (process.env.CLRUSD_MAX_SUPPLY || "0").trim();
  const preMintUnits = (process.env.CLRUSD_PREMINT || "0").trim();

  const maxSupply =
    maxSupplyUnits === "0" ? 0n : hre.ethers.parseUnits(maxSupplyUnits, 6);
  const preMint = preMintUnits === "0" ? 0n : hre.ethers.parseUnits(preMintUnits, 6);

  const useCreate2 = parseBool(process.env.CLRUSD_USE_CREATE2, true);

  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name, `(${network.chainId})`);
  console.log("CLRUSD admin:", admin);
  console.log("Max supply:", maxSupply.toString());
  console.log("Pre-mint:", preMint.toString());
  console.log("Use CREATE2:", useCreate2);

  const ClearUSD = await hre.ethers.getContractFactory("ClearUSD");
  let clearUsdAddress: string;
  let clearUsdContract: any;

  if (useCreate2) {
    const providedFactory = process.env.CLRUSD_CREATE2_FACTORY_ADDRESS?.trim();
    let create2FactoryAddress = providedFactory || "";

    if (!create2FactoryAddress) {
      const existingFactory = getDeployment(network.name, "Create2Deployer");
      if (existingFactory?.address) {
        create2FactoryAddress = existingFactory.address;
      } else {
        console.log("Deploying Create2Deployer...");
        const Create2Deployer = await hre.ethers.getContractFactory("Create2Deployer");
        const deployedFactory = await Create2Deployer.deploy();
        await deployedFactory.waitForDeployment();
        create2FactoryAddress = await deployedFactory.getAddress();
        saveDeployment(
          network.name,
          "Create2Deployer",
          create2FactoryAddress,
          JSON.parse(deployedFactory.interface.formatJson())
        );
        console.log("Create2Deployer deployed to:", create2FactoryAddress);
      }
    }

    const create2Factory = await hre.ethers.getContractAt(
      "Create2Deployer",
      create2FactoryAddress
    );

    const encodedArgs = hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256"],
      [admin, maxSupply, preMint]
    );
    const creationCode = hre.ethers.concat([ClearUSD.bytecode, encodedArgs]);

    const salt = parseSalt(hre, process.env.CLRUSD_CREATE2_SALT);
    const codeHash = hre.ethers.keccak256(creationCode);
    const predictedAddress = hre.ethers.getCreate2Address(
      create2FactoryAddress,
      salt,
      codeHash
    );

    console.log("CREATE2 factory:", create2FactoryAddress);
    console.log("CREATE2 salt:", salt);
    console.log("Predicted CLRUSD address:", predictedAddress);

    const existingCode = await hre.ethers.provider.getCode(predictedAddress);
    if (existingCode === "0x") {
      console.log("Deploying CLRUSD via CREATE2...");
      const tx = await create2Factory.deploy(salt, creationCode);
      await tx.wait();
    } else {
      console.log("CLRUSD already deployed at predicted address, skipping deploy.");
    }

    clearUsdAddress = predictedAddress;
    clearUsdContract = await hre.ethers.getContractAt("ClearUSD", clearUsdAddress);
  } else {
    console.log("Deploying CLRUSD via standard CREATE...");
    clearUsdContract = await ClearUSD.deploy(admin, maxSupply, preMint);
    await clearUsdContract.waitForDeployment();
    clearUsdAddress = await clearUsdContract.getAddress();
  }

  console.log("CLRUSD deployed at:", clearUsdAddress);
  saveDeployment(
    network.name,
    "ClearUSD",
    clearUsdAddress,
    JSON.parse(clearUsdContract.interface.formatJson())
  );
  console.log("Saved deployment: deployments/" + network.name + "/ClearUSD.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
