import { encodeFunctionData } from 'viem';

/** One call in a sponsored batch. */
export interface Call {
  to: `0x${string}`;
  data: `0x${string}`;
}

const ERC20_TRANSFER = [
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

/**
 * Paying a shop now, from the member's own USDC: the shop's share and Clear's fee, as one batch, so
 * it's both or neither. The amounts and addresses come from the server's hold on the charge
 * (`startPayNow`), which checks the transaction against them before marking it paid. A charge too
 * small to carry a fee is one transfer. The Clear app and the rewards app both send exactly this.
 */
export function payShopCalls(args: { token: `0x${string}`; shop: { to: `0x${string}`; units: bigint }; fee: { to: `0x${string}`; units: bigint } }): Call[] {
  const transfer = (to: `0x${string}`, units: bigint): Call => ({
    to: args.token,
    data: encodeFunctionData({ abi: ERC20_TRANSFER, functionName: 'transfer', args: [to, units] }),
  });
  const calls = [transfer(args.shop.to, args.shop.units)];
  if (args.fee.units > 0n) calls.push(transfer(args.fee.to, args.fee.units));
  return calls;
}
