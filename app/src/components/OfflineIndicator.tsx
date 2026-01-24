import { WifiOff, Wifi } from 'lucide-react';
import { useOffline } from '@/hooks/useOffline';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Component to display offline status and queued actions
 */
export function OfflineIndicator() {
  const { isOffline, queuedActions } = useOffline();

  if (!isOffline && queuedActions.length === 0) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50">
      <Alert
        variant={isOffline ? 'destructive' : 'default'}
        className="rounded-none border-x-0 border-t-0"
      >
        <div className="flex items-center gap-2">
          {isOffline ? (
            <>
              <WifiOff className="h-4 w-4" />
              <AlertDescription>
                You're offline. Some features may be limited.
              </AlertDescription>
            </>
          ) : (
            <>
              <Wifi className="h-4 w-4" />
              <AlertDescription>
                {queuedActions.length > 0
                  ? `Syncing ${queuedActions.length} queued action${queuedActions.length > 1 ? 's' : ''}...`
                  : 'Back online'}
              </AlertDescription>
            </>
          )}
        </div>
      </Alert>
    </div>
  );
}
