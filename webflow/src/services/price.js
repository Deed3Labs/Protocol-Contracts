import { ethers } from 'ethers'

// Chainlink Price Feed ABI (only what we need)
const PRICE_FEED_ABI = [
  {
    inputs: [],
    name: "latestRoundData",
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" }
    ],
    stateMutability: "view",
    type: "function"
  }
]

// Chainlink Price Feed addresses for ETH/USD
const PRICE_FEEDS = {
  // Mainnet
  '1': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
  // Arbitrum
  '42161': '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
  // Base
  '8453': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
  // Sepolia
  '11155111': '0x694AA1769357215DE4FAC081bf1f309aDC325306',
  // Arbitrum Sepolia
  '421614': '0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165',
  // Base Sepolia
  '84532': '0x4aDC67696bA383F43DD60A9dB4F707787dF1383D'
}

// RPC URLs for each network
const RPC_URLS = {
  '1': 'https://eth.llamarpc.com',
  '42161': 'https://arb1.arbitrum.io/rpc',
  '8453': 'https://mainnet.base.org',
  '11155111': 'https://eth-sepolia.g.alchemy.com/v2/demo',
  '421614': 'https://sepolia-rollup.arbitrum.io/rpc',
  '84532': 'https://sepolia.base.org'
}

// Simple cache to avoid too many requests
const priceCache = {
  timestamp: 0,
  price: null
}

// Cache duration in milliseconds (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000

export const getUSDPrice = async (provider, chainId) => {
  try {
    // Check cache first
    const now = Date.now()
    if (priceCache.price && (now - priceCache.timestamp) < CACHE_DURATION) {
      console.log('Using cached price:', priceCache.price)
      return priceCache.price
    }

    // Clean up chainId (remove any non-numeric characters)
    const cleanChainId = chainId?.toString().replace(/[^0-9]/g, '')
    console.log('Getting price for chain:', cleanChainId)

    const priceFeedAddress = PRICE_FEEDS[cleanChainId]
    if (!priceFeedAddress) {
      console.warn('No price feed available for chain:', cleanChainId)
      // For testnets without price feeds, return a mock price
      if (cleanChainId === '11155111' || cleanChainId === '421614' || cleanChainId === '84532') {
        return 2000 // Mock price for testnets
      }
      return null
    }

    // Create a JsonRpcProvider for the specific network
    const rpcUrl = RPC_URLS[cleanChainId]
    if (!rpcUrl) {
      console.warn('No RPC URL available for chain:', cleanChainId)
      return null
    }

    const jsonRpcProvider = new ethers.JsonRpcProvider(rpcUrl)
    const priceFeed = new ethers.Contract(priceFeedAddress, PRICE_FEED_ABI, jsonRpcProvider)
    console.log('Fetching price from:', priceFeedAddress)
    
    const [roundId, answer, startedAt, updatedAt] = await priceFeed.latestRoundData()
    console.log('Price feed response:', { roundId, answer, startedAt, updatedAt })
    
    // Chainlink price feeds for ETH/USD use 8 decimals
    const price = Number(answer) / 1e8
    
    // Update cache
    priceCache.price = price
    priceCache.timestamp = now
    
    return price
  } catch (error) {
    console.error('Error fetching USD price:', error)
    // Return cached price if available
    if (priceCache.price) {
      console.log('Using stale cached price:', priceCache.price)
      return priceCache.price
    }
    return null
  }
} 