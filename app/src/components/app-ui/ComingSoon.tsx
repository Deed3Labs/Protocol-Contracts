import { Construction } from 'lucide-react';
import type { ReactNode } from 'react';

/** True only on the live production app — used to hide unfinished pages there while keeping them
 *  visible on the demo/preview for ongoing work. */
export const IS_LIVE_APP = typeof window !== 'undefined' && window.location.hostname === 'app.useclear.org';

/** Animated "coming soon / under construction" panel: pulsing badge + a sliding progress shimmer. */
export function ComingSoon({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center px-6 text-center">
      <style>{`@keyframes cs-slide{0%{transform:translateX(-130%)}100%{transform:translateX(430%)}}`}</style>
      <div className="relative mb-6 flex h-20 w-20 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info/20" />
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-info/15 text-info">
          <Construction className="h-8 w-8 animate-pulse" />
        </span>
      </div>
      <h2 className="font-display text-2xl tracking-tight text-foreground">{title}</h2>
      {subtitle && <p className="mt-2 max-w-sm text-sm text-muted-foreground">{subtitle}</p>}
      <div className="mt-6 h-1.5 w-48 overflow-hidden rounded-full bg-secondary">
        <div className="h-full w-1/4 rounded-full bg-info" style={{ animation: 'cs-slide 1.6s ease-in-out infinite' }} />
      </div>
    </div>
  );
}

/**
 * Gates an unfinished page behind a coming-soon overlay — but ONLY on the live app
 * (app.useclear.org). On the demo/preview the real (work-in-progress) page renders so we can keep
 * building it. Remove the wrapper once the page is wired up.
 */
export function ConstructionGate({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  if (!IS_LIVE_APP) return <>{children}</>;
  return (
    <div className="relative">
      <div aria-hidden className="pointer-events-none select-none opacity-30 blur-[6px]">
        {children}
      </div>
      <div className="absolute inset-0 z-10 flex items-start justify-center">
        <ComingSoon title={title} subtitle={subtitle} />
      </div>
    </div>
  );
}
