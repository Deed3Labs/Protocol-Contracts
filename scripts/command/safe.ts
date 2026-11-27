/**
 * Making a Safe through Safe's own factory, as Safe{Wallet} does: 1.4.1, at the same addresses on
 * every chain Safe supports. Used by create-safe.ts and the fork drills.
 */
import { AbiCoder, Contract, getAddress, getCreate2Address, keccak256, solidityPacked, type ContractRunner, type Signer } from "ethers";

export const SAFE_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
/** SafeL2: emits an event per transaction, which the Transaction Service and Command read. */
export const SAFE_SINGLETON = "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762";
export const SAFE_FALLBACK_HANDLER = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99";
export const SAFE_ABI = [
  "function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function VERSION() view returns (string)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 nonce) view returns (bytes32)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
];
const FACTORY_ABI = [
  "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "function proxyCreationCode() pure returns (bytes)",
  "event ProxyCreation(address indexed proxy, address singleton)",
];

const ZERO = "0x0000000000000000000000000000000000000000";
export const safeInitializer = (owners: string[], threshold: number) =>
  new Contract(SAFE_SINGLETON, SAFE_ABI).interface.encodeFunctionData("setup", [owners.map((o) => getAddress(o)), threshold, ZERO, "0x", SAFE_FALLBACK_HANDLER, ZERO, 0, ZERO]);

/**
 * The address a Safe with these owners, threshold and salt gets: CREATE2 from the factory, with
 * the salt the factory uses (keccak of the initializer's hash and the nonce). Reads only.
 */
export async function predictSafe(runner: ContractRunner, owners: string[], threshold: number, salt: bigint) {
  const f = new Contract(SAFE_FACTORY, FACTORY_ABI, runner);
  const code: string = await f.proxyCreationCode();
  const s = keccak256(solidityPacked(["bytes32", "uint256"], [keccak256(safeInitializer(owners, threshold)), salt]));
  const initCode = solidityPacked(["bytes", "bytes"], [code, AbiCoder.defaultAbiCoder().encode(["address"], [SAFE_SINGLETON])]);
  return getCreate2Address(SAFE_FACTORY, s, keccak256(initCode));
}

/** Makes the Safe, signed by any funded wallet (it pays the gas, and owns nothing). */
export async function createSafe(signer: Signer, owners: string[], threshold: number, salt: bigint) {
  const f = new Contract(SAFE_FACTORY, FACTORY_ABI, signer);
  const rc = await (await f.createProxyWithNonce(SAFE_SINGLETON, safeInitializer(owners, threshold), salt)).wait();
  const ev = rc!.logs
    .map((l: any) => {
      try {
        return f.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((x: any) => x?.name === "ProxyCreation");
  if (!ev) throw new Error("The factory didn't say which Safe it made");
  return { address: getAddress(ev.args.proxy), tx: rc!.hash };
}
