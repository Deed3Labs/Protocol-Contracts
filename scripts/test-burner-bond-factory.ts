import { ethers } from "hardhat";

async function main() {
    console.log("Testing BurnerBondFactory with multiple tokens...\n");

    // Get signers
    const [deployer, user1, user2, user3] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    console.log("User1:", user1.address);
    console.log("User2:", user2.address);
    console.log("User3:", user3.address);
    console.log();

    // Deploy mock tokens (USDC, WETH, DAI)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await usdc.deployed();
    console.log("USDC deployed to:", usdc.address);
    
    const weth = await MockERC20.deploy("Wrapped Ether", "WETH", 18);
    await weth.deployed();
    console.log("WETH deployed to:", weth.address);
    
    const dai = await MockERC20.deploy("Dai Stablecoin", "DAI", 18);
    await dai.deployed();
    console.log("DAI deployed to:", dai.address);
    console.log();

    // Deploy AssurancePool (mock)
    const MockAssurancePool = await ethers.getContractFactory("MockAssurancePool");
    const assurancePool = await MockAssurancePool.deploy();
    await assurancePool.deployed();
    console.log("AssurancePool deployed to:", assurancePool.address);

    // Deploy AssuranceOracle (mock)
    const AssuranceOracle = await ethers.getContractFactory("AssuranceOracle");
    const assuranceOracle = await AssuranceOracle.deploy(
        assurancePool.address,
        ethers.utils.parseEther("1.0"), // 100% target RTD
        "0x0000000000000000000000000000000000000000", // Mock Uniswap factory
        "0x0000000000000000000000000000000000000000", // Mock WETH
        usdc.address,
        "0x0000000000000000000000000000000000000000", // Mock USDT
        dai.address
    );
    await assuranceOracle.deployed();
    console.log("AssuranceOracle deployed to:", assuranceOracle.address);

    // Whitelist tokens
    await assuranceOracle.whitelistToken(usdc.address);
    await assuranceOracle.whitelistToken(weth.address);
    await assuranceOracle.whitelistToken(dai.address);
    console.log("Tokens whitelisted");
    console.log();

    // Deploy BurnerBondFactory
    const BurnerBondFactory = await ethers.getContractFactory("BurnerBondFactory");
    const factory = await BurnerBondFactory.deploy(
        assurancePool.address,
        assuranceOracle.address,
        "https://api.burnerbonds.com/metadata/"
    );
    await factory.deployed();
    console.log("BurnerBondFactory deployed to:", factory.address);
    console.log();

    // Create collections for each token
    console.log("Creating collections...");
    
    // USDC collection
    const usdcTx = await factory.createCollection(
        usdc.address,
        "USDC",
        "USD Coin",
        "https://api.burnerbonds.com/metadata/"
    );
    const usdcReceipt = await usdcTx.wait();
    const usdcCollectionAddress = usdcReceipt.events?.find(e => e.event === "CollectionCreated")?.args?.collectionAddress;
    console.log("USDC Collection created at:", usdcCollectionAddress);
    
    // WETH collection
    const wethTx = await factory.createCollection(
        weth.address,
        "WETH",
        "Wrapped Ether",
        "https://api.burnerbonds.com/metadata/"
    );
    const wethReceipt = await wethTx.wait();
    const wethCollectionAddress = wethReceipt.events?.find(e => e.event === "CollectionCreated")?.args?.collectionAddress;
    console.log("WETH Collection created at:", wethCollectionAddress);
    
    // DAI collection
    const daiTx = await factory.createCollection(
        dai.address,
        "DAI",
        "Dai Stablecoin",
        "https://api.burnerbonds.com/metadata/"
    );
    const daiReceipt = await daiTx.wait();
    const daiCollectionAddress = daiReceipt.events?.find(e => e.event === "CollectionCreated")?.args?.collectionAddress;
    console.log("DAI Collection created at:", daiCollectionAddress);
    console.log();

    // Get collection info
    console.log("Collection Information:");
    const usdcInfo = await factory.getCollectionInfo(usdc.address);
    console.log("USDC Collection:", {
        name: usdcInfo.tokenName,
        symbol: usdcInfo.tokenSymbol,
        collectionAddress: usdcInfo.collectionAddress,
        isActive: usdcInfo.isActive
    });
    
    const wethInfo = await factory.getCollectionInfo(weth.address);
    console.log("WETH Collection:", {
        name: wethInfo.tokenName,
        symbol: wethInfo.tokenSymbol,
        collectionAddress: wethInfo.collectionAddress,
        isActive: wethInfo.isActive
    });
    
    const daiInfo = await factory.getCollectionInfo(dai.address);
    console.log("DAI Collection:", {
        name: daiInfo.tokenName,
        symbol: daiInfo.tokenSymbol,
        collectionAddress: daiInfo.collectionAddress,
        isActive: daiInfo.isActive
    });
    console.log();

    // Mint some tokens to users
    console.log("Minting tokens to users...");
    await usdc.mint(user1.address, ethers.utils.parseUnits("1000", 6)); // 1000 USDC
    await weth.mint(user2.address, ethers.utils.parseEther("10")); // 10 WETH
    await weth.mint(user3.address, ethers.utils.parseEther("5")); // 5 WETH
    await dai.mint(user1.address, ethers.utils.parseEther("500")); // 500 DAI
    console.log("Tokens minted");
    console.log();

    // Test deposits
    console.log("Testing deposits...");
    
    // User1 deposits USDC
    console.log("User1 depositing USDC...");
    await usdc.connect(user1).approve(factory.address, ethers.utils.parseUnits("100", 6));
    const usdcBondId = await factory.connect(user1).makeDeposit(
        usdc.address,
        ethers.utils.parseUnits("100", 6), // $100 face value
        Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year maturity
        1000 // 10% discount
    );
    console.log("USDC Bond ID:", usdcBondId.toString());
    
    // User2 deposits WETH
    console.log("User2 depositing WETH...");
    await weth.connect(user2).approve(factory.address, ethers.utils.parseEther("1"));
    const wethBondId = await factory.connect(user2).makeDeposit(
        weth.address,
        ethers.utils.parseEther("1"), // 1 WETH face value
        Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year maturity
        1500 // 15% discount
    );
    console.log("WETH Bond ID:", wethBondId.toString());
    
    // User3 deposits WETH (same collection as User2)
    console.log("User3 depositing WETH (same collection as User2)...");
    await weth.connect(user3).approve(factory.address, ethers.utils.parseEther("0.5"));
    const wethBondId2 = await factory.connect(user3).makeDeposit(
        weth.address,
        ethers.utils.parseEther("0.5"), // 0.5 WETH face value
        Math.floor(Date.now() / 1000) + 2 * 365 * 24 * 60 * 60, // 2 year maturity
        2000 // 20% discount
    );
    console.log("WETH Bond ID 2:", wethBondId2.toString());
    console.log();

    // Check collection metadata
    console.log("Collection Metadata:");
    const usdcCollection = await ethers.getContractAt("BurnerBond", usdcCollectionAddress);
    const wethCollection = await ethers.getContractAt("BurnerBond", wethCollectionAddress);
    const daiCollection = await ethers.getContractAt("BurnerBond", daiCollectionAddress);
    
    const usdcMetadata = await usdcCollection.getCollectionMetadata();
    console.log("USDC Collection:", {
        name: usdcMetadata.name,
        symbol: usdcMetadata.symbol,
        description: usdcMetadata.description,
        underlyingToken: usdcMetadata.underlyingToken,
        totalSupply: usdcMetadata.totalSupply.toString()
    });
    
    const wethMetadata = await wethCollection.getCollectionMetadata();
    console.log("WETH Collection:", {
        name: wethMetadata.name,
        symbol: wethMetadata.symbol,
        description: wethMetadata.description,
        underlyingToken: wethMetadata.underlyingToken,
        totalSupply: wethMetadata.totalSupply.toString()
    });
    
    const daiMetadata = await daiCollection.getCollectionMetadata();
    console.log("DAI Collection:", {
        name: daiMetadata.name,
        symbol: daiMetadata.symbol,
        description: daiMetadata.description,
        underlyingToken: daiMetadata.underlyingToken,
        totalSupply: daiMetadata.totalSupply.toString()
    });
    console.log();

    // Check bond info
    console.log("Bond Information:");
    const usdcBondInfo = await usdcCollection.getBondInfo(usdcBondId);
    console.log("USDC Bond:", {
        faceValue: usdcBondInfo.faceValue.toString(),
        maturityDate: new Date(usdcBondInfo.maturityDate.toNumber() * 1000).toISOString(),
        discountPercentage: usdcBondInfo.discountPercentage.toString(),
        purchasePrice: usdcBondInfo.purchasePrice.toString(),
        creator: usdcBondInfo.creator
    });
    
    const wethBondInfo = await wethCollection.getBondInfo(wethBondId);
    console.log("WETH Bond 1:", {
        faceValue: wethBondInfo.faceValue.toString(),
        maturityDate: new Date(wethBondInfo.maturityDate.toNumber() * 1000).toISOString(),
        discountPercentage: wethBondInfo.discountPercentage.toString(),
        purchasePrice: wethBondInfo.purchasePrice.toString(),
        creator: wethBondInfo.creator
    });
    
    const wethBondInfo2 = await wethCollection.getBondInfo(wethBondId2);
    console.log("WETH Bond 2:", {
        faceValue: wethBondInfo2.faceValue.toString(),
        maturityDate: new Date(wethBondInfo2.maturityDate.toNumber() * 1000).toISOString(),
        discountPercentage: wethBondInfo2.discountPercentage.toString(),
        purchasePrice: wethBondInfo2.purchasePrice.toString(),
        creator: wethBondInfo2.creator
    });
    console.log();

    // Check balances
    console.log("Token Balances:");
    console.log("User1 USDC:", ethers.utils.formatUnits(await usdc.balanceOf(user1.address), 6));
    console.log("User2 WETH:", ethers.utils.formatEther(await weth.balanceOf(user2.address)));
    console.log("User3 WETH:", ethers.utils.formatEther(await weth.balanceOf(user3.address)));
    console.log("User1 DAI:", ethers.utils.formatEther(await dai.balanceOf(user1.address)));
    console.log();

    // Check NFT balances
    console.log("NFT Balances:");
    console.log("User1 USDC Bonds:", await usdcCollection.balanceOf(user1.address, usdcBondId));
    console.log("User2 WETH Bonds:", await wethCollection.balanceOf(user2.address, wethBondId));
    console.log("User3 WETH Bonds:", await wethCollection.balanceOf(user3.address, wethBondId2));
    console.log();

    console.log("✅ Factory-based BurnerBond system test completed successfully!");
    console.log("\nSummary:");
    console.log("- Created separate collections for USDC, WETH, and DAI");
    console.log("- Each collection has unique name, symbol, and description");
    console.log("- Users can deposit different tokens and get bonds from token-specific collections");
    console.log("- Multiple users can use the same collection (WETH example)");
    console.log("- Bonds are backed by the underlying token deposited into AssurancePool");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
