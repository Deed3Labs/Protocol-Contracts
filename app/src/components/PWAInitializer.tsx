import { useEffect } from 'react';
import { usePeriodicSync } from '@/hooks/usePeriodicSync';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useAppKitAccount } from '@reown/appkit/react';

/**
 * Component to initialize PWA features
 * Should be mounted once at the app root
 */
export function PWAInitializer() {
  const { isConnected } = useAppKitAccount();
  const { register: registerPeriodicSync } = usePeriodicSync();
  const { requestPermission } = usePushNotifications();

  useEffect(() => {
    if (!isConnected) return;

    // Request notification permission
    requestPermission();

    // Register periodic sync for portfolio updates
    registerPeriodicSync('sync-portfolio-periodic', {
      minInterval: 24 * 60 * 60 * 1000, // 24 hours
    });

    // Register periodic sync for price updates
    registerPeriodicSync('sync-prices-periodic', {
      minInterval: 60 * 60 * 1000, // 1 hour
    });
  }, [isConnected, requestPermission, registerPeriodicSync]);

  return null; // This component doesn't render anything
}
