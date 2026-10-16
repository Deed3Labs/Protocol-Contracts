import type { PaySession } from '@clear/merchant-contracts';
import type { CSSProperties, ReactNode } from 'react';
import { onColour } from '../lib/format';
import { money } from '../clear/model';

/**
 * The modal's frame as drawn (pay spec §2): the shop's mark, name and amount, and close; the body;
 * and "Secured by Clear · pay.useclear.org". The shop sets only its colour and logo; everything else
 * is Clear's, so a fake is easier to spot. Under 640px it's the bottom sheet (§4), with its grab line.
 */

const Close = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const Lockup = () => (
  <span className="lockup sm">
    <svg className="mk" viewBox="0 0 336 336" aria-hidden="true">
      <g transform="translate(168 168)" fill="none" stroke="currentColor">
        <path d="M 148.28 -64 A 161.5 161.5 0 1 0 148.28 64 L 74.22 64 A 98 98 0 1 1 74.22 -64 Z" strokeWidth="4" fill="currentColor" />
        <path d="M 0 -8 H 114 V 8 H 0 Z" fill="currentColor" stroke="none" />
        <circle cx="0" cy="0" r="34" fill="currentColor" stroke="none" />
        <circle cx="131.5" cy="0" r="25.25" strokeWidth="15.5" />
      </g>
    </svg>
    <span className="wm">Clear</span>
  </span>
);

export function ModalShell({ session, sheet, onClose, children }: { session: Pick<PaySession, 'shop' | 'order' | 'livemode'>; sheet: boolean; onClose?: () => void; children: ReactNode }) {
  const accent = session.shop.accent;
  const mark = { '--b': accent ?? 'var(--ink)', '--bi': accent ? onColour(accent) : 'var(--paper)', '--bf': 'var(--font-display)' } as CSSProperties;
  return (
    <div className={sheet ? 'pw-modal pay-modal pay-sheet' : 'pw-modal pay-modal'} role="dialog" aria-modal="true" aria-label={`Pay ${session.shop.name} with Clear`}>
      {sheet ? <div className="tm-grab pay-grab" aria-hidden="true" /> : null}
      <div className="pw-mhead">
        <span className="pw-shop">
          {session.shop.logoUrl ? <img className="sa-logo pay-logo" style={mark} src={session.shop.logoUrl} alt="" /> : <span className="sa-logo" style={mark} aria-hidden="true">{session.shop.initials}</span>}
          <b>{session.shop.name}</b>
        </span>
        {session.livemode ? null : <span className="chip pay-test">Test</span>}
        <span className="pw-mamt">{money(session.order.totalCents)}</span>
        {onClose ? (
          <button type="button" className="pw-x" aria-label="Close" onClick={onClose}>
            <Close />
          </button>
        ) : null}
      </div>
      {children}
      <div className="pw-secure">
        <Lockup />
        <span>Secured by Clear · pay.useclear.org</span>
      </div>
    </div>
  );
}
