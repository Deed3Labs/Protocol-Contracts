import { pointsWord, type OfferView, type PointsName, type PublicShopApp, type RewardsMe, type RewardView } from '@clear/merchant-contracts';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronSm, ClearMark } from '../icons';
import { useRead } from '../data/context';
import { CLEAR_APP_URL } from '../lib/env';
import { initials, usd } from '../lib/format';

/** The person signed in, for the avatar: "SM". */
export function useInitials(): string | null {
  const { data } = useRead((d) => d.person(), []);
  return data ? initials(data.firstName, data.lastInitial) : null;
}

/**
 * The shop's everyday name: "Mi Casa" for Mi Casa Tacos, "La Bonita" for La Bonita Bakery, the whole
 * name when it's two words. ("Join Mi Casa Rewards", "Texts from Mi Casa".) Derived until shops can
 * set it (rewards DECISIONS, Phase 4).
 */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length >= 3 ? words.slice(0, -1).join(' ') : name;
}

export const Cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const word = (name: PointsName, n: number) => pointsWord(name, n);

export function Row({ t, det, v, className, onClick }: { t: ReactNode; det?: ReactNode; v?: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div className={`sa-r ${className ?? ''}${onClick ? ' tap' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
      <div>
        <p className="t">{t}</p>
        {det !== undefined && det !== null ? <p className="det">{det}</p> : null}
      </div>
      <span className="v">{v}</span>
    </div>
  );
}

export function Sec({ label, det, children, footer, className }: { label?: ReactNode; det?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <div className={`sa-sec ${className ?? ''}`}>
      {label !== undefined ? (
        <div className="sa-h">
          {typeof label === 'string' ? <p className="label">{label}</p> : label}
          {det !== undefined ? <span className="det">{det}</span> : null}
        </div>
      ) : null}
      <div className="sa-m">{children}</div>
      {footer ? <div className="sa-f">{footer}</div> : null}
    </div>
  );
}

/** What's ready, then what's next by how far to go (the Rewards tab's order; Home shows the first two). */
export function rewardRows(me: RewardsMe): Array<{ r: RewardView; ready: boolean; toGo: number }> {
  return [...me.ready.map((r) => ({ r, ready: true, toGo: 0 })), ...me.next.map((r) => ({ r, ready: false, toGo: r.toGo }))];
}

/** The shop's rewards block: its points, or its stamp card; what's ready and what's next. */
export function RewardsBlock({ shop, me, onSeeAll }: { shop: PublicShopApp; me: RewardsMe; onSeeAll: () => void }) {
  const visits = shop.earn.unit === 'visits';
  const many = word(shop.pointsName, 2);
  const rows = rewardRows(me).slice(0, 2);
  return (
    <Sec
      className="sa-brandsec"
      label={visits ? Cap(many) : 'Rewards'}
      det={shop.earn.rate}
      footer={
        <>
          <button className="sa-btn " onClick={onSeeAll}>
            See rewards
          </button>
          <span className="det">{shop.earn.expiry}</span>
        </>
      }
    >
      <p className="sa-pts">
        <b>{me.points}</b>
        <span>{visits ? `of ${shop.earn.cardSize} ${many}` : word(shop.pointsName, me.points)}</span>
      </p>
      {visits && shop.earn.cardSize ? (
        <div className="sa-stamps">
          {Array.from({ length: shop.earn.cardSize }, (_, i) => (
            <i key={i} className={i < me.points ? 'on' : ''} />
          ))}
        </div>
      ) : null}
      <div className="sa-rows">
        {rows.map(({ r, ready, toGo }) => (
          <Row key={r.id} t={r.name} det={`${r.cost} ${word(shop.pointsName, r.cost)}`} v={ready ? <span className="sa-ready">Ready</span> : <span className="det">{toGo} to go</span>} />
        ))}
      </div>
    </Sec>
  );
}

/** The Clear block: always Clear's paper and mark, and it says it's a Clear account. */
export function ClearBlock({ me, balance, onScan, onSetUp, hub }: { me: Pick<RewardsMe, 'clear'>; balance: number | null; onScan: () => void; onSetUp: () => void; hub?: boolean }) {
  if (!me.clear.canPayWithClear) {
    return (
      <div className="sa-sec sa-clear">
        <div className="sa-h">
          <p className="sa-cl">
            <ClearMark width={14} height={14} />
            <span className="label">Clear account</span>
          </p>
          <span className="det">Not set up</span>
        </div>
        <div className="sa-m">
          <p className="t" style={{ margin: 0, fontWeight: 600 }}>
            Pay from a balance, or split a bigger bill
          </p>
          <p className="det" style={{ marginTop: 4 }}>
            A Clear account works at every Clear shop. Your points stay right here.
          </p>
        </div>
        <div className="sa-f">
          <button className="sa-btn k" onClick={onSetUp}>
            Set up Clear
          </button>
          <span className="det">About 3 minutes</span>
        </div>
      </div>
    );
  }
  return (
    <div className="sa-sec sa-clear">
      <div className="sa-h">
        <p className="sa-cl">
          <ClearMark width={14} height={14} />
          <span className="label">Clear balance</span>
        </p>
        <span className="det">Spendable</span>
      </div>
      <div className="sa-m">
        <p className="sa-amt">{balance === null ? '—' : usd(balance)}</p>
        <p className="det">{hub ? 'Your Clear account. Pay at any of these shops from it.' : 'Your Clear account. The same balance in every Clear shop.'}</p>
      </div>
      <div className="sa-f">
        <button className="sa-btn k" onClick={onScan}>
          Scan to pay
        </button>
        <a className="det" href={CLEAR_APP_URL}>
          Open in Clear <ChevronSm />
        </a>
      </div>
    </div>
  );
}

export function OffersBlock({ offers }: { offers: OfferView[] }) {
  // A shop with no offers loses the block, never gets an empty one.
  if (!offers.length) return null;
  return (
    <Sec label="Offers" det={offers.length}>
      <div className="sa-rows">
        {offers.map((o) => (
          <Row key={o.codeId} t={o.title} det={o.detail} v={<span className="det">{o.when}</span>} />
        ))}
      </div>
    </Sec>
  );
}

export function Busy() {
  return <div className="sa-body" aria-busy="true" />;
}

export const ToLink = ({ to, children }: { to: string; children: ReactNode }) => <Link to={to}>{children}</Link>;
