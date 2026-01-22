import { createAppKit, useAppKitTheme } from '@reown/appkit/react';
import { WagmiProvider } from 'wagmi';
import { mainnet, base, sepolia, baseSepolia } from '@reown/appkit/networks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { ReownAuthentication } from '@reown/appkit-siwx';
import React from 'react';

const queryClient = new QueryClient();


// Get project ID from environment variable
const projectId = import.meta.env.VITE_APPKIT_PROJECT_ID;

// Validate that we have a project ID
if (!projectId) {
  throw new Error('VITE_APPKIT_PROJECT_ID is required. Please create a .env file with your AppKit project ID.');
}

// Determine the current environment and set the appropriate URL
const getCurrentUrl = () => {
  // Check if we're in a b/ Define custom theme variablesrowser environment
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    const port = window.location.port;
    
    console.log('Current location:', {
      hostname,
      protocol,
      port,
      href: window.location.href
    });
    
    // For development, always use localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
    }
    
    // For production domains, use HTTPS
    if (hostname === 'demo.deed3.io') {
      return import.meta.env.VITE_DEMO_URL || 'https://demo.deed3.io';
    } else if (hostname === 'app.deed3.io') {
      return import.meta.env.VITE_APP_URL || 'https://app.deed3.io';
    } else {
      // Fallback to production for any other environment
      return import.meta.env.VITE_APP_URL || 'https://app.deed3.io';
    }
  }
  
  // For SSR or when window is not available, we need to detect the environment differently
  // Check if we're in a production build
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
    // In production, default to app.deed3.io
    return 'https://app.deed3.io';
  }
  
  // For development builds, default to localhost
  return 'https://app.deed3.io';
};

const currentUrl = getCurrentUrl();
console.log('AppKit Configuration:', {
  projectId,
  currentUrl,
  hostname: typeof window !== 'undefined' ? window.location.hostname : 'server',
  protocol: typeof window !== 'undefined' ? window.location.protocol : 'server',
  port: typeof window !== 'undefined' ? window.location.port : 'server'
});

const metadata = {
  name: 'The Deed Protocol by Deed3Labs',
  description: 'Tokenize your real estate, vehicles, and more.',
  url: currentUrl,
  icons: ['https://avatars.githubusercontent.com/u/179229932']
};

// Only include supported networks
const supportedNetworks = [mainnet, base, sepolia, baseSepolia];

const wagmiAdapter = new WagmiAdapter({
  networks: supportedNetworks,
  projectId,
  ssr: true
});

// Helper function to detect current theme
const getCurrentTheme = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') return 'dark'; // Default for SSR
  
    const saved = localStorage.getItem('theme');
  if (saved === 'dark' || saved === 'light') {
    return saved as 'light' | 'dark';
    }
  
  // Check if dark class is on document
    if (document.documentElement.classList.contains('dark')) {
      return 'dark';
    }
  
  // Check system preference
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  
  return 'light';
};

// Initialize AppKit globally (outside component) to avoid "createAppKit" errors
const initializeAppKit = () => {
  if (typeof window === 'undefined') return;

  const currentUrl = getCurrentUrl();
  const themeMode = getCurrentTheme();
  console.log('Initializing AppKit with URL:', currentUrl, 'Theme:', themeMode);
  
  try {
    createAppKit({
      adapters: [wagmiAdapter],
      networks: supportedNetworks as [typeof mainnet, ...typeof supportedNetworks],
      projectId,
      metadata: {
        ...metadata,
        url: currentUrl
      },
      features: {
        analytics: true,
        email: true,
        socials: ['google', 'x', 'github', 'discord', 'apple', 'facebook', 'farcaster'],
        emailShowWallets: true,
      },
      siwx: new ReownAuthentication(),
      allWallets: 'SHOW',
      themeMode: themeMode
    });
    
    console.log('AppKit initialized successfully');
  } catch (error) {
    console.error('Failed to initialize AppKit:', error);
  }
};

// Call initialization immediately
initializeAppKit();

// Initialize AppKit only after component mounts to avoid SSR issues
// const initializeAppKit = () => {
//   const currentUrl = getCurrentUrl();
//   const themeMode = getCurrentTheme();
//   console.log('Initializing AppKit with URL:', currentUrl, 'Theme:', themeMode);
  
//   try {
//     createAppKit({
//       adapters: [wagmiAdapter],
//       networks: supportedNetworks as [typeof mainnet, ...typeof supportedNetworks],
//       projectId,
//       metadata: {
//         ...metadata,
//         url: currentUrl
//       },
//       features: {
//         analytics: true,
//         email: true,
//         socials: ['google', 'x', 'github', 'discord', 'apple', 'facebook', 'farcaster'],
//         emailShowWallets: true,
//       },
//       siwx: new ReownAuthentication(),
//       allWallets: 'SHOW',
//       themeMode: themeMode
//     });
    
//     console.log('AppKit initialized successfully');
    
//     // Check if custom elements are registered
//     setTimeout(() => {
//       const appkitButton = customElements.get('appkit-button');
//       console.log('AppKit button element registered:', !!appkitButton);
      
//       if (!appkitButton) {
//         console.warn('AppKit button element not found. This might cause issues.');
//       }
//     }, 1000);
    
//   } catch (error) {
//     console.error('Failed to initialize AppKit:', error);
//   }
// };

function AppKitThemeSync() {
  const { setThemeMode } = useAppKitTheme();
  const [currentTheme, setCurrentTheme] = React.useState<'light' | 'dark'>(getCurrentTheme);

  React.useEffect(() => {
    // Set initial theme
    setThemeMode(currentTheme);
  }, [setThemeMode, currentTheme]);

  React.useEffect(() => {
    const updateAppKitTheme = () => {
      const newTheme = getCurrentTheme();
      
      // Only update if theme actually changed
      if (newTheme !== currentTheme) {
        console.log('Theme changed to:', newTheme, '- Updating AppKit theme');
        setCurrentTheme(newTheme);
        setThemeMode(newTheme);
      }
    };

    // Watch for theme class changes on document
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          // Small delay to ensure localStorage is updated
          setTimeout(updateAppKitTheme, 50);
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    // Listen for storage changes (theme toggle in other tabs/windows)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'theme') {
        setTimeout(updateAppKitTheme, 50);
      }
    };

    // Also listen for custom theme change events
    const handleThemeChange = () => {
      setTimeout(updateAppKitTheme, 50);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('themechange', handleThemeChange);

    // Check theme periodically (fallback)
    const interval = setInterval(updateAppKitTheme, 1000);

    return () => {
      observer.disconnect();
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('themechange', handleThemeChange);
      clearInterval(interval);
    };
  }, [currentTheme, setThemeMode]);

  return null; // This component doesn't render anything
}

export function AppKitProvider({ children }: { children: React.ReactNode }) {
  const [isAppKitInitialized, setIsAppKitInitialized] = React.useState(false);

  // Initialize AppKit after component mounts to avoid SSR issues
  React.useEffect(() => {
    // initializeAppKit();
    
    // Wait for AppKit to be ready before using hooks
    const checkAppKitReady = () => {
      const appkitButton = customElements.get('appkit-button');
      if (appkitButton) {
        setIsAppKitInitialized(true);
        return true;
      }
      return false;
    };

    // Check immediately
    if (checkAppKitReady()) {
      return;
    }

    // Poll for AppKit initialization
    const interval = setInterval(() => {
      if (checkAppKitReady()) {
        clearInterval(interval);
      }
    }, 100);

    // Timeout after 5 seconds
    const timeout = setTimeout(() => {
      clearInterval(interval);
      console.warn('AppKit initialization timeout');
      // Set initialized anyway to allow the hook to try
      setIsAppKitInitialized(true);
    }, 5000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);

  // Handle deep links for mobile wallet connections
  React.useEffect(() => {
    const handleDeepLink = () => {
      // Check if we're returning from a mobile wallet
      const urlParams = new URLSearchParams(window.location.search);
      const walletReturn = urlParams.get('wallet');
      
      if (walletReturn) {
        console.log('Deep link return from wallet:', walletReturn);
        // Clear the URL parameters
        window.history.replaceState({}, document.title, window.location.pathname);
        
        // Add a longer delay for mobile wallet returns to ensure provider is ready
        setTimeout(() => {
          console.log('Mobile wallet return detected, ensuring provider is ready');
          // Trigger a custom event that components can listen to
          window.dispatchEvent(new CustomEvent('mobileWalletReturn', { 
            detail: { wallet: walletReturn } 
          }));
        }, 1000);
      }
    };

    // Handle deep link on mount
    handleDeepLink();

    // Listen for URL changes (for SPA navigation)
    const handleUrlChange = () => {
      handleDeepLink();
    };

    window.addEventListener('popstate', handleUrlChange);
    return () => window.removeEventListener('popstate', handleUrlChange);
  }, []);

  // Ensure AppKit modal icons load properly
  React.useEffect(() => {
    // Monitor for AppKit modal and ensure icons load
    const checkModal = () => {
      const modal = (window as any).appKitModal;
      if (modal) {
        console.log('AppKit modal found, ensuring icons load properly');
        
        // Override the open method to ensure icons are loaded
        const originalOpen = modal.open;
        if (originalOpen) {
          modal.open = function(...args: any[]) {
            console.log('AppKit modal opening, ensuring icons load');
            
            // Force icon preloading before opening
            const iconUrls = [
              'https://api.web3modal.com/v2/connector/metamask/icon',
              'https://api.web3modal.com/v2/connector/trust/icon',
              'https://api.web3modal.com/v2/connector/coinbase/icon',
              'https://api.web3modal.com/v2/connector/rainbow/icon',
              'https://api.web3modal.com/v2/connector/google/icon',
              'https://api.web3modal.com/v2/connector/apple/icon',
              'https://api.web3modal.com/v2/connector/facebook/icon',
              'https://api.web3modal.com/v2/connector/x/icon',
              'https://api.web3modal.com/v2/connector/github/icon',
              'https://api.web3modal.com/v2/connector/discord/icon',
              'https://api.web3modal.com/v2/connector/farcaster/icon'
            ];
            
            // Preload icons
            iconUrls.forEach(url => {
              const img = new Image();
              img.src = url;
            });
            
            // Call original open method
            return originalOpen.apply(this, args);
          };
        }
      } else {
        // Retry after a short delay
        setTimeout(checkModal, 500);
      }
    };
    
    checkModal();
  }, []);

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {isAppKitInitialized && <AppKitThemeSync />}
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
} 