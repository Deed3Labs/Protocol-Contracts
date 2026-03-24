import { ethers } from "hardhat";
import { getDeployment } from "../deploy/helpers";

type TraitInput = {
  key: string;
  value: string;
};

// Trait keys mirror docs/assets/estate-assets.md
const ESTATE_DOC_TRAITS: TraitInput[] = [
  { key: "property_type", value: "Residential" },
  { key: "square_footage", value: "2875" },
  { key: "bedrooms", value: "4" },
  { key: "bathrooms", value: "3.5" },
  { key: "address", value: "475 Harbor View Dr, San Diego, CA" },
  { key: "year_built", value: "2019" },
  { key: "condition", value: "Excellent" },
  { key: "jurisdiction", value: "California" },
  { key: "registration_number", value: "PR-2026-0475-HV" },
  { key: "registration_date", value: "2026-03-23" },
  { key: "title_number", value: "T-CA-SD-884712" },
  { key: "zoning", value: "R-1 Residential" },
  { key: "lot_size", value: "9200" },
  { key: "building_type", value: "Single Family" },
  { key: "construction_type", value: "Wood Frame" },
  { key: "roof_type", value: "Tile" },
  { key: "heating_type", value: "Forced Air" },
  { key: "cooling_type", value: "Central Air" },
];

// Additional renderer-friendly name traits for human-readable token names.
const ESTATE_RENDERER_NAME_TRAITS: TraitInput[] = [
  { key: "streetNumber", value: "475" },
  { key: "streetName", value: "Harbor View Dr" },
  { key: "state", value: "CA" },
  { key: "zipCode", value: "92101" },
  { key: "country", value: "USA" },
  { key: "parcelNumber", value: "SD-HV-475-2026" },
];

function decodeDataUriJson(uri: string): any {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) return null;
  const encoded = uri.slice(prefix.length);
  const json = Buffer.from(encoded, "base64").toString("utf8");
  return JSON.parse(json);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  const deedDeployment = getDeployment(network.name, "DeedNFT");
  const rendererDeployment = getDeployment(network.name, "MetadataRenderer");
  const validatorDeployment = getDeployment(network.name, "Validator");
  const registryDeployment = getDeployment(network.name, "ValidatorRegistry");
  const fundManagerDeployment = getDeployment(network.name, "FundManager");
  const clearUsdDeployment = getDeployment(network.name, "ClearUSD");

  if (
    !deedDeployment ||
    !rendererDeployment ||
    !validatorDeployment ||
    !registryDeployment ||
    !fundManagerDeployment ||
    !clearUsdDeployment
  ) {
    throw new Error(
      "Missing required deployments: DeedNFT, MetadataRenderer, Validator, ValidatorRegistry, FundManager, ClearUSD"
    );
  }

  const deedNFTAddress = deedDeployment.address;
  const rendererAddress = rendererDeployment.address;
  const validatorAddress = validatorDeployment.address;
  const registryAddress = registryDeployment.address;
  const fundManagerAddress = fundManagerDeployment.address;
  const clearUsdAddress = clearUsdDeployment.address;

  const deedNFT = await ethers.getContractAt("DeedNFT", deedNFTAddress);
  const renderer = await ethers.getContractAt("MetadataRenderer", rendererAddress);
  const validator = await ethers.getContractAt("Validator", validatorAddress);
  const registry = await ethers.getContractAt("ValidatorRegistry", registryAddress);
  const fundManager = await ethers.getContractAt("FundManager", fundManagerAddress);
  const clearUsd = await ethers.getContractAt("ClearUSD", clearUsdAddress);

  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name, `(${network.chainId})`);
  console.log("DeedNFT:", deedNFTAddress);
  console.log("MetadataRenderer:", rendererAddress);
  console.log("Validator:", validatorAddress);
  console.log("ValidatorRegistry:", registryAddress);
  console.log("FundManager:", fundManagerAddress);
  console.log("CLRUSD:", clearUsdAddress);

  const serviceFeeUnits = process.env.MOCK_TDEED_SERVICE_FEE?.trim() || "1";
  const serviceFee = ethers.parseUnits(serviceFeeUnits, 6);
  console.log("Service fee (CLRUSD):", serviceFee.toString());

  const currentRenderer = await deedNFT.metadataRenderer();
  if (currentRenderer.toLowerCase() !== rendererAddress.toLowerCase()) {
    const tx = await deedNFT.setMetadataRenderer(rendererAddress);
    await tx.wait();
    console.log("Set DeedNFT metadata renderer:", tx.hash);
  }

  const rendererDeed = await renderer.deedNFT();
  if (rendererDeed.toLowerCase() !== deedNFTAddress.toLowerCase()) {
    const tx = await renderer.setDeedNFT(deedNFTAddress);
    await tx.wait();
    console.log("Set MetadataRenderer deedNFT:", tx.hash);
  }

  const validatorPrimaryDeed = await validator.primaryDeedNFT();
  if (validatorPrimaryDeed.toLowerCase() !== deedNFTAddress.toLowerCase()) {
    const tx = await validator.setDeedNFT(deedNFTAddress);
    await tx.wait();
    console.log("Set Validator primary DeedNFT:", tx.hash);
  }

  const registryDeed = await registry.deedNFT();
  if (registryDeed.toLowerCase() !== deedNFTAddress.toLowerCase()) {
    const tx = await registry.setDeedNFT(deedNFTAddress);
    await tx.wait();
    console.log("Set ValidatorRegistry DeedNFT:", tx.hash);
  }

  const isRegistered = await registry.isValidatorRegistered(validatorAddress);
  if (!isRegistered) {
    const tx = await registry.registerValidator(
      validatorAddress,
      "Default Validator",
      "Default validator for mock T-Deed minting",
      [0, 1, 2, 3]
    );
    await tx.wait();
    console.log("Registered validator:", tx.hash);
  }

  const isActive = await registry.isValidatorActive(validatorAddress);
  if (!isActive) {
    const tx = await registry.updateValidatorStatus(validatorAddress, true);
    await tx.wait();
    console.log("Activated validator:", tx.hash);
  }

  const currentFundManager = await deedNFT.fundManager();
  if (currentFundManager.toLowerCase() !== fundManagerAddress.toLowerCase()) {
    const tx = await deedNFT.setFundManager(fundManagerAddress);
    await tx.wait();
    console.log("Set DeedNFT FundManager:", tx.hash);
  }

  const validatorFundManager = await validator.fundManager();
  if (validatorFundManager.toLowerCase() !== fundManagerAddress.toLowerCase()) {
    const tx = await validator.setFundManager(fundManagerAddress);
    await tx.wait();
    console.log("Set Validator FundManager:", tx.hash);
  }

  const tokenWhitelisted = await validator.isTokenWhitelisted(clearUsdAddress);
  if (!tokenWhitelisted) {
    const tx = await validator.addWhitelistedToken(clearUsdAddress);
    await tx.wait();
    console.log("Whitelisted CLRUSD on Validator:", tx.hash);
  }

  const currentServiceFee = await validator.getServiceFee(clearUsdAddress);
  if (currentServiceFee !== serviceFee) {
    const tx = await validator.setServiceFee(clearUsdAddress, serviceFee);
    await tx.wait();
    console.log("Set CLRUSD service fee on Validator:", tx.hash);
  }

  if (!(await fundManager.isCompatibleDeedNFT(deedNFTAddress))) {
    const tx = await fundManager.addCompatibleDeedNFT(deedNFTAddress);
    await tx.wait();
    console.log("Added DeedNFT compatibility in FundManager:", tx.hash);
  }

  const balance = await clearUsd.balanceOf(deployer.address);
  if (balance < serviceFee) {
    const deficit = serviceFee - balance;
    const adminRole = await clearUsd.DEFAULT_ADMIN_ROLE();
    const isAdmin = await clearUsd.hasRole(adminRole, deployer.address);
    if (!isAdmin) {
      throw new Error(
        `Insufficient CLRUSD for service fee. Need ${serviceFee.toString()}, have ${balance.toString()}, and deployer is not DEFAULT_ADMIN_ROLE.`
      );
    }

    const minterRole = await clearUsd.MINTER_ROLE();
    if (!(await clearUsd.hasRole(minterRole, deployer.address))) {
      const grantTx = await clearUsd.grantIssuerRoles(deployer.address);
      await grantTx.wait();
      console.log("Granted deployer CLRUSD issuer roles:", grantTx.hash);
    }

    const mintTx = await clearUsd.mint(deployer.address, deficit);
    await mintTx.wait();
    console.log("Minted CLRUSD for service fee:", mintTx.hash);
  }

  const allowance = await clearUsd.allowance(deployer.address, fundManagerAddress);
  if (allowance < serviceFee) {
    const approveTx = await clearUsd.approve(fundManagerAddress, serviceFee);
    await approveTx.wait();
    console.log("Approved FundManager CLRUSD spend:", approveTx.hash);
  }

  const definition =
    process.env.MOCK_TDEED_DEFINITION?.trim() ||
    "Mock Trust Deed for Clear Testnet metadata validation";
  const configuration =
    process.env.MOCK_TDEED_CONFIGURATION?.trim() ||
    "{\"parcelId\":\"MOCK-001\",\"county\":\"Clear County\",\"valuationUsd\":\"150000\"}";
  const fallbackUri =
    process.env.MOCK_TDEED_FALLBACK_URI?.trim() ||
    "ipfs://mock/tdeed/fallback-uri";

  const minterRole = await deedNFT.MINTER_ROLE();
  const hasMinter = await deedNFT.hasRole(minterRole, deployer.address);
  if (!hasMinter) {
    const tx = await deedNFT.grantRole(minterRole, deployer.address);
    await tx.wait();
    console.log("Granted MINTER_ROLE to deployer:", tx.hash);
  }

  const mintTx = await deedNFT.mintAsset(
    deployer.address,
    2, // Estate
    fallbackUri,
    definition,
    configuration,
    ethers.ZeroAddress, // use default validator
    clearUsdAddress, // enforce paid mint with CLRUSD
    0 // sequential token id
  );
  const receipt = await mintTx.wait();
  console.log("Mint tx:", mintTx.hash);

  let tokenId: bigint | null = null;
  for (const log of receipt.logs) {
    try {
      const parsed = deedNFT.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed?.name === "DeedNFTMinted") {
        tokenId = parsed.args.tokenId as bigint;
        break;
      }
    } catch {
      // ignore non-DeedNFT logs
    }
  }

  if (tokenId === null) {
    throw new Error("Mint succeeded but DeedNFTMinted event not found");
  }
  console.log("Minted tokenId:", tokenId.toString());

  const setStringTrait = async (traitKey: string, traitValue: string) => {
    const tx = await deedNFT.setTrait(
      tokenId!,
      ethers.toUtf8Bytes(traitKey),
      ethers.toUtf8Bytes(traitValue),
      1 // string value
    );
    await tx.wait();
  };

  for (const trait of ESTATE_DOC_TRAITS) {
    await setStringTrait(trait.key, trait.value);
  }
  console.log("Set estate doc traits:", ESTATE_DOC_TRAITS.length);

  for (const trait of ESTATE_RENDERER_NAME_TRAITS) {
    await setStringTrait(trait.key, trait.value);
  }
  console.log("Set renderer name traits:", ESTATE_RENDERER_NAME_TRAITS.length);

  await (await renderer.setTokenFeatures(tokenId, ["Mock data", "Metadata renderer validation"])).wait();
  await (
    await renderer.setAssetCondition(
      tokenId,
      "Good",
      "2026-03-23",
      ["None"],
      ["Survey completed"],
      "Mock condition payload for renderer check"
    )
  ).wait();
  await (
    await renderer.setTokenLegalInfo(
      tokenId,
      "US-TESTNET",
      "CLR-MOCK-0001",
      "2026-03-23",
      ["ipfs://mock/legal/deed.pdf"],
      ["Not for production settlement"],
      "Mock legal payload for renderer check"
    )
  ).wait();

  const deedTokenUri = await deedNFT.tokenURI(tokenId);
  const rendererTokenUri = await renderer.tokenURI(tokenId);
  const metadata = decodeDataUriJson(deedTokenUri);

  console.log("Deed tokenURI equals renderer tokenURI:", deedTokenUri === rendererTokenUri);
  console.log("tokenURI prefix:", deedTokenUri.slice(0, 32));

  if (metadata) {
    console.log("Metadata name:", metadata.name);
    console.log("Metadata description:", metadata.description);
    console.log("Metadata image:", metadata.image);
    console.log("Metadata attributes:", Array.isArray(metadata.attributes) ? metadata.attributes.length : 0);

    if (Array.isArray(metadata.attributes)) {
      const attrNames = new Set(
        metadata.attributes
          .map((attr: any) => (typeof attr?.trait_type === "string" ? attr.trait_type : ""))
          .filter(Boolean)
      );
      const missingDocTraits = ESTATE_DOC_TRAITS
        .map((trait) => trait.key)
        .filter((traitName) => !attrNames.has(traitName));
      console.log(
        "Doc trait coverage:",
        `${ESTATE_DOC_TRAITS.length - missingDocTraits.length}/${ESTATE_DOC_TRAITS.length}`
      );
      if (missingDocTraits.length > 0) {
        console.log("Missing doc trait keys:", missingDocTraits.join(", "));
      }
    }
  } else {
    console.log("Metadata decode skipped (tokenURI is not base64 JSON data URI)");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
