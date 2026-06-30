import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import LoginView from './LoginView';

export default function LoginPage() {
  // Navigate as soon as the user is AUTHENTICATED — don't also wait for `isConnected` (an address).
  // For email/social users the address is the smart wallet, which Privy mints asynchronously AFTER
  // login, so requiring it left them authenticated-but-stuck on this screen. The address resolves on
  // its own once the app is loaded.
  const { isAuthenticated } = useAppKitAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [hasNavigated, setHasNavigated] = useState(false);

  useEffect(() => {
    if (isAuthenticated && !hasNavigated) {
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
    } else if (!isAuthenticated) {
      setHasNavigated(false);
    }
  }, [isAuthenticated, location.state, navigate, hasNavigated]);

  return (
    <LoginView
      onPreviewOnboarding={() => navigate('/onboarding')}
    />
  );
}
