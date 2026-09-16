import type { InstallMode } from '@/lib/installPrompt';

/**
 * The counter path's first step: get Clear onto the home screen before anything else happens.
 *
 * It is first for a reason that outlives the step. Everything after it — the code by text, the
 * bank link, the charge that arrives later — needs somewhere to come back to. A member who
 * finishes signup in a Safari tab they then close has no route back into the flow.
 *
 * The body only. The step's button belongs to the flow's chrome, and what it should say depends on
 * the same mode this renders from — see `installActionLabel`.
 */
export default function AddToHomeScreen({
  shopUrl,
  mode,
}: {
  shopUrl: string;
  mode: InstallMode;
}) {
  return (
    <>
      <div className="c-scanbox">
        <p className="c-det">
          Shop code opens
          <br />
          {shopUrl}
        </p>
      </div>

      {mode === 'ios' ? (
        // iOS has no install API. Safari only offers Share → Add to Home Screen, by hand, and no
        // amount of JavaScript changes that — so the step spends its words on where the button is.
        <p className="c-det mt-s2">
          Tap <strong className="font-medium text-ink">Share</strong> at the bottom of Safari, then{' '}
          <strong className="font-medium text-ink">Add to Home Screen</strong>. No app store, no
          download.
        </p>
      ) : mode === 'installed' ? (
        <p className="c-det mt-s2 text-settled">Clear is already on your home screen.</p>
      ) : (
        <p className="c-det mt-s2">Then Add to Home Screen. No app store, no download.</p>
      )}
    </>
  );
}
