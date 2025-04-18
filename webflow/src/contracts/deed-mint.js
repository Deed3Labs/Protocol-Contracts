// DeedNFT Minting Module
// This file handles the minting of DeedNFTs using the FundManager contract

import { writeContract } from '@wagmi/core'
import FundManagerABI from './abis/FundManager.json'

// Contract addresses for different networks
const CONTRACT_ADDRESSES = {
    mainnet: 'YOUR_MAINNET_ADDRESS',
    arbitrum: 'YOUR_ARBITRUM_ADDRESS',
    base: 'YOUR_BASE_ADDRESS',
    sepolia: 'YOUR_SEPOLIA_ADDRESS',
    arbitrumSepolia: 'YOUR_ARBITRUM_SEPOLIA_ADDRESS',
    baseSepolia: 'YOUR_BASE_SEPOLIA_ADDRESS'
}

// AssetType enum from DeedNFT contract
const AssetType = {
    Land: 0,
    Vehicle: 1,
    Estate: 2,
    CommercialEquipment: 3
}

// Mint function using Wagmi
export async function mintDeed(formData) {
    try {
        const { hash } = await writeContract({
            address: CONTRACT_ADDRESSES.mainnet, // or use dynamic network detection
            abi: FundManagerABI,
            functionName: 'mintDeedNFT',
            args: [
                formData.owner || formData.recipient, // owner address
                formData.assetType || AssetType.Land, // asset type from enum
                formData.ipfsDetailsHash, // IPFS hash containing metadata
                formData.definition, // deed definition
                formData.configuration || '', // optional configuration
                formData.validatorAddress || null, // optional validator address
                formData.token, // payment token address
                formData.salt || 0 // optional salt for deterministic token ID
            ]
        })

        // Dispatch event for Wized integration
        window.dispatchEvent(new CustomEvent('deedMinted', {
            detail: { 
                transactionHash: hash,
                owner: formData.owner || formData.recipient,
                assetType: formData.assetType,
                ipfsDetailsHash: formData.ipfsDetailsHash
            }
        }))

        return hash
    } catch (error) {
        console.error('Failed to mint DeedNFT:', error)
        throw error
    }
}

// Read deed details using Wagmi
export async function getDeedDetails(deedId) {
    try {
        const data = await readContract({
            address: CONTRACT_ADDRESSES.mainnet,
            abi: FUND_MANAGER_ABI,
            functionName: 'getDeed',
            args: [deedId]
        })
        return data
    } catch (error) {
        console.error('Failed to get deed details:', error)
        throw error
    }
}

// Make functions globally available for Webflow
window.DeedNFT = {
    mintDeed,
    getDeedDetails,
    AssetType // Expose AssetType enum for form selection
} 