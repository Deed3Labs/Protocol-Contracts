// Reown AppKit Wallet Connection Module
// This file handles wallet connection and authentication

import { createAppKit } from '@reown/appkit'
import { mainnet, arbitrum, base, sepolia, arbitrumSepolia, baseSepolia } from '@reown/appkit/networks'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { CloudAuthSIWX } from '@reown/appkit-siwx'
import { initializeForm } from './form-handler'
import { initializeSubscribers } from './utils/subscribers'
import { store } from './store/appkitStore'
import { updateTheme, updateButtonVisibility } from './utils/dom'
import { signMessage, getBalance } from './services/wallet'

// 1. Get project ID from Reown Cloud
const projectId = '2a15f8a7329ae7eae3e6bbadc527457f'

// 2. Configure networks (including testnets)
export const networks = [mainnet, arbitrum, base, sepolia, arbitrumSepolia, baseSepolia]

// 3. Set up Wagmi adapter with persistence
const wagmiAdapter = new WagmiAdapter({
    projectId,
    networks,
    autoConnect: true, // Enable auto-connection
    persistConnectors: true, // Enable connector persistence
    storage: window.localStorage // Use localStorage for persistence
})

// 4. Configure metadata
const metadata = {
    name: 'The Deed Protocol',
    description: 'Mint and Manage On-Chain Deeds',
    url: window.location.origin,
    icons: ['https://your-domain.com/icon.png']
}

// 5. Create or get existing modal instance
let modal = window.appKitModal;

if (!modal) {
    modal = createAppKit({
        adapters: [wagmiAdapter],
        networks,
        metadata,
        projectId,
        features: {
            analytics: true,
            siwx: new CloudAuthSIWX(),
            email: true,
            socials: ['google', 'x', 'github', 'discord', 'apple', 'facebook', 'farcaster'],
            emailShowWallets: true,
        },
        allWallets: 'SHOW',
        persistConnections: true, // Enable connection persistence
        storage: window.localStorage // Use localStorage for persistence
    });

    // Make modal globally available
    window.appKitModal = modal;

    // Initialize subscribers only once
    initializeSubscribers(modal);
}

// 6. Check for existing connection and restore state
const checkExistingConnection = async () => {
    try {
        const isConnected = modal.getIsConnectedState()
        if (isConnected) {
            // Restore network state
            const currentNetwork = await modal.getCurrentNetwork()
            if (currentNetwork) {
                store.networkState = currentNetwork
            }
            // Restore account state
            const currentAccount = await modal.getCurrentAccount()
            if (currentAccount) {
                store.accountState = currentAccount
            }
        }
        updateButtonVisibility(isConnected)
    } catch (error) {
        console.error('Error restoring connection state:', error)
    }
}

// 7. Set up button listeners
const openConnectModalBtn = document.querySelector('[data-element="connect-wallet"]')
const openNetworkModalBtn = document.querySelector('[data-element="switch-network"]')
const disconnectWalletBtn = document.querySelector('[data-element="disconnect-wallet"]')
const signMessageBtn = document.querySelector('[data-element="sign-message"]')

if (openConnectModalBtn) {
    openConnectModalBtn.addEventListener('click', () => modal.open())
}

if (openNetworkModalBtn) {
    openNetworkModalBtn.addEventListener('click', () => modal.open({ view: 'Networks' }))
}

if (disconnectWalletBtn) {
    disconnectWalletBtn.addEventListener('click', async () => {
        await modal.disconnect()
        // Clear persisted state
        localStorage.removeItem('wagmi.wallet')
        localStorage.removeItem('wagmi.connected')
        store.clearState() // Clear our store state as well
    })
}

if (signMessageBtn) {
    signMessageBtn.addEventListener('click', async () => {
        const signature = await signMessage(store.eip155Provider, store.accountState.address)
        const signatureElement = document.querySelector('[data-signature-state]')
        const signatureSection = document.querySelector('[data-signature-section]')
        if (signatureElement) signatureElement.innerHTML = signature
        if (signatureSection) signatureSection.style.display = ''
    })
}

// Set initial theme
updateTheme(store.themeState.themeMode)

// Initialize form and check connection when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initializeForm()
    checkExistingConnection()
}) 