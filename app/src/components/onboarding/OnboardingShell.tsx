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
    <div className="mx-auto grid min-h-screen w-full max-w-[840px] grid-cols-1 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden lg:rounded-[14px] lg:border-[0.5px] lg:border-border">
      <div className="hidden flex-col justify-center bg-secondary px-8 py-10 lg:flex">
        <p className="mb-auto text-[15px] font-medium">Clear</p>
        <p className="mb-2 mt-10 text-[26px] font-medium leading-tight tracking-[-0.4px]">
          {headline}
        </p>
        <p className="max-w-[300px] text-[13px] leading-relaxed text-foreground-secondary">{body}</p>
      </div>

      {/* Capped below lg so the form doesn't stretch across a tablet — a single
          column of inputs at 900px reads as a broken layout, not a spacious one. */}
      <div className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col p-5 lg:mx-0 lg:min-h-[420px] lg:max-w-none">
        <p className="mb-5 text-[10px] tracking-[0.3px] text-muted-foreground">
          {eyebrow}
          {eyebrowNote && <span className="text-tier-boost-fg"> {eyebrowNote}</span>}
        </p>
        {children}
      </div>
    </div>
  );
}
