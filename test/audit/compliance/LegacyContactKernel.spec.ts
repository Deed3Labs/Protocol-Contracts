import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/*
 * Phase 2g, 10f: the Legacy Contact module on the real ZeroDev Kernel v3.3 account and its
 * ECDSAValidator, compiled from ZeroDev's source (`test/fixtures/kernel-v3.3.json` records the tag,
 * the commits and the build). Decision 10 also asks for a test on a real Kernel account on a fork
 * before the external audit; this one runs the same bytecode locally.
 *
 * The EntryPoint is stood in for by a plain key, which is allowed every `onlyEntryPoint` call; the
 * member's own calls go through Kernel's root-validator hook (`ECDSAValidator.preCheck`: the caller
 * must be the owner), which is what a member's signed user operation reaches as well.
 */
const DAY = 24 * 3600;
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../../fixtures/kernel-v3.3.json"), "utf8"));
const coder = ethers.AbiCoder.defaultAbiCoder();

async function setNext(ts: number) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
}
async function stamp(tx: any): Promise<number> {
  const r = await (await tx).wait();
  return (await ethers.provider.getBlock(r!.blockNumber))!.timestamp;
}

describe("COMPLIANCE Phase 2g: the Legacy Contact module on a real Kernel v3.3 account", function () {
  async function deploy() {
    const [deployer, entrypoint, member, contact, newOwner, clearAdmin, clearKey] = await ethers.getSigners();
    const factoryOf = (name: string) => new ethers.ContractFactory(fixture.contracts[name].abi, fixture.contracts[name].bytecode, deployer);
    const validator: any = await (await factoryOf("ECDSAValidator").deploy()).waitForDeployment();
    const impl: any = await (await factoryOf("Kernel").deploy(entrypoint.address)).waitForDeployment();
    const kernelFactory: any = await (await factoryOf("KernelFactory").deploy(await impl.getAddress())).waitForDeployment();
    const rootValidator = ethers.solidityPacked(["bytes1", "address"], ["0x01", await validator.getAddress()]);
    const init = impl.interface.encodeFunctionData("initialize", [rootValidator, ethers.ZeroAddress, member.address, "0x", []]);
    const salt = ethers.ZeroHash;
    const accountAddress = await kernelFactory.createAccount.staticCall(init, salt);
    await kernelFactory.createAccount(init, salt);
    const account: any = new ethers.Contract(accountAddress, fixture.contracts.Kernel.abi, deployer);
    const module: any = await (await ethers.getContractFactory("LegacyContactModule"))
      .deploy(await validator.getAddress(), [clearAdmin.address, clearKey.address]);
    const installData = (contacts: string[], wait: number) => ethers.concat([
      ethers.ZeroAddress,
      coder.encode(["bytes", "bytes"], [coder.encode(["address[]", "uint64"], [contacts, wait]), "0x"]),
    ]);
    const single = (target: string, data: string) => ethers.solidityPacked(["address", "uint256", "bytes"], [target, 0, data]);
    return { entrypoint, member, contact, newOwner, clearAdmin, clearKey, validator, account, module, installData, single };
  }

  it("the account's real API is what the module codes against", async function () {
    const { account, validator, member } = await deploy();
    expect(await account.accountId()).to.equal("kernel.advanced.v0.3.3");
    expect(await account.rootValidator()).to.equal(ethers.solidityPacked(["bytes1", "address"], ["0x01", await validator.getAddress()]));
    expect(await validator.ecdsaValidatorStorage(await account.getAddress())).to.equal(member.address);
  });

  it("only the member installs and configures it; a cancelled request changes nothing; after the full wait the contact rotates the root ECDSA owner, and only that", async function () {
    const { member, contact, newOwner, clearAdmin, clearKey, validator, account, module, installData, single } = await deploy();
    const acct = await account.getAddress();
    const mod = await module.getAddress();

    // Clear keys and the contact cannot install it: Kernel's root hook refuses anyone but the owner.
    for (const k of [clearAdmin, clearKey, contact]) {
      await expect(account.connect(k).installModule(2, mod, installData([contact.address], 0))).to.be.reverted;
    }
    await expect(account.connect(member).installModule(2, mod, installData([clearKey.address], 0))).to.be.reverted;
    await expect(account.connect(member).installModule(2, mod, installData([contact.address], 29 * DAY))).to.be.reverted;
    await account.connect(member).installModule(2, mod, installData([contact.address], 0));
    expect(await account.isModuleInstalled(2, mod, "0x")).to.equal(true);
    expect(await module.waitOf(acct)).to.equal(90 * DAY);
    // Configured through the account, by the member.
    await account.connect(member).execute(ethers.ZeroHash, single(mod, module.interface.encodeFunctionData("setWait", [30 * DAY])));
    expect(await module.waitOf(acct)).to.equal(30 * DAY);
    for (const k of [clearAdmin, clearKey, contact]) {
      await expect(account.connect(k).execute(ethers.ZeroHash, single(mod, module.interface.encodeFunctionData("setWait", [60 * DAY])))).to.be.reverted;
    }

    // A request, then the member's cancellation.
    await module.connect(contact).requestRecovery(acct, newOwner.address);
    await account.connect(member).execute(ethers.ZeroHash, single(mod, module.interface.encodeFunctionData("cancelRecovery")));
    expect(await validator.ecdsaValidatorStorage(acct)).to.equal(member.address);

    // The contact cannot use the account's executor path itself.
    await expect(account.connect(contact).executeFromExecutor(ethers.ZeroHash, single(acct, "0x"))).to.be.reverted;

    // An uncancelled request: one second early reverts; at the full wait the owner rotates.
    const opened = await stamp(module.connect(contact).requestRecovery(acct, newOwner.address));
    await setNext(opened + 30 * DAY - 1);
    await expect(module.connect(contact).recover(acct)).to.be.revertedWithCustomError(module, "LegacyContactWaitNotOver");
    await setNext(opened + 30 * DAY + 5);
    await expect(module.connect(contact).recover(acct))
      .to.emit(module, "OwnerRotated").withArgs(acct, contact.address, member.address, newOwner.address);
    expect(await validator.ecdsaValidatorStorage(acct)).to.equal(newOwner.address);
    // Nothing else changed in the account: the same root validator, the module still installed.
    expect(await account.rootValidator()).to.equal(ethers.solidityPacked(["bytes1", "address"], ["0x01", await validator.getAddress()]));
    expect(await account.isModuleInstalled(2, mod, "0x")).to.equal(true);

    // The old key is out and the new key is in, through the same root hook.
    await expect(account.connect(member).execute(ethers.ZeroHash, single(mod, module.interface.encodeFunctionData("setWait", [60 * DAY])))).to.be.reverted;
    await account.connect(newOwner).execute(ethers.ZeroHash, single(mod, module.interface.encodeFunctionData("setWait", [60 * DAY])));
    // And the new owner alone can uninstall it.
    await expect(account.connect(contact).uninstallModule(2, mod, "0x")).to.be.reverted;
    await account.connect(newOwner).uninstallModule(2, mod, "0x");
    expect(await account.isModuleInstalled(2, mod, "0x")).to.equal(false);
    expect(await module.isInitialized(acct)).to.equal(false);
  });
});
