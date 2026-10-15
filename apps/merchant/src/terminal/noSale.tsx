import { useState } from 'react';
import type { DrawerDay, DrawerEvent, MerchantApi, NoSaleReason, Staff } from '@clear/merchant-contracts';
import { PinKeys, Sheet, useDigitKeys, cx } from '@/brand/ui';
import { errorSentence } from '@/data/useApi';
import { drawerService } from '@/hardware/drawer';
import { indexedDbStore, type QueueStore } from '@/hardware/queue';
import { Kv, Rows } from '@/settings/views';

/**
 * No sale (terminal reference, section 6): opening the drawer without a sale. A reason, then a PIN:
 * the counter's own if the owner allows everyone, otherwise a manager's or owner's, the same
 * override as refunds. Then the drawer opens and the open is logged against the approval.
 */

const REASONS: { value: NoSaleReason; label: string }[] = [
  { value: 'change_for_note', label: 'Change for a note' },
  { value: 'wrong_change', label: 'Gave wrong change' },
  { value: 'counting', label: 'Counting' },
  { value: 'other', label: 'Something else' },
];

const first = (name: string) => name.split(/\s+/)[0] ?? name;
/** "Ana or Luis", "Ana, Luis or Mike". */
const either = (names: string[]) => (names.length <= 1 ? (names[0] ?? 'A manager') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`);

export function NoSaleSheet({
  asker,
  approvers,
  pinFrom,
  busy,
  error,
  onOpen,
  onClose,
}: {
  /** Who is on the tablet: "Jen". */
  asker: string;
  /** Who can approve, when it needs a manager: Ana and Luis. */
  approvers: string[];
  /** Whose PIN it takes: a manager's, the counter's own, or none. */
  pinFrom: 'manager' | 'own' | 'none';
  busy?: boolean;
  error?: string | null;
  onOpen: (input: { reason: NoSaleReason; note: string | null; pin: string | null }) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<NoSaleReason>('change_for_note');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const needsPin = pinFrom !== 'none';
  const digit = (d: string) => setPin((p) => (p.length < 4 ? p + d : p));
  const back = () => setPin((p) => p.slice(0, -1));
  useDigitKeys(needsPin, digit, back);
  const ready = (!needsPin || pin.length === 4) && (reason !== 'other' || note.trim().length > 0);
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-w420"
      title="Open the drawer"
      onClose={onClose}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">Shows at Close the day as a No sale.</p>
          <button
            type="button"
            className="c-btn c-btn-primary"
            disabled={busy || !ready}
            onClick={() =>
              onOpen({
                reason,
                note: reason === 'other' ? note.trim() : null,
                pin: needsPin ? pin : null,
              })
            }
          >
            {busy ? 'Opening…' : 'Open'}
          </button>
        </div>
      }
    >
      <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
        Why
      </p>
      <div className="c-st-chips">
        {REASONS.map((r) => (
          <button key={r.value} type="button" className={cx('c-btn', reason === r.value && 'c-on')} aria-pressed={reason === r.value} onClick={() => setReason(r.value)}>
            {r.label}
          </button>
        ))}
      </div>
      {reason === 'other' && (
        <input className="c-field c-st-in" style={{ marginTop: 'var(--s1)' }} aria-label="What it was for" placeholder="What it was for" value={note} onChange={(e) => setNote(e.target.value)} />
      )}
      {needsPin && (
        <>
          <p className="c-label c-st-fl">{pinFrom === 'own' ? 'Your PIN' : 'A manager’s PIN'}</p>
          <div className="c-tm-pin" aria-label={`${pin.length} of 4 digits`}>
            {Array.from({ length: 4 }, (_, i) => (
              <i key={i} className={i < pin.length ? 'c-f' : undefined} />
            ))}
          </div>
          {pinFrom === 'manager' && (
            <p className="c-det" style={{ marginTop: 'var(--s1)' }}>
              {asker} asked · {either(approvers.map(first))} can approve here.
            </p>
          )}
          {error && (
            <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginTop: 'var(--s1)' }}>
              {error}
            </p>
          )}
          <PinKeys onDigit={digit} onDelete={back} />
        </>
      )}
      {!needsPin && error && (
        <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginTop: 'var(--s1)' }}>
          {error}
        </p>
      )}
    </Sheet>
  );
}

/** Whose PIN a No sale takes, from the shop's rules and who is on the tablet. */
export function noSalePin(
  settings: {
    noSaleNeedsPin?: boolean;
    drawerNoSaleRoles?: 'managers' | 'anyone';
  },
  role: Staff['role'],
): 'manager' | 'own' | 'none' {
  const everyone = settings.drawerNoSaleRoles === 'anyone';
  const allowed = everyone || role !== 'counter';
  if (settings.noSaleNeedsPin === false && allowed) return 'none';
  return everyone ? 'own' : 'manager';
}

// ---- The drawer's log, from the tablet ---------------------------------------------------------------

/** A drawer event before the tablet stamps it: each kind keeps its own fields. */
export type DrawerEventInput = DrawerEvent extends infer E ? (E extends DrawerEvent ? Omit<E, 'clientId' | 'at'> & { at?: string } : never) : never;

let store: QueueStore | null = null;
const queue = () => (store ??= indexedDbStore());
const clientId = () => `evt_${crypto.randomUUID()}`;

/**
 * Tell the server the drawer opened or shut. Online it goes now; offline (or if the server can't be
 * reached) it waits in the tablet's queue, in order, and goes once (its client id makes it once).
 */
export async function logDrawer(api: Pick<MerchantApi, 'saveDrawerEvents'>, event: DrawerEventInput, opts: { orderKey?: string | null; queueStore?: QueueStore } = {}): Promise<void> {
  const full = {
    ...event,
    clientId: clientId(),
    at: event.at ?? new Date().toISOString(),
  } as DrawerEvent;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new TypeError('offline');
    await api.saveDrawerEvents({ events: [full] });
  } catch (e) {
    if ((e as { status?: number })?.status && (e as { status: number }).status < 500) throw e;
    await (opts.queueStore ?? queue()).add({
      kind: 'drawerEvent',
      event: full,
      orderKey: opts.orderKey ?? null,
    });
  }
}

/** The whole of a No sale: approved by the server, then opened, then logged. */
export async function runNoSale(
  api: Pick<MerchantApi, 'approveNoSale' | 'saveDrawerEvents'>,
  input: {
    drawerId: string;
    staffId: string;
    reason: NoSaleReason;
    note: string | null;
    pin: string | null;
    preview?: boolean;
  },
): Promise<void> {
  const approval = await api.approveNoSale({ reason: input.reason, note: input.note, pin: input.pin }).catch((e) => {
    throw new Error(errorSentence(e));
  });
  await drawerService({ preview: input.preview }).open('no_sale');
  await logDrawer(api, {
    kind: 'opened',
    drawerId: input.drawerId,
    staffId: input.staffId,
    reason: 'no_sale',
    orderId: null,
    noSale: { reason: input.reason, note: input.note },
    approvalId: approval.approvalId,
  });
}

// ---- 6 · Close the day › the drawer --------------------------------------------------------------------

const REASON_WORDS: Record<NoSaleReason, string> = {
  change_for_note: 'change for a note',
  wrong_change: 'gave wrong change',
  counting: 'counting',
  other: 'something else',
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');
const times = (n: number) => (n === 1 ? 'Once' : n === 2 ? 'Twice' : `${n} times`);

/**
 * "Opened today 23 times" and each No sale and key, above the two counts (section 6). Names come
 * from the shop's staff; a No sale's own note ("a $50") reads in place of the reason when it has one.
 */
export function DrawerOpens({ day, nameOf }: { day: DrawerDay; nameOf: (staffId: string) => string }) {
  return (
    <Rows>
      <Kv k="Opened today" v={`${day.opens} time${day.opens === 1 ? '' : 's'}`} ink />
      <Kv k="With a sale" v={String(day.withSale)} ink />
      {day.noSales.map((n, i) => (
        <Kv
          key={i}
          k={`No sale · ${clock(n.at)}`}
          v={`${first(nameOf(n.staffId))}, ${n.reason === 'change_for_note' && n.note ? `change for ${n.note}` : (n.note ?? REASON_WORDS[n.reason])}${n.approvedBy ? ` · ${first(nameOf(n.approvedBy))} approved` : ''}`}
        />
      ))}
      {day.withKey.length > 0 && (
        <Kv k="With the key" v={`${times(day.withKey.length)}${day.withKey[0]?.orderNumber ? ` · order ${String(day.withKey[0].orderNumber).padStart(4, '0')}, drawer didn’t open` : ''}`} />
      )}
    </Rows>
  );
}
