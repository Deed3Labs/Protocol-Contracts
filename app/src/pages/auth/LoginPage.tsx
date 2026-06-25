import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import LoginView from './LoginView';

export default function LoginPage() {
  const { isConnected, isAuthenticated, openModal } = useAppKitAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [hasNavigated, setHasNavigated] = useState(false);

  useEffect(() => {
    // If already connected, route on through (splash handled by App.tsx).
    if (isConnected && isAuthenticated && !hasNavigated) {
      setHasNavigated(true);
      const fromState = location.state as
        | { from?: { pathname?: string; search?: string; hash?: string } }
        | undefined;
      const targetPath = fromState?.from?.pathname || '/';
      const targetSearch = fromState?.from?.search || '';
      const targetHash = fromState?.from?.hash || '';
      const nextRoute = `${targetPath}${targetSearch}${targetHash}`;

      window.dispatchEvent(new Event('wallet-connected'));
      setTimeout(() => {
        navigate(nextRoute, { replace: true });
      }, 100);
    } else if (!isConnected || !isAuthenticated) {
      setHasNavigated(false);
    }
  }, [isAuthenticated, isConnected, location.state, navigate, hasNavigated]);

  return (
    <LoginView
      onGetStarted={() => openModal('Connect')}
      onPreviewOnboarding={() => navigate('/onboarding')}
    />
  );
}
