/**
 * Network gating by domain. The live app (app.useclear.org) is mainnet-only — balances and on-chain
 * transactions use Base mainnet. The demo/preview is testnet — it can also surface testnet balances
 * and transacts on Base Sepolia. This keeps real funds off the demo and test funds off production.
 */

export const IS_LIVE_APP =
  typeof window !== 'undefined' && window.location.hostname === 'app.useclear.org';

/** Chain all gasless money flows (deposit/redeem/send) run on, decided by the domain. */
export const ACTIVE_CHAIN_ID = IS_LIVE_APP ? 8453 : 84532;

export const MAINNET_CHAIN_IDS = new Set([1, 10, 8453, 42161, 137, 100]);

export const isMainnetChain = (chainId: number): boolean => MAINNET_CHAIN_IDS.has(chainId);

/** Balances are scoped to the domain's networks: live app = mainnet only, demo = testnet only. */
export const includeChainBalance = (chainId: number): boolean =>
  IS_LIVE_APP ? isMainnetChain(chainId) : !isMainnetChain(chainId);

/** Committed Clear contract addresses per chain — used by the client-side AA (batched) flows. */
export interface ClearContracts {
  esaVault: `0x${string}`;
  clrusd: `0x${string}`;
  usdc: `0x${string}`;
  claimEscrow: `0x${string}`;
  /**
   * The yield pool. Optional because it is only deployed on testnet so far — a chain without one
   * has no pool to move money into, and the UI reads that as "not available here" rather than
   * calling a zero address.
   */
  lendingPool?: `0x${string}`;
  /**
   * The bond collection (Phase 2f): what the app reads holdings from and settles a matured bond on.
   * Testnet only so far. There is no deposit contract any more: a bond is bought by a signed Quote
   * on the collection itself (decision 8).
   */
  burnerBond?: `0x${string}`;
  /** Holds the face-value and maturity limits every mint is checked against. */
  burnerBondFactory?: `0x${string}`;
  /** The credit ledger. Repaying card debt in USDC is `repayCreditBalance` here. Testnet only so far. */
  stableCredit?: `0x${string}`;
  /** The revolving line: the card's tiers. Settling from savings names it. */
  revolvingIssuer?: `0x${string}`;
  /** Where a member settles savings-backed credit out of their own savings (`settleFromSavings`). */
  liquidator?: `0x${string}`;
  /** Term plans: a member pays one down by naming it (`payPlan`), and re-splits it (`setSplit`). */
  termIssuer?: `0x${string}`;
  /** Where a member's signed pledges are recorded (Phase 4b, L-I): the domain they sign in. */
  collateralRegistry?: `0x${string}`;
  /**
   * Clear Credits and the Housing Allowance (deploys 29 and 30). The Points Issuer is the domain a
   * member signs a redemption in; the record is what a payment toward a home goes through; the
   * RedemptionAgent hands over the Clear Deed once the record shows the price reached. Testnet only.
   */
  pointsIssuer?: `0x${string}`;
  housingAllowanceRecord?: `0x${string}`;
  redemptionAgent?: `0x${string}`;
}
const CONTRACTS: Record<number, ClearContracts> = {
  8453: {
    esaVault: '0x0CfE6aFB053474cE4Ff744a1fe864C82c173a1C1',
    clrusd: '0xa7a257f411e4Fe98e1D1FaA36C84B864c3336583',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    claimEscrow: '0xb30E97FEd437bf89B122693D26338C8D64515096',
  },
  84532: {
    lendingPool: '0x58405326b66888d8a9f2Dc4646cAc2F5EaC7ce23',
    // The fresh Base Sepolia credit stack (decision 47) and the Phase 2f bond collection and factory,
    // from deployments/base-sepolia/<name>.json. The pre-audit and pre-2f contracts are retired
    // (`*PreAudit`, `*Pre2f`), and so is the bond deposit contract (decision 8).
    burnerBond: '0xe7F6d3E21189e8B6a73f6dee0955322b7a32cC2A',
    burnerBondFactory: '0xf36dE3553509BAafB835bC37c97f529Adf42a96a',
    stableCredit: '0x5923e02EdFb6724a08A28B79C902b40c748082Bc',
    revolvingIssuer: '0xBec598bee24cF2973d42eA85e6028621180fE2F0',
    liquidator: '0x621784117C037b3D20AF54e04589818e919e33f3',
    termIssuer: '0x1b1695353f14E889906237D9b9C386eD0393da57',
    collateralRegistry: '0xfeDb873e6e1ec1C3BFC8cD561F66bd64D51C446A',
    pointsIssuer: '0xd254Bd2C78791a666eEfC4A7B6163d5d47C842a3',
    housingAllowanceRecord: '0x26D8540881249bcD253810aBC2242b5a572729B5',
    redemptionAgent: '0xBbBdf1302ED3Ef7861D757eAC28AcEEa019FAB84',
    // Replacement pair. The vault and token these succeed are still deployed and still
    // mutually redeemable -- ESADepositVaultLegacy holds the USDC behind the CLRUSD that was
    // outstanding when the swap happened, so nobody who held the old token is stranded.
    esaVault: '0x836401Ed3e2bF7CAb5e2721188E74B834511413b',
    clrusd: '0x2a116Bead17dd96DC5c560A0d76b02eb2D7aD6D1',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    claimEscrow: '0x24DAE7b66dC31657265260B5d9092280B57Bc37D',
  },
};
export const clearContracts = (chainId: number): ClearContracts | null => CONTRACTS[chainId] ?? null;
