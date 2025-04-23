export const signMessage = async (provider, address) => {
    if (!provider || !address) return null
    
    try {
        const message = window.signatureState.message
        const signature = await provider.request({
            method: 'personal_sign',
            params: [message, address]
        })
        // Store signature in global state
        window.signatureState.signature = signature
        return signature
    } catch (error) {
        console.error('Error signing message:', error)
        window.signatureState.signature = null
        return null
    }
}

export const getBalance = async (provider, address, config) => {
    if (!provider || !address) return '0'
    
    try {
        const balance = await provider.request({
            method: 'eth_getBalance',
            params: [address, 'latest']
        })
        return (parseInt(balance, 16) / 1e18).toString()
    } catch (error) {
        console.error('Error getting balance:', error)
        return '0'
    }
} 