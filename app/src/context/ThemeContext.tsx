import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const initialState: ThemeProviderState = {
  theme: 'dark',
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
  storageKey = 'theme',
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => {
      const stored = localStorage.getItem(storageKey) as Theme;
      if (stored) return stored;
      
      // Fallback to system preference if no storage found
      if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
      
      return defaultTheme;
    }
  );

  useEffect(() => {
    const root = window.document.documentElement;

    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    
    // Dispatch a custom event to notify other components (like AppKitThemeSync)
    window.dispatchEvent(new Event('themechange'));

    // Update manifest and meta tags
    updateManifest(theme);
  }, [theme]);

  // Dynamic Manifest Update
  const updateManifest = (currentTheme: Theme) => {
    const isDark = currentTheme === 'dark';
    const backgroundColor = isDark ? '#0e0e0e' : '#ffffff';
    const themeColor = isDark ? '#0e0e0e' : '#ffffff';

    // 1. Update meta theme-color tags immediately for browser UI
    const metaThemeColors = document.querySelectorAll('meta[name="theme-color"]');
    metaThemeColors.forEach(meta => {
      // If we have specific media query tags, they might handle auto-switching, but for manual override:
      // We can also just set a single one if we want to force it.
      // For now, let's look for one without media or force update based on preference.
      // Best approach for SPA toggle: Remove media query reliance and force the value
      // OR let the existing media query ones be if we rely on system, but we are doing manual toggle.
      // So we should probably update them or add a high-priority one.
      
      // Simpler approach: Find specifically the one active or update all to match current state?
      // Actually, if we use manual toggle, we should force the content.
      meta.setAttribute('content', themeColor);
    });

    // 2. Update Manifest
    const manifestLink = document.querySelector('link[rel="manifest"]');
    if (manifestLink) {
      const manifestUrl = '/manifest.json'; // Base static manifest
      
      fetch(manifestUrl)
        .then(res => res.json())
        .then(manifest => {
          manifest.background_color = backgroundColor;
          manifest.theme_color = themeColor;
          
          const stringManifest = JSON.stringify(manifest);
          const blob = new Blob([stringManifest], {type: 'application/json'});
          const manifestURL = URL.createObjectURL(blob);
          
          manifestLink.setAttribute('href', manifestURL);
        })
        .catch(err => console.error('Failed to update manifest:', err));
    }
  };

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
      // Dispatch a custom event to notify AppKitThemeSync
      window.dispatchEvent(new Event('themechange'));
    },
  };

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider');

  return context;
};

