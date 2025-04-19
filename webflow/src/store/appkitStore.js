export const store = {
    accountState: {},
    networkState: {},
    appKitState: {},
    themeState: { themeMode: 'light', themeVariables: {} },
    events: [],
    walletInfo: {},
    eip155Provider: null,

    // Add methods for state persistence
    persistState() {
        try {
            localStorage.setItem('appkitStore', JSON.stringify({
                accountState: this.accountState,
                networkState: this.networkState,
                appKitState: this.appKitState
            }))
        } catch (error) {
            console.error('Error persisting store state:', error)
        }
    },

    restoreState() {
        try {
            const persistedState = localStorage.getItem('appkitStore')
            if (persistedState) {
                const state = JSON.parse(persistedState)
                this.accountState = state.accountState || {}
                this.networkState = state.networkState || {}
                this.appKitState = state.appKitState || {}
                return true
            }
        } catch (error) {
            console.error('Error restoring store state:', error)
        }
        return false
    },

    clearState() {
        try {
            localStorage.removeItem('appkitStore')
            this.accountState = {}
            this.networkState = {}
            this.appKitState = {}
        } catch (error) {
            console.error('Error clearing store state:', error)
        }
    }
}

export const updateStore = (key, value) => {
    store[key] = value
} 