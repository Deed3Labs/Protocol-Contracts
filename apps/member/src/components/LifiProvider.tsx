/**
 * Li.Fi SDK Provider Component
 * Initializes Li.Fi SDK configuration when the app loads
 */

import { useEffect } from 'react';
import '@/lib/lifi'; // Import to initialize Li.Fi config

export function LifiProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Li.Fi SDK is initialized in the lib/lifi.ts file
    // This component ensures the initialization happens
    console.log('Li.Fi SDK initialized');
  }, []);

  return <>{children}</>;
}
