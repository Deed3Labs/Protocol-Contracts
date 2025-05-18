import { ethers } from "hardhat";
// Use hardhat runtime environment to access upgrades, not direct import
const hre = require("hardhat");
const upgrades = hre.upgrades;
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
// Use 'any' for contract types instead of importing from typechain-types
// since the module isn't found

export interface DeployedContracts {
  deedNFT: any;
  validatorRegistry: any;
  validator: any;
  fundManager: any;
  fractionalize: any;
  subdivide: any;
  metadataRenderer: any;
  deployer: SignerWithAddress;
  admin: SignerWithAddress;
  validator1: SignerWithAddress;
  validator2: SignerWithAddress;
  user1: SignerWithAddress;
  user2: SignerWithAddress;
}

export async function deployContracts(): Promise<DeployedContracts> {
  const [deployer, admin, validator1, validator2, user1, user2] = await ethers.getSigners();
  
  // Deploy ValidatorRegistry
  const ValidatorRegistry = await ethers.getContractFactory("ValidatorRegistry");
  const validatorRegistry = await upgrades.deployProxy(ValidatorRegistry, []);
  await validatorRegistry.waitForDeployment();
  
  // Deploy Validator
  const Validator = await ethers.getContractFactory("Validator");
  const validator = await upgrades.deployProxy(Validator, [
    "ipfs://metadata/",  // baseUri
    "ipfs://agreements/" // defaultOperatingAgreementUri
  ]);
  await validator.waitForDeployment();
  
  // Deploy FundManager (with temporary addresses)
  const FundManager = await ethers.getContractFactory("FundManager");
  const fundManager = await upgrades.deployProxy(FundManager, [
    500,                      // _commissionPercentageRegular (5%)
    300,                      // _commissionPercentageValidator (3%)
    deployer.address,         // _feeReceiver
    validatorRegistry.getAddress() // _validatorRegistry
  ]);
  await fundManager.waitForDeployment();
  
  // Deploy DeedNFT with actual addresses
  const DeedNFT = await ethers.getContractFactory("DeedNFT");
  const deedNFT = await upgrades.deployProxy(DeedNFT, [
    await validator.getAddress(),
    await validatorRegistry.getAddress(),
    await fundManager.getAddress()
  ]);
  await deedNFT.waitForDeployment();
  
  // Update DeedNFT address in Validator
  await validator.initialize(await deedNFT.getAddress());
  
  // Update DeedNFT address in FundManager
  await fundManager.setDeedNFT(await deedNFT.getAddress());
  
  // Deploy extension contracts
  const Fractionalize = await ethers.getContractFactory("Fractionalize");
  const fractionalize = await upgrades.deployProxy(Fractionalize, [
    await deedNFT.getAddress(),
    ethers.ZeroAddress // Subdivision address not yet available
  ]);
  await fractionalize.waitForDeployment();
  
  const Subdivide = await ethers.getContractFactory("Subdivide");
  const subdivide = await upgrades.deployProxy(Subdivide, [
    await deedNFT.getAddress(),
    await fractionalize.getAddress()
  ]);
  await subdivide.waitForDeployment();
  
  // Update fractionalize with subdivide address
  await fractionalize.setSubdivideAddress(await subdivide.getAddress());
  
  // Deploy MetadataRenderer
  const MetadataRenderer = await ethers.getContractFactory("MetadataRenderer");
  const metadataRenderer = await upgrades.deployProxy(MetadataRenderer, [
    "https://api.deeds.com/metadata/" // Base URI for metadata
  ]);
  await metadataRenderer.waitForDeployment();
  
  // Set the metadata renderer in DeedNFT
  await deedNFT.setMetadataRenderer(await metadataRenderer.getAddress());
  
  // Setup mock data for testing
  // Register validator in ValidatorRegistry
  await validatorRegistry.registerValidator(
    validator.address,
    "Test Validator",
    "A validator for testing",
    [0, 1, 2, 3]
  );
  
  return {
    deedNFT,
    validatorRegistry,
    validator,
    fundManager,
    fractionalize,
    subdivide,
    metadataRenderer,
    deployer,
    admin,
    validator1,
    validator2,
    user1,
    user2
  };
}

// Helper to deploy a mock ERC20 token for testing
export async function deployMockToken(name: string, symbol: string, decimals: number = 18) {
  const MockToken = await ethers.getContractFactory("MockERC20");
  const mockToken = await MockToken.deploy(name, symbol, decimals);
  await mockToken.waitForDeployment();
  return mockToken;
} 