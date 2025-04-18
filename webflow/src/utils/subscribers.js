import { store, updateStore } from "../store/appkitStore";
import {
  updateStateDisplay,
  updateTheme,
  updateButtonVisibility,
  updateWalletInfo,
  updateNetworkInfo,
  updateAccountInfo,
  updateBalanceInfo,
  updateNetworkDetails,
  updateAccountDetails,
} from "./dom";
import { getBalance } from '../services/wallet';
import { getUSDPrice } from '../services/price';

// Make store globally accessible
window.store = store;

// Initialize signature state
window.signatureState = {
  signature: null,
  message: "Hello from DeedNFT Platform!",
};

// Initialize Wized
window.Wized = window.Wized || [];
window.Wized.push((Wized) => {
  // Set up initial state
  Wized.data.v = {
    walletStatus: "Not connected",
    walletAddress: window.appKitModal?.getAddress() || null,
    isWalletConnected: !!window.appKitModal?.getAddress(),
    networkName: null,
    chainId: null,
    isNetworkConnected: false,
  };

  // Set up reactivity watcher
  Wized.reactivity.watch(
    () => Wized.data.v,
    () => {
      // This will trigger a re-evaluation of all conditions
      if (Wized.data.updateState) {
        Wized.data.updateState();
      }
    }
  );

  // Helper function to get current wallet address
  Wized.data.getWalletAddress = () => {
    return (
      window.appKitModal?.getAddress() || Wized.data.v.walletAddress || null
    );
  };
});

export const initializeSubscribers = (modal) => {
  // Subscribe to provider changes
  modal.subscribeProviders((state) => {
    updateStore("eip155Provider", state["eip155"]);
    updateWalletInfo(state);
    store.persistState(); // Persist state on provider changes
  });

  // Subscribe to account changes
  modal.subscribeAccount(async (state) => {
    updateStore("accountState", state);
    updateAccountDetails(state);
    store.persistState(); // Persist state on account changes

    const isConnected = state?.status === "connected";
    
    // Handle balance updates
    if (isConnected) {
      const address = state?.allAccounts?.[0]?.address || state?.address;
      if (address) {
        try {
          const balance = await getBalance(store.eip155Provider, address, store.wagmiConfig);
          const network = store.networkState?.caipNetwork;
          const symbol = network?.symbol || 'ETH';
          
          // Get USD price if available
          const chainId = network?.id || 
                         (network?.reference && parseInt(network?.reference.split(':')[1])) || 
                         network?.chainId ||
                         store.networkState?.chainId;
                         
          console.log('Network info:', {
            network,
            chainId,
            networkState: store.networkState,
            id: network?.id,
            reference: network?.reference
          });
          
          const ethPrice = await getUSDPrice(store.eip155Provider, chainId);
          console.log('Price info:', {
            ethPrice,
            balance,
            usdBalance: ethPrice ? balance * ethPrice : null
          });
          
          const usdBalance = ethPrice ? balance * ethPrice : null;
          
          updateBalanceInfo(balance, symbol, true, usdBalance);
        } catch (error) {
          console.error('Error fetching balance or price:', error);
          // Update UI with error state but keep last known values
          updateBalanceInfo(null, null, true, null);
        }
      }
    } else {
      // Reset to default state when disconnected
      updateBalanceInfo(null, null, false);
    }

    // Update Wized state
    window.Wized = window.Wized || [];
    window.Wized.push((Wized) => {
      // Update all values at once to trigger a single reactivity update
      Object.assign(Wized.data.v, {
        walletStatus: state?.status || "Not connected",
        walletAddress:
          state?.allAccounts?.[0]?.address || state?.address || null,
        isWalletConnected: isConnected,
      });
    });
  });

  // Subscribe to network changes
  modal.subscribeNetwork(async (state) => {
    updateStore("networkState", state);
    updateNetworkDetails(state);
    store.persistState(); // Persist state on network changes

    // Update balance when network changes
    if (store.accountState?.status === "connected") {
      const address = store.accountState?.allAccounts?.[0]?.address || store.accountState?.address;
      if (address) {
        try {
          const balance = await getBalance(store.eip155Provider, address, store.wagmiConfig);
          const symbol = state?.caipNetwork?.symbol || 'ETH';
          
          // Get USD price if available
          const chainId = state?.id || 
                         (state?.reference && parseInt(state?.reference.split(':')[1])) || 
                         state?.chainId;
          
          const ethPrice = await getUSDPrice(store.eip155Provider, chainId);
          const usdBalance = ethPrice ? balance * ethPrice : null;
          
          console.log('Updating balance after network change:', balance, symbol, 'USD:', usdBalance);
          updateBalanceInfo(balance, symbol, true, usdBalance);
        } catch (error) {
          console.error('Error fetching balance after network change:', error);
          // Update UI with error state but keep last known values
          updateBalanceInfo(null, null, true, null);
        }
      }
    }

    // Update Wized state
    window.Wized = window.Wized || [];
    window.Wized.push((Wized) => {
      // Update all values at once to trigger a single reactivity update
      Object.assign(Wized.data.v, {
        networkName: state?.caipNetwork?.name || null,
        chainId: state?.chainId || null,
        isNetworkConnected: !!state?.chainId,
      });
    });
  });

  // Subscribe to modal state changes
  modal.subscribeState((state) => {
    store.appKitState = state;
    updateButtonVisibility(modal.getIsConnectedState());
    store.persistState(); // Persist state on modal state changes
  });
};
