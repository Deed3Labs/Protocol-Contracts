import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dusk' | 'dark';

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
  theme: 'light',
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

/** Fresh visitors get a theme by time of day (like useclear.org): light midday, dusk
 * at the golden hours, dark at night. */
function defaultByTime(fallback: Theme): Theme {
  const h = new Date().getHours();
  if (h >= 9 && h < 17) return 'light';
  if ((h >= 6 && h < 9) || (h >= 17 && h < 20)) return 'dusk';
  if (h >= 20 || h < 6) return 'dark';
  return fallback;
}

/**
 * Unpinned: the guide's dark and dusk grounds landed with clear-app-modes, so all three appearances
 * are the guide's own values and the picker means something again.
 *
 * Set this to a theme to pin every member to it — which is what the conversion did while only the
 * light palette had been converted.
 */
export const THEME_PINNED: Theme | null = null;

export function ThemeProvider({ children, defaultTheme = 'light', storageKey = 'theme' }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (THEME_PINNED) return THEME_PINNED;
    const stored = localStorage.getItem(storageKey) as Theme | null;
    if (stored === 'light' || stored === 'dusk' || stored === 'dark') return stored;
    return defaultByTime(defaultTheme);
  });

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('dark', 'dusk');
    if (theme === 'dark') root.classList.add('dark');
    else if (theme === 'dusk') root.classList.add('dusk');

    // Notify other listeners (e.g. AppKitThemeSync).
    window.dispatchEvent(new Event('themechange'));
  }, [theme]);

  const value = {
    theme,
    setTheme: (next: Theme) => {
      if (THEME_PINNED) return;
      localStorage.setItem(storageKey, next);
      setTheme(next);
      window.dispatchEvent(new Event('themechange'));
    },
  };

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>;
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
};
