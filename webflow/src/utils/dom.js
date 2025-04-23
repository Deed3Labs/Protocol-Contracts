export const updateStateDisplay = (selector, state) => {
    const elements = document.querySelectorAll(selector)
    elements.forEach(element => {
        if (element) {
            element.innerHTML = JSON.stringify(state, null, 2)
        }
    })
}

export const updateTheme = mode => {
    document.documentElement.setAttribute('data-theme', mode)
    document.body.className = mode
}

export const updateButtonVisibility = (isConnected) => {
    const connectedOnlyButtons = document.querySelectorAll('[data-connected-only]')
    connectedOnlyButtons.forEach(button => {
        if (!isConnected) button.style.display = 'none'
        else button.style.display = ''
    })
    
    const disconnectedOnlyButtons = document.querySelectorAll('[data-disconnected-only]')
    disconnectedOnlyButtons.forEach(button => {
        if (isConnected) button.style.display = 'none'
        else button.style.display = ''
    })
}

export const updateWalletInfo = (info) => {
    const walletInfoElements = document.querySelectorAll('[data-element="wallet-info"]')
    walletInfoElements.forEach(element => {
        if (element) {
            element.innerHTML = JSON.stringify(info, null, 2)
        }
    })
}

export const updateNetworkInfo = (network) => {
    const networkElements = document.querySelectorAll('[data-element="network-info"]')
    networkElements.forEach(element => {
        if (element) {
            element.innerHTML = JSON.stringify(network, null, 2)
        }
    })
}

export const updateAccountInfo = (account) => {
    const accountElements = document.querySelectorAll('[data-element="account-info"]')
    accountElements.forEach(element => {
        if (element) {
            element.innerHTML = JSON.stringify(account, null, 2)
        }
    })
}

export const updateNetworkDetails = (state) => {
    const networkNameElements = document.querySelectorAll('[data-element="network-name"]')
    const chainIdElements = document.querySelectorAll('[data-element="network-chainid"]')
    const networkStateElements = document.querySelectorAll('[data-element="network-state"]')
    const chainNameElements = document.querySelectorAll('[data-element="network-chainname"]')

    networkNameElements.forEach(element => {
        if (element) {
            element.innerHTML = state?.caipNetwork?.name || 'Select Network'
        }
    })

    chainIdElements.forEach(element => {
        if (element) {
            element.innerHTML = state?.chainId || element.innerHTML
        }
    })

    networkStateElements.forEach(element => {
        if (element) {
            element.innerHTML = JSON.stringify(state, null, 2)
        }
    })

    chainNameElements.forEach(element => {
        if (element) {
            element.innerHTML = state?.caipNetwork?.name || 'Select Network'
        }
    })
}

export const updateAccountDetails = (state) => {
    const addressElements = document.querySelectorAll('[data-element="account-address"]')
    const statusElements = document.querySelectorAll('[data-element="account-status"]')
    const accountStateElements = document.querySelectorAll('[data-element="account-state"]')

    addressElements.forEach(element => {
        if (element) {
            const address = state?.allAccounts?.[0]?.address || state?.address
            element.innerHTML = address || element.innerHTML
        }
    })

    statusElements.forEach(element => {
        if (element) {
            const status = state?.status
            element.innerHTML = status || element.innerHTML
        }
    })

    accountStateElements.forEach(element => {
        if (element) {
            element.innerHTML = JSON.stringify(state, null, 2)
        }
    })
}

export const updateBalanceInfo = (balance, symbol, isConnected = true, usdBalance = null) => {
    const balanceElements = document.querySelectorAll('[data-element="balance-state"]')
    const balanceSections = document.querySelectorAll('[data-element="balance-section"]')
    const tokenSymbolElements = document.querySelectorAll('[data-element="balance-symbol"]')
    const usdBalanceElements = document.querySelectorAll('[data-element="balance-usd"]')
    const usdSymbolElements = document.querySelectorAll('[data-element="balance-usd-symbol"]')
    
    if (!isConnected) {
        balanceElements.forEach(element => {
            if (element) element.textContent = '0.00000'
        })
        tokenSymbolElements.forEach(element => {
            if (element) element.textContent = 'ETH'
        })
        usdBalanceElements.forEach(element => {
            if (element) element.textContent = '0.00'
        })
        usdSymbolElements.forEach(element => {
            if (element) element.textContent = 'USD'
        })
        return
    }
    
    if (balance !== undefined) {
        const formattedBalance = Number(balance) < 1 
            ? Number(balance).toFixed(5)
            : Number(balance).toFixed(4)
        balanceElements.forEach(element => {
            if (element) element.textContent = formattedBalance
        })
    }
    
    balanceSections.forEach(element => {
        if (element) element.style.display = ''
    })
    
    if (symbol) {
        tokenSymbolElements.forEach(element => {
            if (element) element.textContent = symbol
        })
    }

    if (usdBalance !== null) {
        const formattedUsdBalance = Number(usdBalance).toFixed(2)
        usdBalanceElements.forEach(element => {
            if (element) element.textContent = formattedUsdBalance
        })
    }
} 