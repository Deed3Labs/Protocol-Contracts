import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { MetadataRenderer } from "../../typechain-types/contracts/core/MetadataRenderer";
import { DeedNFT } from "../../typechain-types/contracts/core/DeedNFT";
import { Validator } from "../../typechain-types/contracts/core/Validator";
import { ValidatorRegistry } from "../../typechain-types/contracts/core/ValidatorRegistry";

describe("MetadataRenderer", function() {
  let metadataRenderer: MetadataRenderer;
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
  const METADATA_ROLE = ethers.keccak256(ethers.toUtf8Bytes("METADATA_ROLE"));
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  
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

    // Set up validator's asset type support
    await validator.setAssetTypeSupport(0, true); // Land
    await validator.setAssetTypeSupport(1, true); // Vehicle
    await validator.setAssetTypeSupport(2, true); // Estate
    await validator.setAssetTypeSupport(3, true); // Equipment
    
    // Deploy DeedNFT
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    deedNFT = await upgrades.deployProxy(DeedNFT, [
      await validator.getAddress(),
      await validatorRegistry.getAddress()
    ]);
    await deedNFT.waitForDeployment();
    
    // Deploy MetadataRenderer
    const MetadataRenderer = await ethers.getContractFactory("MetadataRenderer");
    metadataRenderer = await upgrades.deployProxy(MetadataRenderer, []);
    await metadataRenderer.waitForDeployment();
    
    // Set up roles
    await metadataRenderer.grantRole(DEFAULT_ADMIN_ROLE, deployer.address);
    await metadataRenderer.grantRole(METADATA_ROLE, deployer.address);
    await metadataRenderer.grantRole(VALIDATOR_ROLE, deployer.address);

    await deedNFT.grantRole(DEFAULT_ADMIN_ROLE, deployer.address);
    await deedNFT.grantRole(VALIDATOR_ROLE, deployer.address);
    await deedNFT.grantRole(MINTER_ROLE, deployer.address);

    // Set MetadataRenderer in DeedNFT
    await deedNFT.setMetadataRenderer(await metadataRenderer.getAddress());
    
    // Set DeedNFT in MetadataRenderer
    await metadataRenderer.setDeedNFT(await deedNFT.getAddress());
    
    // Mint tokens for testing
    // Token 1: Land with full address
    await deedNFT.mintAsset(
      user1.address, 
      0, // AssetType.Land
      "ipfs://metadata1",
      JSON.stringify({
        country: "USA",
        state: "California",
        county: "Los Angeles",
        parcelNumber: "12345",
        zipCode: "90210"
      }),
      "configuration1",
      await validator.getAddress(),
      0n // salt
    );
    
    // Set up traits for Token 1
    await deedNFT.setTrait(
      1,
      ethers.toUtf8Bytes("assetType"),
      ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [0]),
      0 // bytes type
    );
    await deedNFT.setTrait(
      1,
      ethers.toUtf8Bytes("streetNumber"),
      ethers.toUtf8Bytes("123"),
      1 // string type
    );
    await deedNFT.setTrait(
      1,
      ethers.toUtf8Bytes("streetName"),
      ethers.toUtf8Bytes("Main St"),
      1 // string type
    );
    await deedNFT.setTrait(
      1,
      ethers.toUtf8Bytes("state"),
      ethers.toUtf8Bytes("California"),
      1 // string type
    );
    await deedNFT.setTrait(
      1,
      ethers.toUtf8Bytes("country"),
      ethers.toUtf8Bytes("USA"),
      1 // string type
    );
    await deedNFT.setTrait(
      1,
      ethers.toUtf8Bytes("zipCode"),
      ethers.toUtf8Bytes("90210"),
      1 // string type
    );

    // Token 2: Land with only parcel number and state
    await deedNFT.mintAsset(
      user1.address, 
      0, // AssetType.Land
      "ipfs://metadata2",
      JSON.stringify({
        parcelNumber: "P12345",
        state: "California"
      }),
      "configuration2",
      await validator.getAddress(),
      0n
    );

    // Set up traits for Token 2
    await deedNFT.setTrait(
      2,
      ethers.toUtf8Bytes("assetType"),
      ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [0]),
      0 // bytes type
    );
    await deedNFT.setTrait(
      2,
      ethers.toUtf8Bytes("parcelNumber"),
      ethers.toUtf8Bytes("P12345"),
      1 // string type
    );
    await deedNFT.setTrait(
      2,
      ethers.toUtf8Bytes("state"),
      ethers.toUtf8Bytes("California"),
      1 // string type
    );

    // Token 3: Estate with full address
    await deedNFT.mintAsset(
      user1.address,
      2, // AssetType.Estate
      "ipfs://metadata3",
      JSON.stringify({
        streetNumber: "456",
        streetName: "Oak Ave",
        state: "New York",
        country: "USA",
        zipCode: "10001"
      }),
      "configuration3",
      await validator.getAddress(),
      0n
    );

    // Set up traits for Token 3
    await deedNFT.setTrait(
      3,
      ethers.toUtf8Bytes("assetType"),
      ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [2]),
      0 // bytes type
    );
    await deedNFT.setTrait(
      3,
      ethers.toUtf8Bytes("streetNumber"),
      ethers.toUtf8Bytes("456"),
      1 // string type
    );
    await deedNFT.setTrait(
      3,
      ethers.toUtf8Bytes("streetName"),
      ethers.toUtf8Bytes("Oak Ave"),
      1 // string type
    );
    await deedNFT.setTrait(
      3,
      ethers.toUtf8Bytes("state"),
      ethers.toUtf8Bytes("New York"),
      1 // string type
    );
    await deedNFT.setTrait(
      3,
      ethers.toUtf8Bytes("country"),
      ethers.toUtf8Bytes("USA"),
      1 // string type
    );
    await deedNFT.setTrait(
      3,
      ethers.toUtf8Bytes("zipCode"),
      ethers.toUtf8Bytes("10001"),
      1 // string type
    );

    // Token 4: Equipment with full details
    await deedNFT.mintAsset(
      user1.address,
      3, // AssetType.Equipment
      "ipfs://metadata4",
      JSON.stringify({
        equipmentType: "Excavator",
        manufacturer: "Caterpillar",
        model: "320D2",
        serialNumber: "SN123456"
      }),
      "configuration4",
      await validator.getAddress(),
      0n
    );

    // Set up traits for Token 4
    await deedNFT.setTrait(
      4,
      ethers.toUtf8Bytes("assetType"),
      ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [3]),
      0 // bytes type
    );
    await deedNFT.setTrait(
      4,
      ethers.toUtf8Bytes("equipmentType"),
      ethers.toUtf8Bytes("Excavator"),
      1 // string type
    );
    await deedNFT.setTrait(
      4,
      ethers.toUtf8Bytes("manufacturer"),
      ethers.toUtf8Bytes("Caterpillar"),
      1 // string type
    );
    await deedNFT.setTrait(
      4,
      ethers.toUtf8Bytes("model"),
      ethers.toUtf8Bytes("320D2"),
      1 // string type
    );
    await deedNFT.setTrait(
      4,
      ethers.toUtf8Bytes("serialNumber"),
      ethers.toUtf8Bytes("SN123456"),
      1 // string type
    );

    // Token 5: Equipment with manufacturer and model only
    await deedNFT.mintAsset(
      user1.address,
      3, // AssetType.Equipment
      "ipfs://metadata5",
      JSON.stringify({
        manufacturer: "Honda",
        model: "EU3000i"
      }),
      "configuration5",
      await validator.getAddress(),
      0n
    );

    // Set up traits for Token 5
    await deedNFT.setTrait(
      5,
      ethers.toUtf8Bytes("assetType"),
      ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [3]),
      0 // bytes type
    );
    await deedNFT.setTrait(
      5,
      ethers.toUtf8Bytes("manufacturer"),
      ethers.toUtf8Bytes("Honda"),
      1 // string type
    );
    await deedNFT.setTrait(
      5,
      ethers.toUtf8Bytes("model"),
      ethers.toUtf8Bytes("EU3000i"),
      1 // string type
    );

    // Token 6: Land with no traits
    await deedNFT.mintAsset(
      user1.address,
      0, // AssetType.Land
      "ipfs://metadata6",
      "{}",
      "configuration6",
      await validator.getAddress(),
      0n
    );

    // Set up only asset type for Token 6
    await deedNFT.setTrait(
      6,
      ethers.toUtf8Bytes("assetType"),
      ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [0]),
      0 // bytes type
    );

    // Token 6: Vehicle with full details
    await deedNFT.mintAsset(
      user1.address,
      1, // AssetType.Vehicle
      "ipfs://metadata6",
      JSON.stringify({
        make: "Tesla",
        model: "Model S",
        year: "2024",
        vin: "12345"
      }),
      "configuration6",
      await validator.getAddress(),
      0n
    );

    // Set up traits for Token 6
    await deedNFT.setTrait(
      6,
      ethers.toUtf8Bytes("assetType"),
      ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [1]),
      0 // bytes type
    );
    await deedNFT.setTrait(
      6,
      ethers.toUtf8Bytes("year"),
      ethers.toUtf8Bytes("2024"),
      1 // string type
    );
    await deedNFT.setTrait(
      6,
      ethers.toUtf8Bytes("make"),
      ethers.toUtf8Bytes("Tesla"),
      1 // string type
    );
    await deedNFT.setTrait(
      6,
      ethers.toUtf8Bytes("model"),
      ethers.toUtf8Bytes("Model S"),
      1 // string type
    );

    // Token 7: Vehicle with make and model only
    await deedNFT.mintAsset(
      user1.address,
      1, // AssetType.Vehicle
      "ipfs://metadata7",
      JSON.stringify({
        make: "Toyota",
        model: "Camry"
      }),
      "configuration7",
      await validator.getAddress(),
      0n
    );

    // Set up traits for Token 7
    await deedNFT.setTrait(
      7,
      ethers.toUtf8Bytes("assetType"),
      ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [1]),
      0 // bytes type
    );
    await deedNFT.setTrait(
      7,
      ethers.toUtf8Bytes("make"),
      ethers.toUtf8Bytes("Toyota"),
      1 // string type
    );
    await deedNFT.setTrait(
      7,
      ethers.toUtf8Bytes("model"),
      ethers.toUtf8Bytes("Camry"),
      1 // string type
    );

    // Token 8: Vehicle with only make
    await deedNFT.mintAsset(
      user1.address,
      1, // AssetType.Vehicle
      "ipfs://metadata8",
      JSON.stringify({
        make: "Honda"
      }),
      "configuration8",
      await validator.getAddress(),
      0n
    );

    // Set up traits for Token 8
    await deedNFT.setTrait(
      8,
      ethers.toUtf8Bytes("assetType"),
      ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [1]),
      0 // bytes type
    );
    await deedNFT.setTrait(
      8,
      ethers.toUtf8Bytes("make"),
      ethers.toUtf8Bytes("Honda"),
      1 // string type
    );

    // Wait for trait sync
    await new Promise(resolve => setTimeout(resolve, 1000));
  });
  
  describe("Initialization", function() {
    it("should initialize with correct default images", async function() {
      expect(await metadataRenderer.defaultImageURIs(0)).to.equal("ipfs://Qm1"); // Land
      expect(await metadataRenderer.defaultImageURIs(1)).to.equal("ipfs://Qm2"); // Vehicle
      expect(await metadataRenderer.defaultImageURIs(2)).to.equal("ipfs://Qm1"); // Estate (same as Land)
      expect(await metadataRenderer.defaultImageURIs(3)).to.equal("ipfs://Qm3"); // Equipment
      expect(await metadataRenderer.defaultImageURIs(255)).to.equal("ipfs://Qm"); // Invalidated
    });
    
    it("should set up roles correctly", async function() {
      expect(await metadataRenderer.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true;
      expect(await metadataRenderer.hasRole(METADATA_ROLE, deployer.address)).to.be.true;
      expect(await metadataRenderer.hasRole(VALIDATOR_ROLE, deployer.address)).to.be.true;
    });
  });

  describe("Document Management Functions", function() {
    it("should add and remove token documents", async function() {
      const tokenId = 1;
      const docType = "deed";
      const docUri = "ipfs://QmDeedDocument";

      // Add document
      await expect(
        metadataRenderer.manageTokenDocument(tokenId, docType, docUri, false)
      ).to.emit(metadataRenderer, "TokenMetadataUpdated")
        .withArgs(tokenId);

      // Verify document was added
      expect(await metadataRenderer.getTokenDocument(tokenId, docType)).to.equal(docUri);
      
      // Verify document type was added to list
      const docTypes = await metadataRenderer.getTokenDocumentTypes(tokenId);
      expect(docTypes).to.include(docType);

      // Verify document was added to documents array
      const documents = await metadataRenderer.getTokenDocuments(tokenId);
      expect(documents.length).to.equal(1);
      expect(documents[0].docType).to.equal(docType);
      expect(documents[0].documentURI).to.equal(docUri);

      // Remove document
      await expect(
        metadataRenderer.manageTokenDocument(tokenId, docType, "", true)
      ).to.emit(metadataRenderer, "TokenMetadataUpdated")
        .withArgs(tokenId);

      // Verify document was removed
      expect(await metadataRenderer.getTokenDocument(tokenId, docType)).to.equal("");
      
      // Verify document type was removed from list
      const updatedDocTypes = await metadataRenderer.getTokenDocumentTypes(tokenId);
      expect(updatedDocTypes).to.not.include(docType);

      // Verify document was removed from documents array
      const updatedDocuments = await metadataRenderer.getTokenDocuments(tokenId);
      expect(updatedDocuments.length).to.equal(0);
    });

    it("should not allow empty document type when adding", async function() {
      const tokenId = 1;
      const documentURI = "ipfs://QmDeedDocument";

      await expect(
        metadataRenderer.manageTokenDocument(tokenId, "", documentURI, false)
      ).to.be.revertedWithCustomError(metadataRenderer, "Empty");
    });

    it("should handle multiple document types", async function() {
      const tokenId = 1;
      const documents = [
        { type: "deed", uri: "ipfs://QmDeedDocument" },
        { type: "survey", uri: "ipfs://QmSurveyDocument" }
      ];

      // Add multiple documents
      for (const doc of documents) {
        await metadataRenderer.manageTokenDocument(tokenId, doc.type, doc.uri, false);
      }

      // Verify all documents were added
      const documentTypes = await metadataRenderer.getTokenDocumentTypes(tokenId);
      expect(documentTypes).to.have.lengthOf(2);
      expect(documentTypes).to.include(documents[0].type);
      expect(documentTypes).to.include(documents[1].type);

      // Verify each document's URI
      for (const doc of documents) {
        expect(await metadataRenderer.getTokenDocument(tokenId, doc.type)).to.equal(doc.uri);
      }

      // Verify all documents in documents array
      const storedDocuments = await metadataRenderer.getTokenDocuments(tokenId);
      expect(storedDocuments.length).to.equal(2);
      expect(storedDocuments[0].docType).to.equal(documents[0].type);
      expect(storedDocuments[0].documentURI).to.equal(documents[0].uri);
      expect(storedDocuments[1].docType).to.equal(documents[1].type);
      expect(storedDocuments[1].documentURI).to.equal(documents[1].uri);
    });

    it("should update existing document", async function() {
      const tokenId = 1;
      const docType = "deed";
      const initialUri = "ipfs://QmInitialDocument";
      const updatedUri = "ipfs://QmUpdatedDocument";

      // Add initial document
      await metadataRenderer.manageTokenDocument(tokenId, docType, initialUri, false);
      
      // Update document
      await metadataRenderer.manageTokenDocument(tokenId, docType, updatedUri, false);

      // Verify document was updated
      expect(await metadataRenderer.getTokenDocument(tokenId, docType)).to.equal(updatedUri);
      
      // Verify only one document exists
      const documents = await metadataRenderer.getTokenDocuments(tokenId);
      expect(documents.length).to.equal(1);
      expect(documents[0].docType).to.equal(docType);
      expect(documents[0].documentURI).to.equal(updatedUri);
    });

    it("should only allow owner or validator to manage documents", async function() {
      const tokenId = 1;
      const docType = "deed";
      const docUri = "ipfs://QmDeedDocument";

      await expect(
        metadataRenderer.connect(nonAuthorized).manageTokenDocument(tokenId, docType, docUri, false)
      ).to.be.reverted;
    });
  });
  
  describe("Gallery Management Functions", function() {
    it("should set and get token gallery", async function() {
      const tokenId = 1;
      const imageUrls = [
        "ipfs://QmImage1",
        "ipfs://QmImage2",
        "ipfs://QmImage3"
      ];

      await expect(
        metadataRenderer.setTokenGallery(
          tokenId,
          imageUrls
        )
      ).to.emit(metadataRenderer, "TokenGalleryUpdated")
        .withArgs(tokenId);

      const retrievedGallery = await metadataRenderer.getTokenGallery(tokenId);
      expect(retrievedGallery).to.deep.equal(imageUrls);
    });
    
    it("should handle empty gallery", async function() {
      const tokenId = 1;
      const emptyGallery: string[] = [];

      await metadataRenderer.setTokenGallery(
        tokenId,
        emptyGallery
      );

      const retrievedGallery = await metadataRenderer.getTokenGallery(tokenId);
      expect(retrievedGallery).to.be.empty;
    });
    
    it("should only allow admin to set gallery", async function() {
      const tokenId = 1;
      const imageUrls = ["ipfs://QmImage1"];

      await expect(
        metadataRenderer.connect(nonAuthorized).setTokenGallery(tokenId, imageUrls)
      ).to.be.reverted;
    });
    
    it("should update existing gallery", async function() {
      const tokenId = 1;
      const initialGallery = ["ipfs://QmImage1", "ipfs://QmImage2"];
      const updatedGallery = ["ipfs://QmImage3", "ipfs://QmImage4"];

      // Set initial gallery
      await metadataRenderer.setTokenGallery(tokenId, initialGallery);
      let retrievedGallery = await metadataRenderer.getTokenGallery(tokenId);
      expect(retrievedGallery).to.deep.equal(initialGallery);

      // Update gallery
      await metadataRenderer.setTokenGallery(tokenId, updatedGallery);
      retrievedGallery = await metadataRenderer.getTokenGallery(tokenId);
      expect(retrievedGallery).to.deep.equal(updatedGallery);
    });
  });
  
  describe("Animation and External Link Management", function() {
    it("should set and get token animation URL", async function() {
      const tokenId = 1;
      const animationURL = "ipfs://QmAnimation";

      await expect(
        metadataRenderer.setTokenAnimationURL(tokenId, animationURL)
      ).to.emit(metadataRenderer, "TokenMetadataUpdated")
        .withArgs(tokenId);

      const retrievedURL = await metadataRenderer.getTokenAnimationURL(tokenId);
      expect(retrievedURL).to.equal(animationURL);
    });
    
    it("should set and get token external link", async function() {
      const tokenId = 1;
      const externalLink = "https://example.com/token/1";

      await expect(
        metadataRenderer.setTokenExternalLink(tokenId, externalLink)
      ).to.emit(metadataRenderer, "TokenMetadataUpdated")
        .withArgs(tokenId);

      const retrievedLink = await metadataRenderer.getTokenExternalLink(tokenId);
      expect(retrievedLink).to.equal(externalLink);
    });

    it("should only allow owner or validator to set animation URL", async function() {
      const tokenId = 1;
      const animationURL = "ipfs://QmAnimation";

      await expect(
        metadataRenderer.connect(nonAuthorized).setTokenAnimationURL(tokenId, animationURL)
      ).to.be.reverted;
    });
    
    it("should only allow owner or validator to set external link", async function() {
      const tokenId = 1;
      const externalLink = "https://example.com/token/1";

      await expect(
        metadataRenderer.connect(nonAuthorized).setTokenExternalLink(tokenId, externalLink)
      ).to.be.reverted;
    });
    
    it("should handle empty animation URL and external link", async function() {
      const tokenId = 1;

      // Set empty animation URL
      await metadataRenderer.setTokenAnimationURL(tokenId, "");
      const retrievedAnimationURL = await metadataRenderer.getTokenAnimationURL(tokenId);
      expect(retrievedAnimationURL).to.equal("");
      
      // Set empty external link
      await metadataRenderer.setTokenExternalLink(tokenId, "");
      const retrievedExternalLink = await metadataRenderer.getTokenExternalLink(tokenId);
      expect(retrievedExternalLink).to.equal("");
    });
  });
  
  describe("Trait Synchronization", function() {
    it("should sync trait updates from DeedNFT", async function() {
      const tokenId = 1;

      // Mint a new token first
      await deedNFT.mintAsset(
        user1.address,
        0, // Land type
        "ipfs://metadata1",
        "{}",
        "configuration1",
        await validator.getAddress(),
        0n
      );

      // Set a string trait
      const stringTraitName = "definition";
      const stringTraitValue = "Test definition";
      await deedNFT.setTrait(
        tokenId,
        ethers.toUtf8Bytes(stringTraitName),
        ethers.toUtf8Bytes(stringTraitValue),
        1 // string type
      );

      // Get and verify string trait
      const storedStringValue = await deedNFT.getTraitValue(
        tokenId,
        ethers.keccak256(ethers.toUtf8Bytes(stringTraitName))
      );
      const decodedStringValue = ethers.AbiCoder.defaultAbiCoder().decode(["string"], storedStringValue)[0];
      expect(decodedStringValue).to.equal(stringTraitValue);

      // Set a boolean trait
      const boolTraitName = "isValidated";
      const boolTraitValue = true;
      await deedNFT.setTrait(
        tokenId,
        ethers.toUtf8Bytes(boolTraitName),
        ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [boolTraitValue]),
        0 // bytes type for direct encoding
      );

      // Get and verify boolean trait
      const storedBoolValue = await deedNFT.getTraitValue(
        tokenId,
        ethers.keccak256(ethers.toUtf8Bytes(boolTraitName))
      );
      const decodedBoolValue = ethers.AbiCoder.defaultAbiCoder().decode(["bool"], storedBoolValue)[0];
      expect(decodedBoolValue).to.equal(boolTraitValue);

      // Verify sync events were emitted
      const events = await metadataRenderer.queryFilter(
        metadataRenderer.filters.MetadataSynced,
        -1
      );
      expect(events.length).to.be.greaterThan(0);
      expect(events[0].args.tokenId).to.equal(tokenId);
    });
    
    it("should not allow direct trait updates", async function() {
      const tokenId = 1;
      const traitName = "definition";
      const traitValue = "Test definition";

      // Try to call syncTraitUpdate directly - should fail
      await expect(
        metadataRenderer.syncTraitUpdate(
          tokenId,
          ethers.keccak256(ethers.toUtf8Bytes(traitName)),
          ethers.AbiCoder.defaultAbiCoder().encode(["string"], [traitValue])
        )
      ).to.be.reverted;
    });
    
    it("should handle trait removal", async function() {
      const tokenId = 1;
      const traitName = "definition";
      const traitValue = "Test definition";

      // First set the trait
      await deedNFT.setTrait(
        tokenId,
        ethers.toUtf8Bytes(traitName),
        ethers.toUtf8Bytes(traitValue),
        1 // string type
      );

      // Verify trait was set
      let storedValue = await deedNFT.getTraitValue(
        tokenId,
        ethers.keccak256(ethers.toUtf8Bytes(traitName))
      );
      expect(storedValue.length).to.be.gt(0);

      // Then remove it
      await deedNFT.removeTrait(tokenId, traitName);

      // Verify trait was removed
      storedValue = await deedNFT.getTraitValue(
        tokenId,
        ethers.keccak256(ethers.toUtf8Bytes(traitName))
      );
      expect(storedValue).to.equal("0x");
    });

    it("should sync trait removal with MetadataRenderer", async function() {
      const tokenId = 1;
      const traitName = "definition";
      const traitValue = "Test definition";

      // Set the trait in DeedNFT (this will sync to MetadataRenderer)
      await deedNFT.setTrait(
        tokenId,
        ethers.toUtf8Bytes(traitName),
        ethers.toUtf8Bytes(traitValue),
        1 // string type
      );

      // Wait for trait sync
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify trait was added to attributes
      let tokenURI = await metadataRenderer.tokenURI(tokenId);
      let decodedURI = Buffer.from(tokenURI.split(",")[1], "base64").toString();
      let metadata = JSON.parse(decodedURI);
      expect(metadata.attributes).to.deep.include({
        trait_type: "Definition",
        value: traitValue
      });

      // Remove the trait in DeedNFT (this will sync removal to MetadataRenderer)
      await deedNFT.removeTrait(tokenId, traitName);

      // Wait for trait removal sync
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify trait was removed from attributes
      tokenURI = await metadataRenderer.tokenURI(tokenId);
      decodedURI = Buffer.from(tokenURI.split(",")[1], "base64").toString();
      metadata = JSON.parse(decodedURI);
      expect(metadata.attributes).to.not.deep.include({
        trait_type: "Definition",
        value: traitValue
      });
    });
  });
  
  describe("Metadata Rendering", function() {
    it("should properly render all metadata in tokenURI", async function() {
      const tokenId = 1;

      // Mint a new token first
      await deedNFT.mintAsset(
        user1.address, 
        0, // Land type
        "ipfs://metadata1",
        "{}",
        "configuration1",
        await validator.getAddress(),
        0n
      );

      // Set up traits through DeedNFT
      await deedNFT.setTrait(
        tokenId,
        ethers.toUtf8Bytes("assetType"),
        ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [0]),
        0 // bytes type
      );
      await deedNFT.setTrait(
        tokenId,
        ethers.toUtf8Bytes("isValidated"),
        ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [true]),
        0 // bytes type
      );
      await deedNFT.setTrait(
        tokenId,
        ethers.toUtf8Bytes("definition"),
        ethers.toUtf8Bytes("Test definition"),
        1 // string type
      );
      await deedNFT.setTrait(
        tokenId,
        ethers.toUtf8Bytes("streetNumber"),
        ethers.toUtf8Bytes("123"),
        1
      );
      await deedNFT.setTrait(
        tokenId,
        ethers.toUtf8Bytes("streetName"),
        ethers.toUtf8Bytes("Main St"),
        1
      );

      // Set up metadata
      await metadataRenderer.setTokenCustomMetadata(tokenId, "custom metadata");
      await metadataRenderer.setTokenAnimationURL(tokenId, "ipfs://animation");
      await metadataRenderer.setTokenExternalLink(tokenId, "https://example.com");
      await metadataRenderer.setTokenGallery(tokenId, ["ipfs://gallery1", "ipfs://gallery2"]);

      // Set up documents
      await metadataRenderer.manageTokenDocument(tokenId, "deed", "ipfs://deed", false);
      await metadataRenderer.manageTokenDocument(tokenId, "survey", "ipfs://survey", false);

      // Set up features
      await metadataRenderer.setTokenFeatures(tokenId, ["feature1", "feature2"]);

      // Set up asset condition
      await metadataRenderer.setAssetCondition(
        tokenId,
        "Excellent",
        "2024-01-01",
        ["issue1", "issue2"],
        ["improvement1", "improvement2"],
        "Additional notes"
      );

      // Set up legal info
      await metadataRenderer.setTokenLegalInfo(
        tokenId,
        "California",
        "CA12345",
        "2024-01-01",
        ["ipfs://legal1", "ipfs://legal2"],
        ["restriction1", "restriction2"],
        "Additional legal info"
      );

      // Get and decode token URI
      const tokenURI = await metadataRenderer.tokenURI(tokenId);
      const decodedURI = Buffer.from(tokenURI.split(",")[1], "base64").toString();
      const metadata = JSON.parse(decodedURI);

      // Verify basic metadata
      expect(metadata.name).to.equal("123 Main St, California 90210, USA - Land");
      expect(metadata.description).to.equal("Test definition");
      expect(metadata.image).to.equal("ipfs://gallery1");
      expect(metadata.background_color).to.equal("");
      expect(metadata.animation_url).to.equal("ipfs://animation");
      expect(metadata.external_link).to.equal("https://example.com");

      // Verify gallery images
      expect(metadata.gallery_images).to.deep.equal([
        "ipfs://gallery1",
        "ipfs://gallery2"
      ]);

      // Verify document types
      expect(metadata.document_types).to.deep.equal([
        "deed",
        "survey"
      ]);

      // Verify features
      expect(metadata.features).to.deep.equal([
        "feature1",
        "feature2"
      ]);
      
      // Verify asset condition
      expect(metadata.asset_condition).to.deep.equal({
        general_condition: "Excellent",
        last_inspection_date: "2024-01-01",
        known_issues: ["issue1", "issue2"],
        improvements: ["improvement1", "improvement2"],
        additional_notes: "Additional notes"
      });

      // Verify legal info
      expect(metadata.legal_info).to.deep.equal({
        jurisdiction: "California",
        registration_number: "CA12345",
        registration_date: "2024-01-01",
        documents: ["ipfs://legal1", "ipfs://legal2"],
        restrictions: ["restriction1", "restriction2"],
        additional_info: "Additional legal info"
      });

      // Verify attributes (traits)
      const attributes = metadata.attributes;
      expect(attributes).to.deep.include({
        trait_type: "Asset Type",
        value: "Land"
      });
      expect(attributes).to.deep.include({
        trait_type: "Validation Status",
        value: "Valid"
      });
      expect(attributes).to.deep.include({
        trait_type: "Definition",
        value: "Test definition"
      });
    });

    it("should use default image when no gallery images", async function() {
      const tokenId = 7; // Use a new token ID

      // Mint a new token first
      await deedNFT.mintAsset(
        user1.address,
        0, // Land type
        "ipfs://metadata7",
        "{}",
        "configuration7",
        await validator.getAddress(),
        0n
      );
      
      // Set up only asset type trait
      await deedNFT.setTrait(
        tokenId,
        ethers.toUtf8Bytes("assetType"),
        ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [0]),
        0 // bytes type
      );
      await deedNFT.setTrait(
        tokenId,
        ethers.toUtf8Bytes("isValidated"),
        ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [true]),
        0 // bytes type
      );

      // Get and decode token URI
      const tokenURI = await metadataRenderer.tokenURI(tokenId);
      const decodedURI = Buffer.from(tokenURI.split(",")[1], "base64").toString();
      const metadata = JSON.parse(decodedURI);

      // Should use default image since no gallery images are set
      expect(metadata.image).to.equal("ipfs://Qm1");
    });
  });
  
  describe("Contract Upgrade", function() {
    it("should allow admin to upgrade implementation", async function() {
      const MetadataRendererFactory = await ethers.getContractFactory("MetadataRenderer");
      
      await expect(
        upgrades.upgradeProxy(await metadataRenderer.getAddress(), MetadataRendererFactory)
      ).to.not.be.reverted;
    });
    
    it("should not allow non-admin to upgrade implementation", async function() {
      const MetadataRendererFactory = await ethers.getContractFactory("MetadataRenderer");
      
      await expect(
        upgrades.upgradeProxy(await metadataRenderer.getAddress(), MetadataRendererFactory.connect(nonAuthorized))
      ).to.be.reverted;
    });
  });
  
  describe("Contract Configuration Functions", function() {
    it("should set and get DeedNFT contract", async function() {
      const deedNFTAddress = await deedNFT.getAddress();

      await metadataRenderer.setDeedNFT(deedNFTAddress);

      const retrievedDeedNFT = await metadataRenderer.deedNFT();
      expect(retrievedDeedNFT).to.equal(deedNFTAddress);
    });

    it("should not allow setting zero address for DeedNFT", async function() {
      await expect(
        metadataRenderer.setDeedNFT(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(metadataRenderer, "Invalid");
    });
    
    it("should set and get asset type image URI", async function() {
      const assetType = 1;
      const imageURI = "ipfs://QmAssetTypeImage";

      await metadataRenderer.setAssetTypeImageURI(assetType, imageURI);
      
      const retrievedURI = await metadataRenderer.defaultImageURIs(assetType);
      expect(retrievedURI).to.equal(imageURI);
    });
    
    it("should not allow setting image URI for invalid asset type", async function() {
      const invalidAssetType = 255;
      const imageURI = "ipfs://QmImage";

      await expect(
        metadataRenderer.setAssetTypeImageURI(invalidAssetType, imageURI)
      ).to.be.reverted;
    });

    it("should set and get asset type background color", async function() {
      const assetType = 1;
      const backgroundColor = "#FFFFFF";

      await metadataRenderer.setAssetTypeBackgroundColor(assetType, backgroundColor);

      const retrievedColor = await metadataRenderer.defaultBackgroundColors(assetType);
      expect(retrievedColor).to.equal(backgroundColor);
    });

    it("should not allow setting background color for invalid asset type", async function() {
      const invalidAssetType = 255;
      const backgroundColor = "#FFFFFF";

      await expect(
        metadataRenderer.setAssetTypeBackgroundColor(invalidAssetType, backgroundColor)
      ).to.be.reverted;
    });
    
    it("should set and get invalidated image URI", async function() {
      const invalidatedImageURI = "ipfs://QmInvalidatedImage";

      await metadataRenderer.setInvalidatedImageURI(invalidatedImageURI);

      const retrievedURI = await metadataRenderer.defaultImageURIs(255);
      expect(retrievedURI).to.equal(invalidatedImageURI);
    });
  });
  
  describe("Legal Information Management", function() {
    it("should set and get legal information", async function() {
      const tokenId = 1;
      const legalInfo = {
        jurisdiction: "California",
        registrationNumber: "CA12345",
        registrationDate: "2024-01-01",
        documents: ["ipfs://QmDeed", "ipfs://QmTitle"],
        restrictions: ["No commercial use", "No subdivision"],
        additionalInfo: "Property subject to HOA rules"
      };

      await metadataRenderer.setTokenLegalInfo(
        tokenId,
        legalInfo.jurisdiction,
        legalInfo.registrationNumber,
        legalInfo.registrationDate,
        legalInfo.documents,
        legalInfo.restrictions,
        legalInfo.additionalInfo
      );

      const retrievedInfo = await metadataRenderer.getTokenLegalInfo(tokenId);
      expect(retrievedInfo.jurisdiction).to.equal(legalInfo.jurisdiction);
      expect(retrievedInfo.registrationNumber).to.equal(legalInfo.registrationNumber);
      expect(retrievedInfo.registrationDate).to.equal(legalInfo.registrationDate);
      expect(retrievedInfo.documents).to.deep.equal(legalInfo.documents);
      expect(retrievedInfo.restrictions).to.deep.equal(legalInfo.restrictions);
      expect(retrievedInfo.additionalInfo).to.equal(legalInfo.additionalInfo);
    });

    it("should not allow empty jurisdiction", async function() {
      const tokenId = 1;
      await expect(
        metadataRenderer.setTokenLegalInfo(
          tokenId,
          "", // empty jurisdiction
          "CA12345",
          "2024-01-01",
          ["ipfs://QmDeed"],
          ["No commercial use"],
          "Additional info"
        )
      ).to.be.revertedWithCustomError(metadataRenderer, "Empty");
    });

    it("should handle empty optional fields", async function() {
      const tokenId = 1;
      await metadataRenderer.setTokenLegalInfo(
        tokenId,
        "California",
        "", // empty registration number
        "", // empty registration date
        [], // empty documents
        [], // empty restrictions
        ""  // empty additional info
      );

      const retrievedInfo = await metadataRenderer.getTokenLegalInfo(tokenId);
      expect(retrievedInfo.jurisdiction).to.equal("California");
      expect(retrievedInfo.registrationNumber).to.equal("");
      expect(retrievedInfo.registrationDate).to.equal("");
      expect(retrievedInfo.documents).to.be.empty;
      expect(retrievedInfo.restrictions).to.be.empty;
      expect(retrievedInfo.additionalInfo).to.equal("");
    });
  });
  
  describe("Asset Condition Management", function() {
    it("should set and get asset condition", async function() {
      const tokenId = 1;
      const condition = {
        generalCondition: "Excellent",
        lastInspectionDate: "2024-01-01",
        knownIssues: ["Minor roof leak", "Old HVAC system"],
        improvements: ["New windows", "Updated electrical"],
        additionalNotes: "Regular maintenance performed"
      };

      await metadataRenderer.setAssetCondition(
        tokenId,
        condition.generalCondition,
        condition.lastInspectionDate,
        condition.knownIssues,
        condition.improvements,
        condition.additionalNotes
      );

      const retrievedCondition = await metadataRenderer.getAssetCondition(tokenId);
      expect(retrievedCondition.generalCondition).to.equal(condition.generalCondition);
      expect(retrievedCondition.lastInspectionDate).to.equal(condition.lastInspectionDate);
      expect(retrievedCondition.knownIssues).to.deep.equal(condition.knownIssues);
      expect(retrievedCondition.improvements).to.deep.equal(condition.improvements);
      expect(retrievedCondition.additionalNotes).to.equal(condition.additionalNotes);
    });

    it("should not allow empty general condition", async function() {
      const tokenId = 1;
      await expect(
        metadataRenderer.setAssetCondition(
          tokenId,
          "", // empty general condition
          "2024-01-01",
          ["Minor roof leak"],
          ["New windows"],
          "Regular maintenance"
        )
      ).to.be.revertedWithCustomError(metadataRenderer, "Empty");
    });

    it("should handle empty optional fields", async function() {
      const tokenId = 1;
      await metadataRenderer.setAssetCondition(
        tokenId,
        "Excellent",
        "", // empty inspection date
        [], // empty known issues
        [], // empty improvements
        ""  // empty additional notes
      );

      const retrievedCondition = await metadataRenderer.getAssetCondition(tokenId);
      expect(retrievedCondition.generalCondition).to.equal("Excellent");
      expect(retrievedCondition.lastInspectionDate).to.equal("");
      expect(retrievedCondition.knownIssues).to.be.empty;
      expect(retrievedCondition.improvements).to.be.empty;
      expect(retrievedCondition.additionalNotes).to.equal("");
    });
  });

  describe("Name Generation", function() {
    it("should generate correct names for Land assets with full address", async function() {
      const tokenURI = await metadataRenderer.tokenURI(1);
      const decodedURI = Buffer.from(tokenURI.split(",")[1], "base64").toString();
      const metadata = JSON.parse(decodedURI);
      expect(metadata.name).to.equal("123 Main St, California 90210, USA - Land");
    });

    it("should generate correct names for Land assets with parcel number and state", async function() {
      const tokenURI = await metadataRenderer.tokenURI(2);
      const decodedURI = Buffer.from(tokenURI.split(",")[1], "base64").toString();
      const metadata = JSON.parse(decodedURI);
      expect(metadata.name).to.equal("Parcel #P12345, California - Land");
    });

    it("should generate correct names for Estate assets with full address", async function() {
      const tokenURI = await metadataRenderer.tokenURI(3);
      const decodedURI = Buffer.from(tokenURI.split(",")[1], "base64").toString();
      const metadata = JSON.parse(decodedURI);
      expect(metadata.name).to.equal("456 Oak Ave, New York 10001, USA - Estate");
    });

    it("should generate correct names for Equipment with full details", async function() {
      const tokenURI = await metadataRenderer.tokenURI(4);
      const decodedURI = Buffer.from(tokenURI.split(",")[1], "base64").toString();
      const metadata = JSON.parse(decodedURI);
      expect(metadata.name).to.equal("Caterpillar 320D2 (S/N: SN123456)");
    });

    it("should generate correct names for Equipment with manufacturer and model", async function() {
      const tokenURI = await metadataRenderer.tokenURI(5);
      const decodedURI = Buffer.from(tokenURI.split(",")[1], "base64").toString();
      const metadata = JSON.parse(decodedURI);
      expect(metadata.name).to.equal("Honda EU3000i");
    });

    it("should generate correct names for Vehicle with full details", async function() {
      const tokenURI = await metadataRenderer.tokenURI(6);
      const decodedURI = Buffer.from(tokenURI.split(",")[1], "base64").toString();
      const metadata = JSON.parse(decodedURI);
      expect(metadata.name).to.equal("2024 Tesla Model S");
    });

    it("should generate correct names for Vehicle with make and model only", async function() {
      const tokenURI = await metadataRenderer.tokenURI(7);
      const decodedURI = Buffer.from(tokenURI.split(",")[1], "base64").toString();
      const metadata = JSON.parse(decodedURI);
      expect(metadata.name).to.equal("Toyota Camry");
    });

    it("should generate correct names for Vehicle with only make", async function() {
      const tokenURI = await metadataRenderer.tokenURI(8);
      const decodedURI = Buffer.from(tokenURI.split(",")[1], "base64").toString();
      const metadata = JSON.parse(decodedURI);
      expect(metadata.name).to.equal("Honda Vehicle");
    });
  });
}); 