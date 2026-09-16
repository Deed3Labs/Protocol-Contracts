import { useEffect, useState } from 'react';
import { ClearMark } from '@/components/clear/brand/icons';
import { cn } from '@/lib/utils';

/** How long a cold start can take before the screen says something about it. */
const SLOW_AFTER_MS = 3000;

/**
 * The splash — a flat ground, the mark, the wordmark, and a hairline that fills.
 *
 * Ink always, never the theme. The OS paints its own splash first, from the manifest's
 * `background_color`, which is a single static value baked in at install: if this one followed the
 * theme, a light-theme member would see ink, then paper, then the app — two colour changes on every
 * cold open, the first of which looks like a fault. Both are #16211D, and the one change left is
 * the app arriving.
 *
 * No gradient and no dependency: the brand has no gradients, and an animated one is the opposite of
 * a mineral page. Opacity is the only entrance, because the guide defines exactly one motion — the
 * dot's ping — and inventing a second for the first screen a member sees sets the wrong expectation
 * for everything after it.
 */
export default function SplashScreen({
  /** Real load progress, 0–100. Omitted means unknown, which is a different screen, not a fake bar. */
  progress,
  /** The app is ready: fade out. The parent unmounts this after the fade. */
  leaving = false,
}: {
  progress?: number;
  leaving?: boolean;
}) {
  // A splash that sits silently for ten seconds reads as a broken app, and the fix is a sentence.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className={cn('c-splash', leaving && 'c-out')} role="status" aria-label="Opening Clear">
      <div className="c-lock">
        <ClearMark outline className="c-mk" />
        <span className="c-swm">Clear</span>
      </div>

      {slow && (
        <div className="c-slow">
          <p className="c-det">Still going. A slow connection, not a problem with your account.</p>
        </div>
      )}

      {progress == null ? (
        <div className="c-waiting">
          <span className="c-splashdot" aria-hidden />
          Opening
        </div>
      ) : (
        <div className="c-load">
          <i style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      )}
    </div>
  );
}
