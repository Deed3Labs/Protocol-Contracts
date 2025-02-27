const { ethers, upgrades } = require("hardhat");

async function deployContracts() {
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
    ethers.constants.AddressZero, // Temporary DeedNFT address
    validatorRegistry.address
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
  await fundManager.setDeedNFTAddress(deedNFT.address);
  
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

module.exports = {
  deployContracts
}; 