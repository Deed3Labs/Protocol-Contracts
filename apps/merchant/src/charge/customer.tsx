import { useState, type ReactNode } from 'react';
import { pointsWord, type CounterCustomer, type OrderCustomerState, type PointsName } from '@clear/merchant-contracts';
import { IconScanCode } from '@/brand/chargeIcons';
import { CodeScanner, type CameraState } from '@/charge/CodeScanner';
import { cx, initials, Sheet } from '@/brand/ui';
import { usd } from '@/home/model';

/**
 * The customer at the cart (rewards spec, section 9): a member is added once, by their code or their
 * number, and the counter sees their name, their points here and whether Clear can go straight to
 * them. Never a balance, and nothing from another shop. Joining is always the customer's choice.
 */

/** "Mi Casa" for "Mi Casa Tacos": what the rewards are called (apps/rewards `shortName`). */
export const shortShop = (name: string) => {
  const words = name.trim().split(/\s+/);
  return words.length >= 3 ? words.slice(0, -1).join(' ') : name;
};

export const fullName = (c: Pick<CounterCustomer, 'firstName' | 'lastInitial'>) => `${c.firstName}${c.lastInitial ? ` ${c.lastInitial}.` : ''}`;

const monthDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const month = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long' });

/** "Member since March · last here Oct 12, Table 6"; "Clear member · first time here". */
export function whoLine(c: CounterCustomer): string {
  const last = c.lastVisit ? `last here ${monthDay(c.lastVisit.at)}${c.lastVisit.table ? `, ${c.lastVisit.table}` : ''}` : 'first time here';
  if (c.membership) return `Member since ${month(c.membership.joinedAt)} · ${last}`;
  return `${c.isClearMember ? 'Clear member' : 'New here'} · ${last}`;
}

/** The cart's Customer line before anyone is on it, or while a number waits on their phone. */
export function CustomerAdd({ pending, onScan, onPhone, onCancel }: { pending?: string | null; onScan: () => void; onPhone: () => void; onCancel?: () => void }) {
  if (pending)
    return (
      <div className="c-sa-custadd">
        <div>
          <p className="c-t">Customer</p>
          <p className="c-det">Texted {pending} a link. They show here once they confirm it’s them</p>
        </div>
        <span className="c-pair2">
          <button type="button" className="c-btn c-sm" onClick={onCancel}>
            Cancel
          </button>
        </span>
      </div>
    );
  return (
    <div className="c-sa-custadd">
      <div>
        <p className="c-t">Customer</p>
        <p className="c-det">Add a member for their points and to send Clear straight to them</p>
      </div>
      <span className="c-pair2">
        <button type="button" className="c-btn c-sm c-sa-scanbtn" onClick={onScan}>
          <IconScanCode />
          Scan their code
        </button>
        <button type="button" className="c-btn c-sm" onClick={onPhone}>
          Phone
        </button>
      </span>
    </div>
  );
}

/** Who's on the charge: "Sofia M. · 128 points", "Clear member · Mi Casa Rewards". */
export function CustomerOn({ c, shop, name, onRemove, onOpen }: { c: CounterCustomer; shop: string; name: PointsName; onRemove?: () => void; onOpen?: () => void }) {
  const points = c.membership ? ` · ${c.membership.points} ${pointsWord(name, c.membership.points)}` : '';
  const det = [c.isClearMember ? 'Clear member' : null, c.membership ? `${shortShop(shop)} Rewards` : 'Not joined'].filter(Boolean).join(' · ');
  return (
    <div className="c-sa-cust">
      <span className="c-avatarbtn" style={{ cursor: 'default' }}>
        {initials(fullName(c))}
      </span>
      <div {...(onOpen ? { role: 'button', tabIndex: 0, onClick: onOpen, onKeyDown: (e: React.KeyboardEvent) => e.key === 'Enter' && onOpen(), style: { cursor: 'pointer' } } : {})}>
        <p className="c-t">
          {fullName(c)}
          {points}
        </p>
        <p className="c-det">{det}</p>
      </div>
      {onRemove && (
        <button type="button" className="c-btn c-sm" onClick={onRemove}>
          Remove
        </button>
      )}
    </div>
  );
}

/**
 * The reward line: applied ("Free agua fresca · applied", "75 of their 128 points · on 1 × Jamaica",
 * Undo), or one that's ready and fits the cart, with Apply.
 */
export function RewardLine({ c, name, applied, onApply, onUndo, busy }: { c: CounterCustomer; name: PointsName; applied: { rewardId: string; label: string } | null; onApply: (rewardId: string) => void; onUndo: () => void; busy?: boolean }) {
  const m = c.membership;
  if (!m) return null;
  const word = (n: number) => pointsWord(name, n);
  // The points shown are what's left after promises elsewhere; the one on this order is counted with them.
  const r = applied ? m.readyRewards.find((x) => x.rewardId === applied.rewardId) : m.readyRewards.find((x) => x.matches && !x.locked);
  if (applied) {
    return (
      <div className="c-sa-rwline c-on">
        <div>
          <p className="c-t">{applied.label} · applied</p>
          <p className="c-det">
            {r ? `${r.cost} of their ${m.points} ${word(m.points)}` : 'Taken from their points when it’s paid'}
            {r?.matches ? ` · on ${r.matches.label}` : ''}
          </p>
        </div>
        <button type="button" className="c-btn c-sm" disabled={busy} onClick={onUndo}>
          Undo
        </button>
      </div>
    );
  }
  if (!r) return null;
  return (
    <div className="c-sa-rwline">
      <div>
        <p className="c-t">{r.name} is ready</p>
        <p className="c-det">
          {r.cost} {word(r.cost)} · matches {r.matches!.label} in this cart
        </p>
      </div>
      <button type="button" className="c-btn c-sm c-btn-primary" disabled={busy} onClick={() => onApply(r.rewardId)}>
        Apply
      </button>
    </div>
  );
}

/** Scan their code (frame 6): the camera, and what the code is. */
export function ScanCustomerSheet({ onCode, error, onPhone, onClose }: { onCode?: (raw: string) => boolean; error?: string | null; onPhone: () => void; onClose: () => void }) {
  const [camera, setCamera] = useState<CameraState>('starting');
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-w420"
      title="Scan their code"
      onClose={onClose}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">Or add them by phone number</p>
          <button type="button" className="c-btn" onClick={onPhone}>
            Phone
          </button>
        </div>
      }
    >
      {/* The camera behind the viewfinder; the scanner says why when it can't start. */}
      <div className="c-sa-tvf" style={{ position: 'relative', overflow: 'hidden' }}>
        {onCode && <CodeScanner onCode={onCode} onState={setCamera} />}
        {(!onCode || camera === 'scanning') && (
          <>
            <div className="c-sa-vfbox" style={{ position: 'relative' }} />
            <p style={{ position: 'relative', margin: 0 }}>Point the tablet’s camera at the code on their phone</p>
          </>
        )}
      </div>
      <p className="c-det" style={{ marginTop: 12 }}>
        In the Clear app it’s on Send; in a rewards app it’s Pay › Show my code. It only says who they are: no amount, so it can never move money by itself.
      </p>
      {error && (
        <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginTop: 8 }}>
          {error}
        </p>
      )}
    </Sheet>
  );
}

/** Add them by number: a text with a link they confirm. Nothing shows until they do, whoever it is. */
export function PhoneCustomerSheet({ busy, error, onSend, onClose }: { busy?: boolean; error?: string | null; onSend: (phone: string) => void; onClose: () => void }) {
  const [phone, setPhone] = useState('');
  const ok = phone.replace(/\D/g, '').length >= 10;
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-w420"
      title="Add by phone"
      onClose={onClose}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">They confirm on their phone.</p>
          <button type="button" className="c-btn c-btn-primary" disabled={!ok || busy} onClick={() => onSend(phone)}>
            Text them
          </button>
        </div>
      }
    >
      <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
        Their number
      </p>
      <input className="c-field c-st-in" type="tel" inputMode="tel" autoFocus aria-label="Their number" placeholder="(909) 555-0142" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <p className="c-det" style={{ marginTop: 8 }}>
        We text them a link to confirm it’s them. Nothing about them shows here until they do, so typing a number never says whose it is.
      </p>
      {error && (
        <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginTop: 8 }}>
          {error}
        </p>
      )}
    </Sheet>
  );
}

/**
 * The member, once their code is read (frames 7 and 8): Clear, their points here and what's ready
 * for this cart, or Ask them to join. Adds them to this charge only.
 */
export function MemberSheet({
  state,
  shop,
  name,
  rate,
  applied,
  invited,
  busy,
  error,
  onApply,
  onUndo,
  onInvite,
  onAdd,
  onClose,
}: {
  state: Extract<OrderCustomerState, { status: 'added' }>;
  shop: string;
  name: PointsName;
  /** "1 point per $1" */
  rate: string;
  applied: { rewardId: string } | null;
  invited: boolean;
  busy?: boolean;
  error?: string | null;
  onApply: (rewardId: string) => void;
  onUndo: () => void;
  onInvite: () => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const c = state.customer;
  const m = c.membership;
  const word = (n: number) => pointsWord(name, n);
  const rewardsName = `${shortShop(shop)} Rewards`;
  const Row = ({ t, det, end }: { t: string; det: string; end?: ReactNode }) => (
    <div>
      <div className="c-r2">
        <div>
          <p className="c-t">{t}</p>
          <p className="c-det">{det}</p>
        </div>
        <span className="c-end">{end}</span>
      </div>
    </div>
  );
  const chip = (tone: 'settled' | 'neutral', text: string) => (
    <span className={cx('c-chip', `c-${tone}`)}>
      {tone === 'settled' && <span className="c-core" />}
      {text}
    </span>
  );
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-w460"
      title={fullName(c)}
      onClose={onClose}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">{m || !c.isClearMember ? 'Adds them to this charge only.' : 'A Clear member who hasn’t joined yet.'}</p>
          <button type="button" className="c-btn c-btn-primary" disabled={busy} onClick={onAdd}>
            Add to charge
          </button>
        </div>
      }
    >
      <div className="c-sa-who">
        <span className="c-avatarbtn" style={{ cursor: 'default', width: 44, height: 44 }}>
          {initials(fullName(c))}
        </span>
        <div>
          <p className="c-t">{fullName(c)}</p>
          <p className="c-det">{whoLine(c)}</p>
        </div>
      </div>
      <div className="c-rows" style={{ marginTop: 'var(--s2)' }}>
        {c.isClearMember ? (
          <Row t="Clear" det={c.canPayWithClear ? 'Can pay with Clear. Approves on their phone' : 'Clear can’t go to them today. Card or cash'} end={chip('settled', 'Member')} />
        ) : (
          <Row t="Clear" det="Not on Clear. Card or cash" end={chip('neutral', 'Rewards only')} />
        )}
        {m ? (
          <>
            <Row t={rewardsName} det={`${m.points} ${word(m.points)} · ${rate}`} />
            {m.readyRewards.map((r) => {
              const on = applied?.rewardId === r.rewardId;
              const det = `${r.cost} ${word(r.cost)} · ${r.locked ? 'for Clear members' : r.matches ? `matches ${r.matches.label} in this cart` : 'nothing in this cart fits'}`;
              return (
                <Row
                  key={r.rewardId}
                  t={on ? `${r.name} · applied` : `${r.name} is ready`}
                  det={det}
                  end={
                    on ? (
                      <button type="button" className="c-btn c-sm" disabled={busy} onClick={onUndo}>
                        Undo
                      </button>
                    ) : r.matches && !r.locked && !applied ? (
                      <button type="button" className="c-btn c-sm c-btn-primary" disabled={busy} onClick={() => onApply(r.rewardId)}>
                        Apply
                      </button>
                    ) : null
                  }
                />
              );
            })}
            {m.nextReward && <Row t={m.nextReward.name} det={`${m.nextReward.toGo} ${word(m.nextReward.toGo)} to go`} />}
          </>
        ) : (
          <Row
            t={rewardsName}
            det={invited ? 'Asked on their phone. If they join before they pay, this visit counts' : 'Not joined. Joining is their choice, so it’s asked on their phone'}
            end={
              c.isClearMember ? (
                <button type="button" className="c-btn c-sm" disabled={busy || invited} onClick={onInvite}>
                  {invited ? 'Asked' : 'Ask them to join'}
                </button>
              ) : null
            }
          />
        )}
      </div>
      <p className="c-det" style={{ marginTop: 12 }}>
        {m || !c.isClearMember
          ? `You see their name, points here${c.isClearMember ? ' and whether they can pay with Clear' : ''}. Never their balance, and nothing from other shops.`
          : 'If they join before they pay, this visit earns points; otherwise the paid screen offers it.'}
      </p>
      {error && (
        <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginTop: 8 }}>
          {error}
        </p>
      )}
    </Sheet>
  );
}

/** The cart's small rows once the server has priced it: the reward, the tax at the shop's rate, what it earns. */
export function ServerSmall({ discount, taxCents, taxLabel, earns, word }: { discount: { label: string; cents: number } | null; taxCents: number; taxLabel: string; earns: number | null; word: (n: number) => string }) {
  return (
    <div className="c-ci-small">
      {discount && discount.cents > 0 && (
        <div className="c-kv">
          <span>{discount.label}</span>
          <span className="c-v">&minus;{usd(discount.cents)}</span>
        </div>
      )}
      {taxCents > 0 && (
        <div className="c-kv">
          <span>{taxLabel}</span>
          <span className="c-v">{usd(taxCents)}</span>
        </div>
      )}
      {earns !== null && (
        <div className="c-kv">
          <span>Earns</span>
          <span className="c-v">
            {earns} {word(earns)}
          </span>
        </div>
      )}
    </div>
  );
}
