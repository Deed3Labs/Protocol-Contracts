import type { PublicLink } from '@clear/merchant-contracts';
import type { CSSProperties, ReactNode } from 'react';
import { money, onColour, shortDate } from '@/lib/format';
import { linkDetail, type LinkStep } from './model';

/**
 * The link page as drawn (pay spec §5, "The link page"): the shop's mark and name, what it comes to,
 * and the ways to pay. The shop's colour is the accent on its mark; everything else is Clear's.
 */
export interface LinkViewProps {
  link: PublicLink;
  step: LinkStep;
  /** While waiting: which way, and the Clear page to open again. */
  waitingOn?: 'clear' | 'card' | null;
  clearUrl?: string | null;
  busy?: 'clear' | 'card' | null;
  error?: string | null;
  onPay?: (method: 'clear' | 'card') => void;
}

export function ShopFrame({ shop, children }: { shop: PublicLink['shop'] | null; children: ReactNode }) {
  const style = {
    '--b': shop?.accent ?? 'var(--ink)',
    '--bi': shop?.accent ? onColour(shop.accent) : 'var(--paper)',
    '--bf': 'var(--font-display)',
    '--bp': 'var(--paper)',
  } as CSSProperties;
  return (
    <main className="sa-ph pay-page" style={style}>
      <header className="sa-top">
        {shop ? (
          <span className="sa-brand">
            {shop.logoUrl ? <img className="sa-logo pay-logo" src={shop.logoUrl} alt="" /> : <span className="sa-logo" aria-hidden="true">{shop.initials}</span>}
            <span className="sa-name">{shop.name}</span>
          </span>
        ) : (
          <span className="sa-brand">
            <span className="sa-name">Clear</span>
          </span>
        )}
      </header>
      <div className="sa-body">{children}</div>
    </main>
  );
}

export function LinkView({ link, step, waitingOn = null, clearUrl = null, busy = null, error = null, onPay }: LinkViewProps) {
  const total = money(link.order.totalCents);
  const head = (label: string) => (
    <div className="sa-m">
      <p className="sa-mono">{label}</p>
      <p className="sa-amt big">{total}</p>
      <p className="det">{linkDetail(link)}</p>
    </div>
  );
  const err = error ? (
    <p className="det pay-err" role="alert">
      {error}
    </p>
  ) : null;

  if (step === 'paid') {
    return (
      <ShopFrame shop={link.shop}>
        {head('Paid')}
        <div className="sa-m" role="status">
          <p className="sa-title">You’re all set</p>
          <p className="det">{link.shop.name} has your order.</p>
        </div>
      </ShopFrame>
    );
  }

  if (step === 'expired' || step === 'inactive') {
    return (
      <ShopFrame shop={link.shop}>
        {link.order.lines.length ? head(`Pay ${link.shop.name}`) : null}
        <div className="sa-m" role="status">
          <p className="sa-title">{step === 'expired' ? 'This link has expired' : 'This link has been turned off'}</p>
          <p className="det">Ask {link.shop.name} for a new one.</p>
        </div>
      </ShopFrame>
    );
  }

  if (step === 'waiting') {
    return (
      <ShopFrame shop={link.shop}>
        {head(`Pay ${link.shop.name}`)}
        <div className="sa-m" role="status" aria-live="polite">
          <span className="chip underway">
            <span className="core" />
            {waitingOn === 'card' ? 'Confirming your card' : 'Waiting for Clear'}
          </span>
          <p className="det pay-gap">
            {waitingOn === 'card' ? 'This page moves on by itself.' : 'Approve it in the Clear tab that opened. This page moves on by itself.'}
          </p>
          {waitingOn === 'clear' && clearUrl ? (
            <a className="sa-btn wide pay-a" href={clearUrl} target="_blank" rel="noopener">
              Open Clear again
            </a>
          ) : null}
          {err}
        </div>
      </ShopFrame>
    );
  }

  return (
    <ShopFrame shop={link.shop}>
      {head(`Pay ${link.shop.name}`)}
      <div className="sa-m">
        <button type="button" className="sa-btn k wide" disabled={busy !== null} onClick={() => onPay?.('clear')}>
          Pay with Clear
        </button>
        {link.methods.card ? (
          <button type="button" className="sa-btn wide" disabled={busy !== null} onClick={() => onPay?.('card')}>
            Pay by card
          </button>
        ) : null}
        {link.expiresAt ? <p className="sa-sub">Expires {shortDate(link.expiresAt)}</p> : null}
        {err}
      </div>
    </ShopFrame>
  );
}

/** An address with no link behind it. */
export function NoLink() {
  return (
    <ShopFrame shop={null}>
      <div className="sa-m" role="status">
        <p className="sa-title">There’s no payment at this address</p>
        <p className="det">Check the link, or ask the shop for a new one.</p>
      </div>
    </ShopFrame>
  );
}
