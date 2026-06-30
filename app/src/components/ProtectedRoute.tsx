import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated } = useAppKitAuth();
  const location = useLocation();
  const [isChecking, setIsChecking] = useState(true);
  const [hasCheckedOnce, setHasCheckedOnce] = useState(false);

  useEffect(() => {
    // Small delay to check connection status, but only once
    if (!hasCheckedOnce) {
      const checkTimer = setTimeout(() => {
        setIsChecking(false);
        setHasCheckedOnce(true);
      }, 200); // Slightly longer delay to ensure connection status is ready

      return () => clearTimeout(checkTimer);
    }
  }, [hasCheckedOnce]);

  // Reset checking state when connection status changes
  useEffect(() => {
    if (hasCheckedOnce) {
      setIsChecking(false);
    }
  }, [isAuthenticated, hasCheckedOnce]);

  // While checking initially, show nothing (prevent flash)
  if (isChecking && !hasCheckedOnce) {
    return null;
  }

  // Gate on AUTHENTICATION (the Privy session), not on having an address. The wallet address (the smart
  // wallet for email/social) is minted asynchronously AFTER login, so requiring it here would bounce a
  // freshly-authenticated user straight back to /login. The address resolves on its own once inside.
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
