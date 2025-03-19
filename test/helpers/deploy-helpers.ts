import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { 
  DeedNFT, ValidatorRegistry, Validator, FundManager, 
  Fractionalize, Subdivide 
} from "../typechain";

export interface DeployedContracts {
  deedNFT: DeedNFT;
  validatorRegistry: ValidatorRegistry;
  validator: Validator;
  fundManager: FundManager;
  fractionalize: Fractionalize;
  subdivide: Subdivide;
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
  await validatorRegistry.deployed();
  
  // Deploy Validator
  const Validator = await ethers.getContractFactory("Validator");
  const validator = await upgrades.deployProxy(Validator, [ethers.constants.AddressZero]); // Temporary address
  await validator.deployed();
  
  // Deploy FundManager (with temporary addresses)
  const FundManager = await ethers.getContractFactory("FundManager");
  const fundManager = await upgrades.deployProxy(FundManager, [
    500,                      // _commissionPercentageRegular (5%)
    300,                      // _commissionPercentageValidator (3%)
    deployer.address,         // _feeReceiver
    validatorRegistry.address,
    ethers.constants.AddressZero  // Temporary DeedNFT address
  ]);
  await fundManager.deployed();
  
  // Deploy DeedNFT with actual addresses
  const DeedNFT = await ethers.getContractFactory("DeedNFT");
  const deedNFT = await upgrades.deployProxy(DeedNFT, [
    validator.address,
    validatorRegistry.address,
    fundManager.address
  ]);
  await deedNFT.deployed();
  
  // Update DeedNFT address in Validator
  await validator.initialize(deedNFT.address);
  
  // Update DeedNFT address in FundManager
  await fundManager.setDeedNFT(deedNFT.address);
  
  // Deploy extension contracts
  const Fractionalize = await ethers.getContractFactory("Fractionalize");
  const fractionalize = await upgrades.deployProxy(Fractionalize, [
    deedNFT.address,
    ethers.constants.AddressZero // Subdivision address not yet available
  ]);
  await fractionalize.deployed();
  
  const Subdivide = await ethers.getContractFactory("Subdivide");
  const subdivide = await upgrades.deployProxy(Subdivide, [
    deedNFT.address
  ]);
  await subdivide.deployed();
  
  // Update subdivision address in Fractionalize
  await fractionalize.updateSubdivideAddress(subdivide.address);
  
  // Setup mock data for testing
  // Register validator in ValidatorRegistry
  await validatorRegistry.registerValidator(
    validator.address,
    "Test Validator",
    "A validator for testing",
    [0, 1, 2, 3] // All asset types
  );
  
  return {
    validatorRegistry,
    validator,
    fundManager,
    deedNFT,
    fractionalize,
    subdivide,
    deployer,
    admin,
    validator1,
    validator2,
    user1,
    user2
  };
}

// Helper to deploy a mock ERC20 token for testing
export async function deployMockToken(name: string, symbol: string) {
  const MockToken = await ethers.getContractFactory("MockERC20");
  const mockToken = await MockToken.deploy(name, symbol);
  await mockToken.deployed();
  return mockToken;
} 