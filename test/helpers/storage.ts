import { ethers } from "hardhat";

/**
 * Writes `value` into the plain storage slot behind a public uint getter (`getter()`), on the
 * in-process Hardhat network only. For state no function sets any more, such as the pre-2f loans
 * between the PayoutPool and its lenders: each of the first `maxSlot` slots is tried with a marker,
 * restored at once, until the getter answers the marker.
 */
export async function setUintByGetter(contract: any, getter: string, value: bigint, maxSlot = 400) {
  const target = await contract.getAddress();
  const marker = ethers.zeroPadValue(ethers.toBeHex(0x5eed_5107_0000_0001n), 32);
  for (let i = 0; i < maxSlot; i++) {
    const slot = ethers.toQuantity(i);
    const before = await ethers.provider.getStorage(target, i);
    await ethers.provider.send("hardhat_setStorageAt", [target, slot, marker]);
    const hit = (await contract[getter]().catch(() => null)) === BigInt(marker);
    await ethers.provider.send("hardhat_setStorageAt", [target, slot, hit ? ethers.zeroPadValue(ethers.toBeHex(value), 32) : before]);
    if (hit) return i;
  }
  throw new Error(`no storage slot found for ${getter}()`);
}
