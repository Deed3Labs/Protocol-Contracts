import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isConnected } = useAppKitAuth();
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
  }, [isConnected, hasCheckedOnce]);

  // While checking initially, show nothing (prevent flash)
  if (isChecking && !hasCheckedOnce) {
    return null;
  }

  // If not connected, redirect to login
  if (!isConnected) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If connected, show the protected content
  return <>{children}</>;
}
