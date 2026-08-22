import type { ReactNode } from 'react';

/**
 * The onboarding frame — a static brand panel beside the flow on desktop, the
 * flow alone on mobile.
 *
 * The left panel isn't decoration: its copy changes per step to answer the
 * question that step raises. Someone being asked for a phone number wants to
 * know why there's no password; someone being asked for a ZIP wants to know why
 * location matters. Mobile drops it because there's no room to say two things at
 * once, and the step itself has to win.
 */
export default function OnboardingShell({
  eyebrow,
  eyebrowNote,
  headline,
  body,
  children,
}: {
  /** Step marker, e.g. "1 · ENTER". */
  eyebrow: string;
  /** Trailing qualifier shown in the accent color, e.g. "— AT FIRST DEPOSIT". */
  eyebrowNote?: string;
  /** Brand-panel headline for this step. */
  headline: string;
  body: string;
  children: ReactNode;
}) {
  return (
    // Full-bleed at every width — signing in owns the whole screen, rather than
    // floating as a card on a page that isn't there yet.
    <div className="grid min-h-screen w-full grid-cols-1 lg:grid-cols-[minmax(0,1fr)_480px]">
      <div className="hidden flex-col bg-secondary px-12 py-12 lg:flex">
        <p className="text-[15px] font-medium">Clear</p>
        {/* Copy is centred against the pinned wordmark. The reference's panel is
            only ~420px tall, where bottom-aligning reads as balanced; at full
            screen height it just falls to the floor. */}
        <div className="flex flex-1 flex-col justify-center">
          <p className="mb-2 max-w-[440px] text-[26px] font-medium leading-tight tracking-[-0.4px]">
            {headline}
          </p>
          <p className="max-w-[340px] text-[13px] leading-relaxed text-foreground-secondary">
            {body}
          </p>
        </div>
      </div>

      {/* The form column is full-height, but its contents stay at a readable
          measure and sit centred in it rather than stretching to 480px. */}
      <div className="flex min-h-screen flex-col justify-center px-5 py-8 lg:px-12">
        <div className="mx-auto flex w-full max-w-[360px] flex-1 flex-col lg:flex-none">
        <p className="mb-5 text-[10px] tracking-[0.3px] text-muted-foreground">
          {eyebrow}
          {eyebrowNote && <span className="text-tier-boost-fg"> {eyebrowNote}</span>}
        </p>
          {children}
        </div>
      </div>
    </div>
  );
}
