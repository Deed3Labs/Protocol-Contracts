/**
 * Contract addresses by chain ID
 * These should match the addresses in app/src/config/networks.ts
 * 
 * For production, consider loading from deployment JSON files or environment variables
 */
export const DEPLOYED_CONTRACTS: Record<number, Record<string, string>> = {
  // Base Sepolia
  84532: {
    DeedNFT: '0x1a4e89225015200f70e5a06f766399a3de6e21E6',
    Validator: '0x18C53C0D046f98322954f971c21125E4443c79b9',
    ValidatorRegistry: '0x979E6cC741A8481f96739A996D06EcFb9BA2bc91',
    FundManager: '0x73ea6B404E6B81E7Fe6B112605dD8661B52d401e',
    MetadataRenderer: '0xAc50869E89004aa25A8c1044195AC760A7FC48BE',
    Subdivide: '0x3c947D71cb1698dFd4D7551b87E17306865C923F',
    Fractionalize: '0xeC464847C664Cc208478adbe377f7Db19e199823',
    FractionTokenFactory: '0x3E513d3c3c2845B5cAc4FA5e21C0f7f80f9328dc',
    CLRUSD: process.env.CLRUSD_84532 || '0x2a116Bead17dd96DC5c560A0d76b02eb2D7aD6D1',
    ESADepositVault: process.env.ESA_VAULT_84532 || '0x836401Ed3e2bF7CAb5e2721188E74B834511413b',
    CLRUSDTokenPool: process.env.CLRUSD_POOL_84532 || '0x0000000000000000000000000000000000000000',
    // The credit core, deployed fresh on Base Sepolia (decision 47); the pre-audit stack is retired
    // (`*PreAudit` records, decision 48). Defaults are the deployment records
    // (deployments/base-sepolia/<name>.json) so the server works without extra configuration; env
    // still wins, which is what mainnet will use, so a stale env value outlives a fix here: check it.
    ClearCredit: process.env.CLEAR_CREDIT_84532 || '0x5923e02EdFb6724a08A28B79C902b40c748082Bc',
    RevolvingIssuer: process.env.REVOLVING_ISSUER_84532 || '0xBec598bee24cF2973d42eA85e6028621180fE2F0',
    TermIssuer: process.env.TERM_ISSUER_84532 || '0x1b1695353f14E889906237D9b9C386eD0393da57',
    CollateralRegistry: process.env.COLLATERAL_REGISTRY_84532 || '0xfeDb873e6e1ec1C3BFC8cD561F66bd64D51C446A',
    LimitCalculator: process.env.LIMIT_CALCULATOR_84532 || '0x6C0859EcD05C6BB604c91B9De1CAf04724744a20',
    // The Phase 1 reserve (the old Assurance Pool); the Money page's history still reads it.
    AssurancePool: process.env.ASSURANCE_POOL_84532 || '0xf5E40414410672636Ab1691ae19D2Aa1c1705840',
    // The co-op's new Assurance Pool (Phase 2c: compartments, Credit Backstop).
    AssurancePoolV2: process.env.ASSURANCE_POOL_V2_84532 || '0x3c334D3AeD134191B7Ad0744a23978D71357BB15',
    // Savings intents (Phase 2d's factory; SavingsIntentFactoryPre2d is retired).
    SavingsIntentFactory: process.env.SAVINGS_INTENT_FACTORY_84532 || '0xF8074182d9ec61970bBC9E4aaE182B42dF7Bb74B',
    // Earn: the Yield Pool (LendingPool, upgraded in place), BondVault, and the Phase 2f bond
    // collection, factory and valuer (deploys 22 and 23). The pre-2f collection and its deposit
    // contract are retired: bonds are bought by a signed Quote, not through a deposit contract
    // (decision 8), so there is no BurnerBondDeposit.
    BondVault: process.env.BOND_VAULT_84532 || '0x9f311Fd8F05Ed517130dC044cDdBb159d02bA855',
    BurnerBond: process.env.BURNER_BOND_84532 || '0xe7F6d3E21189e8B6a73f6dee0955322b7a32cC2A',
    BurnerBondFactory: process.env.BURNER_BOND_FACTORY_84532 || '0xf36dE3553509BAafB835bC37c97f529Adf42a96a',
    BondValuer: process.env.BOND_VALUER_84532 || '0x7f63e01B1BBd79509138D825B5Ef4b186E9502C8',
    LendingPool: process.env.LENDING_POOL_84532 || '0x58405326b66888d8a9f2Dc4646cAc2F5EaC7ce23',
    EarnControls: process.env.EARN_CONTROLS_84532 || '0xe4a7eF8BaF868264F9C4aF0b95342b683764cD97',
    PayoutPool: process.env.PAYOUT_POOL_84532 || '0xb4704046d1fA6C3F78DcBB60b40A9D1cdD9fF861',
    MerchantRegistry: process.env.MERCHANT_REGISTRY_84532 || '0x8f4C6f9472359BF749c12C840c4269341a423c1b',
    Liquidator: process.env.LIQUIDATOR_84532 || '0x621784117C037b3D20AF54e04589818e919e33f3',
    // The co-op's $10 offers, on a capped line of their own. The pre-audit OffersIssuer is retired
    // and none was deployed with the fresh stack, so this stays unset and the offers job and the
    // Command reads stay off. Never point it at OffersIssuerPreAudit.
    OffersIssuer: process.env.OFFERS_ISSUER_84532 || '',
  },
  // Sepolia
  11155111: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
    CLRUSD: process.env.CLRUSD_11155111 || '0x0000000000000000000000000000000000000000',
    ESADepositVault: process.env.ESA_VAULT_11155111 || '0x0000000000000000000000000000000000000000',
    CLRUSDTokenPool: process.env.CLRUSD_POOL_11155111 || '0x0000000000000000000000000000000000000000',
  },
  // Base Mainnet
  8453: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
    CLRUSD: process.env.CLRUSD_8453 || '0x0000000000000000000000000000000000000000',
    ESADepositVault: process.env.ESA_VAULT_8453 || '0x0000000000000000000000000000000000000000',
    CLRUSDTokenPool: process.env.CLRUSD_POOL_8453 || '0x0000000000000000000000000000000000000000',
  },
  // Ethereum Mainnet
  1: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
    CLRUSD: process.env.CLRUSD_1 || '0x0000000000000000000000000000000000000000',
    ESADepositVault: process.env.ESA_VAULT_1 || '0x0000000000000000000000000000000000000000',
    CLRUSDTokenPool: process.env.CLRUSD_POOL_1 || '0x0000000000000000000000000000000000000000',
  },
  // Optimism Mainnet
  10: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
    CLRUSD: process.env.CLRUSD_10 || '0x0000000000000000000000000000000000000000',
    ESADepositVault: process.env.ESA_VAULT_10 || '0x0000000000000000000000000000000000000000',
    CLRUSDTokenPool: process.env.CLRUSD_POOL_10 || '0x0000000000000000000000000000000000000000',
  },
  // Arbitrum One
  42161: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
    CLRUSD: process.env.CLRUSD_42161 || '0x0000000000000000000000000000000000000000',
    ESADepositVault: process.env.ESA_VAULT_42161 || '0x0000000000000000000000000000000000000000',
    CLRUSDTokenPool: process.env.CLRUSD_POOL_42161 || '0x0000000000000000000000000000000000000000',
  },
  // Polygon
  137: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
    CLRUSD: process.env.CLRUSD_137 || '0x0000000000000000000000000000000000000000',
    ESADepositVault: process.env.ESA_VAULT_137 || '0x0000000000000000000000000000000000000000',
    CLRUSDTokenPool: process.env.CLRUSD_POOL_137 || '0x0000000000000000000000000000000000000000',
  },
  // Gnosis
  100: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
    CLRUSD: process.env.CLRUSD_100 || '0x0000000000000000000000000000000000000000',
    ESADepositVault: process.env.ESA_VAULT_100 || '0x0000000000000000000000000000000000000000',
    CLRUSDTokenPool: process.env.CLRUSD_POOL_100 || '0x0000000000000000000000000000000000000000',
  },
};

/**
 * Get contract address for a chain
 * @param chainId - Chain ID
 * @param contractName - Contract name (default: 'DeedNFT')
 * @returns Contract address or null if not deployed
 */
export function getContractAddress(chainId: number, contractName: string = 'DeedNFT'): string | null {
  const chainContracts = DEPLOYED_CONTRACTS[chainId];
  if (!chainContracts) {
    return null;
  }

  const address = chainContracts[contractName];
  if (!address || address === '0x0000000000000000000000000000000000000000') {
    return null;
  }

  return address;
}

export function getClrUsdAddressesByChain(): Array<{ chainId: number; tokenAddress: string }> {
  return Object.entries(DEPLOYED_CONTRACTS)
    .map(([chainId, contracts]) => ({
      chainId: Number(chainId),
      tokenAddress: contracts.CLRUSD || '',
    }))
    .filter(
      (entry) =>
        /^0x[a-fA-F0-9]{40}$/.test(entry.tokenAddress) &&
        entry.tokenAddress !== '0x0000000000000000000000000000000000000000'
    );
}
