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
      "Test Validator"
    );

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
      0n // salt
    );
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
          0n
        )
      ).to.be.reverted;

      await deedNFT.unpause();
      expect(await deedNFT.paused()).to.be.false;
    });
  });
});