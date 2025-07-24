import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { DeedNFT } from "../../typechain-types/contracts/core/DeedNFT";
import { Validator } from "../../typechain-types/contracts/core/Validator";
import { ValidatorRegistry } from "../../typechain-types/contracts/core/ValidatorRegistry";
import { AbiCoder } from "ethers";

describe("DeedNFT", function() {
  let deedNFT: DeedNFT;
  let validator: Validator;
  let validatorRegistry: ValidatorRegistry;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let validator1: SignerWithAddress;
  let validator2: SignerWithAddress;
  let nonAuthorized: SignerWithAddress;
  let mockERC20: any;

  const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const VALIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VALIDATOR_ROLE"));
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

  const ASSET_TYPE_KEY = ethers.keccak256(ethers.toUtf8Bytes("assetType"));
  const VALIDATOR_KEY = ethers.keccak256(ethers.toUtf8Bytes("validator"));
  const DEFINITION_KEY = ethers.keccak256(ethers.toUtf8Bytes("definition"));

  const abiCoder = new AbiCoder();

  beforeEach(async function() {
    const signers = await ethers.getSigners();
    [deployer, user1, user2, validator1, validator2, nonAuthorized] = signers;

    // Deploy ValidatorRegistry
    const ValidatorRegistry = await ethers.getContractFactory("ValidatorRegistry");
    validatorRegistry = await upgrades.deployProxy(ValidatorRegistry, []);
    await validatorRegistry.waitForDeployment();

    // Deploy Validator
    const Validator = await ethers.getContractFactory("Validator");
    validator = await upgrades.deployProxy(Validator, [
      "ipfs://metadata/",
      "ipfs://agreements/"
    ]);
    await validator.waitForDeployment();

    // Register validator in registry
    await validatorRegistry.registerValidator(
      await validator.getAddress(),
      "Test Validator",
      "A validator for testing",
      [0, 1, 2, 3]
    );
    // Explicitly activate validator after registration
    await validatorRegistry.updateValidatorStatus(await validator.getAddress(), true);

    // Set up validator's asset type support and criteria
    await validator.setupValidationCriteria(0); // Land
    await validator.setupValidationCriteria(1); // Vehicle
    await validator.setupValidationCriteria(2); // Estate
    await validator.setupValidationCriteria(3); // Equipment

    // Set up default operating agreement and its name
    await validator.setDefaultOperatingAgreement("ipfs://agreements/");
    await validator.setOperatingAgreementName("ipfs://agreements/", "Test Agreement");

    // Deploy DeedNFT
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    deedNFT = await upgrades.deployProxy(DeedNFT, [
      await validator.getAddress(),
      await validatorRegistry.getAddress()
    ]);
    await deedNFT.waitForDeployment();

    // Set up roles
    await deedNFT.grantRole(DEFAULT_ADMIN_ROLE, deployer.address);
    await deedNFT.grantRole(VALIDATOR_ROLE, deployer.address);
    await deedNFT.grantRole(MINTER_ROLE, deployer.address);

    // Mint initial deed for testing
    const definition = JSON.stringify({
      country: "USA",
      state: "California",
      county: "Los Angeles",
      parcelNumber: "12345",
      legalDescription: "Test legal description"
    });
    
    await deedNFT.mintAsset(
      user1.address,
      0, // AssetType.Land
      "ipfs://metadata1",
      definition,
      "configuration1",
      await validator.getAddress(),
      ethers.ZeroAddress, // token address (zero address for testing)
      0n // salt
    );

    // Deploy MockERC20 for payment testing
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockERC20 = await MockERC20.deploy("Test Token", "TT", 18);
    await mockERC20.waitForDeployment();
  });

  describe("Minting", function() {
    it("Should mint a new deed with correct parameters", async function() {
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      await expect(
        deedNFT.mintAsset(
          user1.address,
          0, // AssetType.Land
          "ipfs://metadata1",
          definition,
          "configuration1",
          await validator.getAddress(),
          ethers.ZeroAddress, // token address (zero address for testing)
          0n // salt
        )
      ).to.emit(deedNFT, "DeedNFTMinted")
        .withArgs(2, 0, deployer.address, await validator.getAddress());

      // Check ownership
      expect(await deedNFT.ownerOf(2)).to.equal(user1.address);

      // Check trait values
      const assetTypeBytes = await deedNFT.getTraitValue(2, ASSET_TYPE_KEY);
      const assetType = abiCoder.decode(["uint8"], assetTypeBytes)[0];
      expect(assetType).to.equal(0); // Land

      const validatorBytes = await deedNFT.getTraitValue(2, VALIDATOR_KEY);
      const validatorAddress = abiCoder.decode(["address"], validatorBytes)[0];
      expect(validatorAddress).to.equal(await validator.getAddress()); // Use actual validator address

      // Check definition trait
      const definitionBytes = await deedNFT.getTraitValue(2, DEFINITION_KEY);
      const storedDefinition = abiCoder.decode(["string"], definitionBytes)[0];
      expect(storedDefinition).to.equal(definition);
    });

    it("Should not mint a deed with invalid validator", async function() {
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      // Use a non-registered validator address
      const nonRegisteredValidator = ethers.Wallet.createRandom().address;

      await expect(
        deedNFT.mintAsset(
          user1.address,
          0, // AssetType.Land
          "ipfs://metadata1",
          definition,
          "configuration1",
          nonRegisteredValidator,
          ethers.ZeroAddress, // token address (zero address for testing)
          0n // salt
        )
      ).to.be.reverted;
    });

    it("Should not mint a deed with unsupported asset type", async function() {
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      // First, make sure the validator doesn't support this asset type
      await validator.setAssetTypeSupport(4, false);

      await expect(
        deedNFT.mintAsset(
          user1.address,
          4, // Invalid asset type
          "ipfs://metadata1",
          definition,
          "configuration1",
          await validator.getAddress(),
          ethers.ZeroAddress, // token address (zero address for testing)
          0n // salt
        )
      ).to.be.reverted;
    });

    it("Should mint a new deed with ERC20 payment", async function() {
      // Deploy and set up FundManager first
      const FundManager = await ethers.getContractFactory("FundManager");
      const fundManager = await upgrades.deployProxy(FundManager, [
        await validatorRegistry.getAddress(),
        1000, // 10% commission
        deployer.address // fee receiver
      ]);
      await fundManager.waitForDeployment();

      // Set up FundManager in DeedNFT
      await deedNFT.setFundManager(await fundManager.getAddress());
      await fundManager.addCompatibleDeedNFT(await deedNFT.getAddress());

      // Whitelist token and set service fee in validator
      await validator.addWhitelistedToken(await mockERC20.getAddress());
      await validator.setServiceFee(await mockERC20.getAddress(), ethers.parseUnits("100", 18));
      
      // Grant MINTER_ROLE to user1
      await deedNFT.grantRole(MINTER_ROLE, user1.address);
      
      // Mint tokens to user1
      await mockERC20.mint(user1.address, ethers.parseUnits("1000", 18));
      // Approve FundManager to spend tokens
      await mockERC20.connect(user1).approve(await fundManager.getAddress(), ethers.parseUnits("100", 18));

      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "54321"
      });

      await expect(
        deedNFT.connect(user1).mintAsset(
          user1.address,
          0, // AssetType.Land
          "ipfs://metadata2",
          definition,
          "configuration2",
          await validator.getAddress(),
          await mockERC20.getAddress(),
          1n // salt
        )
      ).to.emit(deedNFT, "DeedNFTMinted");
    });

    it("Should mint a deed without FundManager when no token is provided", async function() {
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      await expect(
        deedNFT.mintAsset(
          user1.address,
          0, // AssetType.Land
          "ipfs://metadata1",
          definition,
          "configuration1",
          await validator.getAddress(),
          ethers.ZeroAddress, // token address (zero address for testing)
          0n // salt
        )
      ).to.emit(deedNFT, "DeedNFTMinted")
        .withArgs(2, 0, deployer.address, await validator.getAddress());

      // Check ownership
      expect(await deedNFT.ownerOf(2)).to.equal(user1.address);
    });

    it("Should not mint a deed without FundManager when token is provided", async function() {
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      await expect(
        deedNFT.mintAsset(
          user1.address,
          0, // AssetType.Land
          "ipfs://metadata1",
          definition,
          "configuration1",
          await validator.getAddress(),
          await mockERC20.getAddress(), // token address
          0n // salt
        )
      ).to.be.reverted;
    });

    it("Should mint a deed with FundManager when token is provided", async function() {
      // Deploy and set up FundManager
      const FundManager = await ethers.getContractFactory("FundManager");
      const fundManager = await upgrades.deployProxy(FundManager, [
        await validatorRegistry.getAddress(),
        1000, // 10% commission
        deployer.address // fee receiver
      ]);
      await fundManager.waitForDeployment();

      // Set up FundManager in DeedNFT
      await deedNFT.setFundManager(await fundManager.getAddress());
      await fundManager.addCompatibleDeedNFT(await deedNFT.getAddress());

      // Whitelist token and set service fee in validator
      await validator.addWhitelistedToken(await mockERC20.getAddress());
      await validator.setServiceFee(await mockERC20.getAddress(), ethers.parseUnits("100", 18));

      // Grant MINTER_ROLE to user1
      await deedNFT.grantRole(MINTER_ROLE, user1.address);

      // Mint tokens to user1 and approve FundManager
      await mockERC20.mint(user1.address, ethers.parseUnits("1000", 18));
      await mockERC20.connect(user1).approve(await fundManager.getAddress(), ethers.parseUnits("100", 18));

      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      await expect(
        deedNFT.connect(user1).mintAsset(
          user1.address,
          0, // AssetType.Land
          "ipfs://metadata1",
          definition,
          "configuration1",
          await validator.getAddress(),
          await mockERC20.getAddress(), // token address
          0n // salt
        )
      ).to.emit(deedNFT, "DeedNFTMinted")
        .withArgs(2, 0, user1.address, await validator.getAddress());

      // Check ownership
      expect(await deedNFT.ownerOf(2)).to.equal(user1.address);

      // Check FundManager balances
      const validatorBalance = await fundManager.getValidatorFeeBalance(
        await validator.getAddress(),
        await mockERC20.getAddress()
      );
      expect(validatorBalance).to.equal(ethers.parseUnits("90", 18)); // 90% of service fee
    });

    it("Should not mint a deed with FundManager when no token is provided", async function() {
      // Deploy and set up FundManager
      const FundManager = await ethers.getContractFactory("FundManager");
      const fundManager = await upgrades.deployProxy(FundManager, [
        await validatorRegistry.getAddress(),
        1000, // 10% commission
        deployer.address // fee receiver
      ]);
      await fundManager.waitForDeployment();

      // Set up FundManager in DeedNFT
      await deedNFT.setFundManager(await fundManager.getAddress());
      await fundManager.addCompatibleDeedNFT(await deedNFT.getAddress());

      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      await expect(
        deedNFT.mintAsset(
          user1.address,
          0, // AssetType.Land
          "ipfs://metadata1",
          definition,
          "configuration1",
          await validator.getAddress(),
          ethers.ZeroAddress, // token address (zero address for testing)
          0n // salt
        )
      ).to.be.reverted;
    });
  });

  describe("Burning", function() {
    it("Should burn a deed", async function() {
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      // Mint a deed
      await deedNFT.mintAsset(
        user1.address,
        0, // AssetType.Land
        "ipfs://metadata1",
        definition,
        "configuration1",
        await validator.getAddress(),
        ethers.ZeroAddress, // token address (zero address for testing)
        0n // salt
      );

      // Burn the deed
      await expect(deedNFT.connect(user1).burnAsset(2))
        .to.emit(deedNFT, "DeedNFTBurned")
        .withArgs(2);
    });

    it("Should not burn a non-existent deed", async function() {
      await expect(deedNFT.burnAsset(999))
        .to.be.reverted;
    });
  });

  describe("Metadata Management", function() {
    it("Should update metadata correctly", async function() {
      const newUri = "ipfs://newmetadata";
      const defaultUri = await validator.defaultOperatingAgreement();
      const newOperatingAgreement = defaultUri; // Use the same URI that was set up
      const newDefinition = JSON.stringify({
        country: "USA",
        state: "Texas",
        county: "Harris",
        parcelNumber: "67890",
        legalDescription: "Updated legal description"
      });
      const newConfiguration = "newConfiguration";

      await deedNFT.updateMetadata(
        1,
        newUri,
        newOperatingAgreement,
        newDefinition,
        newConfiguration
      );

      // Check updated values
      const definitionBytes = await deedNFT.getTraitValue(1, DEFINITION_KEY);
      const storedDefinition = abiCoder.decode(["string"], definitionBytes)[0];
      expect(storedDefinition).to.equal(newDefinition);

      expect(await deedNFT.tokenURI(1)).to.equal(newUri);
    });

    it("Should not update metadata with empty operating agreement", async function() {
      await expect(
        deedNFT.updateMetadata(
          1,
          "ipfs://newmetadata",
          "", // empty operating agreement
          "new definition",
          "new configuration"
        )
      ).to.be.reverted;
    });
  });

  describe("Trait Management", function() {
    it("Should set and get trait values correctly", async function() {
      const traitKey = ethers.keccak256(ethers.toUtf8Bytes("customTrait"));
      const traitValue = ethers.toUtf8Bytes("customValue");

      await deedNFT.setTrait(1, traitKey, traitValue, 0);

      const storedValue = await deedNFT.getTraitValue(1, traitKey);
      expect(storedValue).to.equal(ethers.hexlify(traitValue));
    });

    it("Should remove traits correctly", async function() {
      const traitName = "customTrait";
      const traitKey = ethers.keccak256(ethers.toUtf8Bytes(traitName));
      const traitValue = ethers.toUtf8Bytes("customValue");

      // First set the trait
      await deedNFT.setTrait(1, traitKey, traitValue, 0);

      // Then remove it
      await deedNFT.removeTrait(1, traitName);

      const storedValue = await deedNFT.getTraitValue(1, traitKey);
      expect(storedValue).to.equal("0x");
    });
  });

  describe("Royalty Management", function() {
    it("Should set and enforce royalties correctly", async function() {
      // Set marketplace approval
      await deedNFT.setApprovedMarketplace(user2.address, true);
      expect(await deedNFT.isApprovedMarketplace(user2.address)).to.be.true;

      // Enable royalty enforcement
      await deedNFT.setRoyaltyEnforcement(true);
      expect(await deedNFT.isRoyaltyEnforced()).to.be.true;

      // Should allow approval for approved marketplace
      await deedNFT.connect(user1).approve(user2.address, 1);

      // Should not allow approval for non-approved marketplace
      await expect(
        deedNFT.connect(user1).approve(nonAuthorized.address, 1)
      ).to.be.reverted;
    });

    it("Should calculate royalties correctly", async function() {
      const salePrice = ethers.parseEther("1");
      const [receiver, amount] = await deedNFT.royaltyInfo(1, salePrice);
      
      // Verify receiver and amount based on validator settings
      expect(receiver).to.not.equal(ethers.ZeroAddress);
      expect(amount).to.be.gt(0);
    });
  });

  describe("Contract Management", function() {
    it("Should set contract URI correctly", async function() {
      const newUri = "ipfs://collection-metadata";
      await deedNFT.setContractURI(newUri);
      expect(await deedNFT.contractURI()).to.equal(newUri);
    });

    it("Should handle pausing correctly", async function() {
      await deedNFT.pause();
      expect(await deedNFT.paused()).to.be.true;

      // Should not allow minting while paused
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });

      await expect(
        deedNFT.mintAsset(
          user1.address,
          0,
          "ipfs://metadata1",
          definition,
          "configuration1",
          await validator.getAddress(),
          ethers.ZeroAddress, // token address (zero address for testing)
          0n
        )
      ).to.be.reverted;

      await deedNFT.unpause();
      expect(await deedNFT.paused()).to.be.false;
    });
  });

  describe("Role Management", function() {
    it("Should add and remove minter correctly", async function() {
      await deedNFT.addMinter(user2.address);
      expect(await deedNFT.hasRole(MINTER_ROLE, user2.address)).to.be.true;
      
      await deedNFT.removeMinter(user2.address);
      expect(await deedNFT.hasRole(MINTER_ROLE, user2.address)).to.be.false;
    });

    it("Should not allow non-admin to add/remove minter", async function() {
      await expect(deedNFT.connect(user1).addMinter(user2.address))
        .to.be.reverted;
      await expect(deedNFT.connect(user1).removeMinter(user2.address))
        .to.be.reverted;
    });
  });

  describe("Validator Management", function() {
    it("Should set default validator correctly", async function() {
      // Deploy a Validator contract for validator2
      const Validator = await ethers.getContractFactory("Validator");
      const validator2Contract = await upgrades.deployProxy(Validator, [
        "ipfs://metadata2/",
        "ipfs://agreements2/"
      ]);
      await validator2Contract.waitForDeployment();
      // Register validator2Contract in the registry
      await validatorRegistry.registerValidator(
        await validator2Contract.getAddress(),
        "Test Validator 2",
        "A second validator for testing",
        [0, 1, 2, 3]
      );
      // Explicitly activate validator2Contract after registration
      await validatorRegistry.updateValidatorStatus(await validator2Contract.getAddress(), true);
      // Set up validator2Contract's asset type support and criteria
      await validator2Contract.setupValidationCriteria(0); // Land
      await validator2Contract.setupValidationCriteria(1); // Vehicle
      await validator2Contract.setupValidationCriteria(2); // Estate
      await validator2Contract.setupValidationCriteria(3); // Equipment
      // Set up default operating agreement and its name for validator2Contract
      await validator2Contract.setDefaultOperatingAgreement("ipfs://agreements2/");
      await validator2Contract.setOperatingAgreementName("ipfs://agreements2/", "Test Agreement 2");
      
      await deedNFT.setDefaultValidator(await validator2Contract.getAddress());
      
      // Since defaultValidator is private, we'll verify it through minting
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });
      
      await deedNFT.mintAsset(
        user1.address,
        0,
        "ipfs://metadata1",
        definition,
        "configuration1",
        ethers.ZeroAddress, // Use zero address to test default validator
        ethers.ZeroAddress, // token address (zero address for testing)
        0n
      );
      
      const validatorBytes = await deedNFT.getTraitValue(2, VALIDATOR_KEY);
      const validatorAddress = abiCoder.decode(["address"], validatorBytes)[0];
      expect(validatorAddress).to.equal(await validator2Contract.getAddress());
    });

    it("Should not allow setting invalid validator", async function() {
      const nonRegisteredValidator = ethers.Wallet.createRandom().address;
      await expect(deedNFT.setDefaultValidator(nonRegisteredValidator))
        .to.be.reverted;
    });

    it("Should set validator registry correctly", async function() {
      const newRegistry = await ethers.deployContract("ValidatorRegistry");
      await deedNFT.setValidatorRegistry(await newRegistry.getAddress());
      // Since validatorRegistry is private, we'll verify it through minting
      const definition = JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345"
      });
      
      await expect(
        deedNFT.mintAsset(
          user1.address,
          0,
          "ipfs://metadata1",
          definition,
          "configuration1",
          await validator.getAddress(),
          ethers.ZeroAddress, // token address (zero address for testing)
          0n
        )
      ).to.be.reverted; // Should revert because validator is not registered in new registry
    });
  });

  describe("Metadata Renderer", function() {
    it("Should set metadata renderer correctly", async function() {
      const newRenderer = await ethers.deployContract("MetadataRenderer");
      await deedNFT.setMetadataRenderer(await newRenderer.getAddress());
      expect(await deedNFT.metadataRenderer()).to.equal(await newRenderer.getAddress());
    });

    it("Should revoke old renderer's role when setting new one", async function() {
      const oldRenderer = await ethers.deployContract("MetadataRenderer");
      const newRenderer = await ethers.deployContract("MetadataRenderer");
      
      await deedNFT.setMetadataRenderer(await oldRenderer.getAddress());
      await deedNFT.setMetadataRenderer(await newRenderer.getAddress());
      
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, await oldRenderer.getAddress())).to.be.false;
      expect(await deedNFT.hasRole(VALIDATOR_ROLE, await newRenderer.getAddress())).to.be.true;
    });
  });

  describe("Advanced Trait Management", function() {
    it("Should handle different trait value types correctly", async function() {
      // Test string type
      await deedNFT.setTrait(1, ethers.toUtf8Bytes("stringTrait"), ethers.toUtf8Bytes("value"), 1);
      
      // Test numeric type
      await deedNFT.setTrait(1, ethers.toUtf8Bytes("numberTrait"), ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [42]), 2);
      
      // Test boolean type
      await deedNFT.setTrait(1, ethers.toUtf8Bytes("boolTrait"), ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [true]), 3);
      
      // Verify values
      const stringValue = await deedNFT.getTraitValue(1, ethers.keccak256(ethers.toUtf8Bytes("stringTrait")));
      const numberValue = await deedNFT.getTraitValue(1, ethers.keccak256(ethers.toUtf8Bytes("numberTrait")));
      const boolValue = await deedNFT.getTraitValue(1, ethers.keccak256(ethers.toUtf8Bytes("boolTrait")));
      
      expect(ethers.AbiCoder.defaultAbiCoder().decode(["string"], stringValue)[0]).to.equal("value");
      expect(ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], numberValue)[0]).to.equal(42n);
      expect(ethers.AbiCoder.defaultAbiCoder().decode(["bool"], boolValue)[0]).to.be.true;
    });

    it("Should get multiple trait values correctly", async function() {
      const traitKeys = [
        ethers.keccak256(ethers.toUtf8Bytes("trait1")),
        ethers.keccak256(ethers.toUtf8Bytes("trait2"))
      ];
      
      await deedNFT.setTrait(1, ethers.toUtf8Bytes("trait1"), ethers.toUtf8Bytes("value1"), 1);
      await deedNFT.setTrait(1, ethers.toUtf8Bytes("trait2"), ethers.toUtf8Bytes("value2"), 1);
      
      const values = await deedNFT.getTraitValues(1, traitKeys);
      expect(values.length).to.equal(2);
      expect(ethers.AbiCoder.defaultAbiCoder().decode(["string"], values[0])[0]).to.equal("value1");
      expect(ethers.AbiCoder.defaultAbiCoder().decode(["string"], values[1])[0]).to.equal("value2");
    });
  });

  describe("Fund Manager Integration", function() {
    it("Should set fund manager correctly", async function() {
      const fundManager = await ethers.deployContract("FundManager");
      await deedNFT.setFundManager(await fundManager.getAddress());
      expect(await deedNFT.fundManager()).to.equal(await fundManager.getAddress());
    });

    it("Should calculate royalties with fund manager commission", async function() {
      const fundManager = await ethers.deployContract("FundManager");
      await deedNFT.setFundManager(await fundManager.getAddress());
      
      const salePrice = ethers.parseEther("1");
      const [receiver, amount] = await deedNFT.royaltyInfo(1, salePrice);
      
      // Verify commission is taken from royalty amount
      expect(amount).to.be.lt(salePrice);
    });
  });

  describe("Transfer Validation", function() {
    it("Should set transfer validator correctly", async function() {
      // Use the existing validator contract instead of a non-existent TransferValidator
      await deedNFT.setTransferValidator(await validator.getAddress());
      expect(await deedNFT.getTransferValidator()).to.equal(await validator.getAddress());
    });

    it("Should get transfer validation function correctly", async function() {
      const [functionSignature, isViewFunction] = await deedNFT.getTransferValidationFunction();
      expect(functionSignature).to.equal(ethers.id("validateTransfer(address,address,address,uint256)").slice(0, 10));
      expect(isViewFunction).to.be.true;
    });
  });

  describe("Token URI", function() {
    it("Should fall back to standard URI when renderer fails", async function() {
      // Use the existing validator contract as an invalid renderer
      await deedNFT.setMetadataRenderer(await validator.getAddress());
      
      // Should still return the standard URI
      expect(await deedNFT.tokenURI(1)).to.equal("ipfs://metadata1");
    });

    it("Should use metadata renderer when available", async function() {
      const renderer = await ethers.deployContract("MetadataRenderer");
      await deedNFT.setMetadataRenderer(await renderer.getAddress());
      
      // Since setTokenURI doesn't exist, we'll test the renderer's tokenURI directly
      const tokenURI = await deedNFT.tokenURI(1);
      expect(tokenURI).to.not.be.empty;
    });
  });

  describe("Marketplace and Royalty Integration", function() {
    let mockMarketplace: any;

    beforeEach(async function() {
      // Deploy MockMarketplace
      const MockMarketplace = await ethers.getContractFactory("MockMarketplace");
      mockMarketplace = await MockMarketplace.deploy();
      await mockMarketplace.waitForDeployment();

      // Set up royalty fee percentage and receiver in validator
      await validator.connect(deployer).setRoyaltyFeePercentage(500); // 5%
      await validator.connect(deployer).setRoyaltyReceiver(user1.address);

      // Approve marketplace in DeedNFT
      await deedNFT.setApprovedMarketplace(await mockMarketplace.getAddress(), true);
    });

    it("should enforce royalties through approved marketplace", async function() {
      // Mint tokens to user2 for payment
      await mockERC20.mint(user2.address, ethers.parseUnits("1000", 18));
      await mockERC20.connect(user2).approve(await mockMarketplace.getAddress(), ethers.parseUnits("1000", 18));

      // List NFT on marketplace
      await deedNFT.connect(user1).approve(await mockMarketplace.getAddress(), 1);
      await mockMarketplace.connect(user1).listNFT(
        await deedNFT.getAddress(),
        1,
        await mockERC20.getAddress(),
        ethers.parseUnits("100", 18)
      );

      // Get initial balances
      const validatorBalanceBefore = await mockERC20.balanceOf(await validator.getAddress());
      const sellerBalanceBefore = await mockERC20.balanceOf(user1.address);

      // Buy NFT through marketplace
      await mockMarketplace.connect(user2).buyNFT(
        await deedNFT.getAddress(),
        1
      );

      // Check balances after sale
      const validatorBalanceAfter = await mockERC20.balanceOf(await validator.getAddress());
      const sellerBalanceAfter = await mockERC20.balanceOf(user1.address);

      // Verify royalty payment (5% of 100 tokens = 5 tokens)
      expect(validatorBalanceAfter - validatorBalanceBefore).to.equal(ethers.parseUnits("5", 18));
      // Verify seller received remaining amount (95 tokens)
      expect(sellerBalanceAfter - sellerBalanceBefore).to.equal(ethers.parseUnits("95", 18));
    });

    it("should prevent transfers through non-approved marketplace when royalties are enforced", async function() {
      // Deploy another marketplace that's not approved
      const MockMarketplace = await ethers.getContractFactory("MockMarketplace");
      const unapprovedMarketplace = await MockMarketplace.deploy();
      await unapprovedMarketplace.waitForDeployment();

      // Try to approve unapproved marketplace
      await expect(
        deedNFT.connect(user1).approve(await unapprovedMarketplace.getAddress(), 1)
      ).to.be.reverted;

      // Try to set approval for all
      await expect(
        deedNFT.connect(user1).setApprovalForAll(await unapprovedMarketplace.getAddress(), true)
      ).to.be.reverted;
    });

    it("should allow transfers through approved marketplace even when royalties are enforced", async function() {
      // Approve marketplace
      await deedNFT.connect(user1).approve(await mockMarketplace.getAddress(), 1);
      
      // List NFT on marketplace
      await mockMarketplace.connect(user1).listNFT(
        await deedNFT.getAddress(),
        1,
        await mockERC20.getAddress(),
        ethers.parseUnits("100", 18)
      );

      // Verify listing was successful
      const listing = await mockMarketplace.getListing(await deedNFT.getAddress(), 1);
      expect(listing.isActive).to.be.true;
      expect(listing.seller).to.equal(user1.address);
    });

    it("should calculate royalties correctly", async function() {
      const salePrice = ethers.parseUnits("100", 18);
      const [receiver, amount] = await deedNFT.royaltyInfo(1, salePrice);
      
      // Verify receiver is the validator
      expect(receiver).to.equal(await validator.getAddress());
      // Verify amount is 5% of sale price
      expect(amount).to.equal(ethers.parseUnits("5", 18));
    });

    it("should handle marketplace approval changes correctly", async function() {
      // Initially approved
      expect(await deedNFT.isApprovedMarketplace(await mockMarketplace.getAddress())).to.be.true;

      // Revoke approval
      await deedNFT.setApprovedMarketplace(await mockMarketplace.getAddress(), false);
      expect(await deedNFT.isApprovedMarketplace(await mockMarketplace.getAddress())).to.be.false;

      // Try to approve marketplace after revocation
      await expect(
        deedNFT.connect(user1).approve(await mockMarketplace.getAddress(), 1)
      ).to.be.reverted;
    });

    it("should handle royalty enforcement changes correctly", async function() {
      // Initially enforced
      expect(await deedNFT.isRoyaltyEnforced()).to.be.true;

      // Disable enforcement
      await deedNFT.setRoyaltyEnforcement(false);
      expect(await deedNFT.isRoyaltyEnforced()).to.be.false;

      // Should now allow approval of non-approved marketplace
      const MockMarketplace = await ethers.getContractFactory("MockMarketplace");
      const unapprovedMarketplace = await MockMarketplace.deploy();
      await unapprovedMarketplace.waitForDeployment();

      await deedNFT.connect(user1).approve(await unapprovedMarketplace.getAddress(), 1);
      expect(await deedNFT.getApproved(1)).to.equal(await unapprovedMarketplace.getAddress());
    });
  });
});