import { useEffect, useState } from 'react';
import { readInstallMode, subscribeInstallPrompt, type InstallMode } from '@/lib/installPrompt';

/**
 * What the browser will actually let us do about installing, kept current.
 *
 * Three real cases and the difference is not cosmetic: Chromium hands us a prompt, iOS has no
 * install API at all, and "already installed" is the case the reference does not draw but the
 * counter flow meets constantly — the second member at the same counter may already have the app.
 */
export function useInstallMode(): InstallMode {
  const [mode, setMode] = useState<InstallMode>(readInstallMode);

  useEffect(() => {
    const read = () => setMode(readInstallMode());
    const unsubscribe = subscribeInstallPrompt(read);
    // Standalone is a display mode, not an event: a member who installs from the browser's own
    // menu never fires anything we listen for, and comes back through a media-query change.
    const media = window.matchMedia?.('(display-mode: standalone)');
    media?.addEventListener?.('change', read);
    read();
    return () => {
      unsubscribe();
      media?.removeEventListener?.('change', read);
    };
  }, []);

  return mode;
}
