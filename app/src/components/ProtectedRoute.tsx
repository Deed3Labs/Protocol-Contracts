import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import SplashScreen from './SplashScreen';
import { AnimatePresence } from 'framer-motion';

interface ProtectedRouteProps {
  children: React.ReactNode;
  showSplashOnMount?: boolean;
}

export default function ProtectedRoute({ children, showSplashOnMount = false }: ProtectedRouteProps) {
  const { isConnected } = useAppKitAuth();
  const location = useLocation();
  const [showSplash, setShowSplash] = useState(showSplashOnMount);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    // Small delay to check connection status
    const checkTimer = setTimeout(() => {
      setIsChecking(false);
    }, 100);

    return () => clearTimeout(checkTimer);
  }, []);

  useEffect(() => {
    if (showSplashOnMount) {
      // Show splash for 2 seconds when redirecting after login/logout
      const timer = setTimeout(() => {
        setShowSplash(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [showSplashOnMount]);

  // If showing splash, show splash screen
  if (showSplash) {
    return (
      <AnimatePresence>
        <SplashScreen />
      </AnimatePresence>
    );
  }

  // While checking, show nothing (prevent flash)
  if (isChecking) {
    return null;
  }

  // If not connected, redirect to login
  if (!isConnected) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If connected, show the protected content
  return <>{children}</>;
}
