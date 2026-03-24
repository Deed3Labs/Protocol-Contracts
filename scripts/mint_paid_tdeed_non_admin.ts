import { ethers } from "hardhat";
import { getDeployment } from "../deploy/helpers";

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const nonAdminPk = process.env.NON_ADMIN_PRIVATE_KEY?.trim() || "";
  const user = nonAdminPk
    ? new ethers.Wallet(nonAdminPk, ethers.provider)
    : ethers.Wallet.createRandom().connect(ethers.provider);
  const network = await ethers.provider.getNetwork();

  const deedAddress = getDeployment(network.name, "DeedNFT")?.address || "";
  const validatorAddress = getDeployment(network.name, "Validator")?.address || "";
  const fundManagerAddress = getDeployment(network.name, "FundManager")?.address || "";
  const clearUsdAddress = getDeployment(network.name, "ClearUSD")?.address || "";

  if (!deedAddress || !validatorAddress || !fundManagerAddress || !clearUsdAddress) {
    throw new Error("Missing required deployments: DeedNFT, Validator, FundManager, ClearUSD.");
  }

  const deedNFT = await ethers.getContractAt("DeedNFT", deedAddress);
  const validator = await ethers.getContractAt("Validator", validatorAddress);
  const fundManager = await ethers.getContractAt("FundManager", fundManagerAddress);
  const clearUsd = await ethers.getContractAt("ClearUSD", clearUsdAddress);

  console.log("Network:", network.name, `(${network.chainId})`);
  console.log("Deployer:", deployer.address);
  console.log("Non-admin test wallet:", user.address);
  if (!nonAdminPk) {
    console.log("Non-admin wallet source: generated ephemeral wallet");
  }
  console.log("DeedNFT:", deedAddress);
  console.log("Validator:", validatorAddress);
  console.log("FundManager:", fundManagerAddress);
  console.log("CLRUSD:", clearUsdAddress);

  const userIsAdmin = await deedNFT.hasRole(await deedNFT.DEFAULT_ADMIN_ROLE(), user.address);
  console.log("User has DEFAULT_ADMIN_ROLE on DeedNFT:", userIsAdmin);

  const minterRole = await deedNFT.MINTER_ROLE();
  if (!(await deedNFT.hasRole(minterRole, user.address))) {
    const grantTx = await deedNFT.grantRole(minterRole, user.address);
    await grantTx.wait();
    console.log("Granted MINTER_ROLE to user:", grantTx.hash);
  }

  const requiredNative = ethers.parseEther(process.env.NON_ADMIN_NATIVE_FUND?.trim() || "0.02");
  const userNative = await ethers.provider.getBalance(user.address);
  if (userNative < requiredNative) {
    const topUpTx = await deployer.sendTransaction({
      to: user.address,
      value: requiredNative - userNative,
    });
    await topUpTx.wait();
    console.log("Funded user native gas:", topUpTx.hash);
  }

  const serviceFee = await validator.getServiceFee(clearUsdAddress);
  if (serviceFee === 0n) {
    throw new Error("Validator service fee for CLRUSD is not set.");
  }
  console.log("Service fee (raw units):", serviceFee.toString());

  const userClr = await clearUsd.balanceOf(user.address);
  if (userClr < serviceFee) {
    const topUp = serviceFee - userClr;
    const deployerClr = await clearUsd.balanceOf(deployer.address);
    if (deployerClr >= topUp) {
      const transferTx = await clearUsd.transfer(user.address, topUp);
      await transferTx.wait();
      console.log("Transferred CLRUSD to user:", transferTx.hash);
    } else {
      const adminRole = await clearUsd.DEFAULT_ADMIN_ROLE();
      const minterRole = await clearUsd.MINTER_ROLE();
      const deployerIsAdmin = await clearUsd.hasRole(adminRole, deployer.address);
      if (!deployerIsAdmin) {
        throw new Error(
          `Need CLRUSD top-up ${topUp.toString()} for user, but deployer lacks token balance and DEFAULT_ADMIN_ROLE.`
        );
      }

      if (!(await clearUsd.hasRole(minterRole, deployer.address))) {
        const grantTx = await clearUsd.grantIssuerRoles(deployer.address);
        await grantTx.wait();
        console.log("Granted deployer CLRUSD issuer roles:", grantTx.hash);
      }

      const mintTx = await clearUsd.mint(user.address, topUp);
      await mintTx.wait();
      console.log("Minted CLRUSD directly to user:", mintTx.hash);
    }
  }

  const userAllowance = await clearUsd.allowance(user.address, fundManagerAddress);
  if (userAllowance < serviceFee) {
    const approveTx = await clearUsd.connect(user).approve(fundManagerAddress, serviceFee);
    await approveTx.wait();
    console.log("User approved FundManager spend:", approveTx.hash);
  }

  const definition =
    process.env.NON_ADMIN_MINT_DEFINITION?.trim() ||
    "Non-admin paid mint validation (CLRUSD service fee)";
  const configuration =
    process.env.NON_ADMIN_MINT_CONFIGURATION?.trim() ||
    "{\"parcelId\":\"NONADMIN-001\",\"jurisdiction\":\"US-TESTNET\"}";
  const fallbackUri =
    process.env.NON_ADMIN_MINT_FALLBACK_URI?.trim() ||
    "ipfs://mock/tdeed/non-admin";
  const useUniqueSalt = parseBool(process.env.NON_ADMIN_MINT_USE_SALT, false);
  const salt = useUniqueSalt
    ? Number(process.env.NON_ADMIN_MINT_SALT?.trim() || Date.now().toString().slice(-9))
    : 0;

  const userClrBefore = await clearUsd.balanceOf(user.address);
  const feeReceiver = await fundManager.feeReceiver();
  const feeReceiverBefore = await clearUsd.balanceOf(feeReceiver);

  const mintTx = await deedNFT.connect(user).mintAsset(
    user.address,
    2, // Estate
    fallbackUri,
    definition,
    configuration,
    ethers.ZeroAddress,
    clearUsdAddress,
    salt
  );
  const receipt = await mintTx.wait();
  console.log("Non-admin paid mint tx:", mintTx.hash);

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
      // ignore unrelated logs
    }
  }

  if (tokenId === null) {
    throw new Error("Mint tx succeeded but DeedNFTMinted event not found.");
  }

  const userClrAfter = await clearUsd.balanceOf(user.address);
  const feeReceiverAfter = await clearUsd.balanceOf(feeReceiver);

  console.log("Minted tokenId:", tokenId.toString());
  console.log("User CLRUSD before:", userClrBefore.toString());
  console.log("User CLRUSD after :", userClrAfter.toString());
  console.log("Fee receiver CLRUSD before:", feeReceiverBefore.toString());
  console.log("Fee receiver CLRUSD after :", feeReceiverAfter.toString());
  console.log("Service fee charged (user delta):", (userClrBefore - userClrAfter).toString());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
