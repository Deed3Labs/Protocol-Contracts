import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/authContext';
import { CloseDayView } from '@/home/drawer';
import { DAY, DRAWERS } from '@/home/seed';
import { useLayout } from '@/lib/useBreakpoint';

/**
 * Close the day — the Home reference's closing screen, for the last owner or manager out.
 *
 * It needs the day's totals by how they were paid, the two blind counts and their sign-off, which
 * the backend does not keep yet (card-processing prompt, Phase 7). So a live shop is sent back to
 * Home; in development `?drawer=short|signed|balanced` shows the reference scenario.
 */
export default function CloseDayPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const layout = useLayout();
  const [params] = useSearchParams();
  const which = import.meta.env.DEV ? (params.get('drawer') as keyof typeof DRAWERS | null) : null;
  if (!which || !(which in DRAWERS)) return <Navigate to="/" replace />;

  return (
    <CloseDayView
      day={DAY}
      drawer={DRAWERS[which]}
      onShift={session?.staff.name ?? ''}
      twoColumn={layout === 'two-column'}
      onExit={() => navigate('/')}
      onSignOff={() => navigate('/close?drawer=signed')}
      onClose={() => navigate('/')}
    />
  );
}
