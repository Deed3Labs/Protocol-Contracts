import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { dollars, fromCents, toCents, type StaffRole } from '@clear/domain';
import { Card, PrimaryButton } from '@/shell/ui';

/**
 * The two Staff modals — reference section 08.
 *
 * Neither is a page: they are one decision each, taken from the Staff screen and returning to it.
 * Both slide up from the bottom on a phone and centre on anything wider, like every other modal.
 */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 @[520px]:items-center">
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[20px] border-[0.5px] border-[var(--clear-border)] bg-[var(--clear-surface-2)] p-[1.1rem] pb-[1.6rem] @[520px]:max-w-[340px] @[520px]:rounded-[16px] @[520px]:pb-[1.1rem]">
        <div className="mx-auto mb-[14px] h-1 w-9 rounded-[2px] bg-[var(--clear-border-strong)] @[520px]:hidden" />
        <div className="mb-[14px] flex items-center justify-between">
          <span className="text-[15px] font-medium">{title}</span>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={16} className="text-[var(--clear-text-secondary)]" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, placeholder, onChange, inputMode }: {
  label: string; value: string; placeholder: string;
  onChange: (v: string) => void; inputMode?: 'text' | 'tel';
}) {
  return (
    <div className="mb-2 rounded-[9px] border-[0.5px] border-[var(--clear-border)] bg-[var(--clear-surface-1)] px-[13px] py-[10px]">
      <p className="m-0 mb-[3px] text-[9.5px] uppercase tracking-[0.4px] text-[var(--clear-text-muted)]">{label}</p>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-[var(--clear-text-muted)]"
      />
    </div>
  );
}

function Choice({ name, detail, selected, onClick }: {
  name: string; detail: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className="flex w-full items-center gap-3 border-b-[0.5px] border-[var(--clear-border)] py-[13px] text-left last:border-b-0">
      <span className={`h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px] ${
        selected ? 'border-[var(--clear-text-accent)] bg-[var(--clear-text-accent)]' : 'border-[var(--clear-border-strong)]'
      }`}>
        {selected && <span className="block h-full w-full scale-[0.45] rounded-full bg-[var(--clear-surface-2)]" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px]">{name}</span>
        <span className="mt-0.5 block text-[11.5px] text-[var(--clear-text-muted)]">{detail}</span>
      </span>
    </button>
  );
}

/**
 * Adding someone — name, role, and a PIN they set on first shift.
 *
 * **The owner does not choose the PIN.** A PIN somebody else picked is one they write down, and a
 * written-down PIN makes the staff name on a charge row a guess. So this collects a mobile number
 * and sends a link; the person sets four digits the first time they start a shift.
 */
export function AddSomeoneModal({ onClose, onAdd }: {
  onClose: () => void;
  onAdd: (input: { name: string; mobile: string; role: StaffRole }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [role, setRole] = useState<StaffRole>('counter');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet title="Add someone" onClose={onClose}>
      <Field label="Name" value={name} onChange={setName} placeholder="As it should appear on charges" />
      <Field label="Mobile" value={mobile} onChange={setMobile} placeholder="For their PIN setup link" inputMode="tel" />

      <p className="m-0 mb-1.5 mt-[14px] text-[10px] uppercase tracking-[0.5px] text-[var(--clear-text-muted)]">Role</p>
      {/* Owner is absent: changing who owns the business is not a self-serve action. */}
      <Card className="mb-3 !px-[14px] !py-0">
        <Choice name="Counter" detail="Raise charges. Ask for refunds." selected={role === 'counter'} onClick={() => setRole('counter')} />
        <Choice name="Manager" detail="Also approves refunds and sends payouts" selected={role === 'manager'} onClick={() => setRole('manager')} />
      </Card>

      <Card className="mb-[14px] !px-[13px] !py-[11px]">
        <p className="m-0 text-[11.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
          They will set their own four-digit PIN the first time they start a shift. You can reset it any time.
        </p>
      </Card>

      {error && <p role="alert" className="m-0 mb-2 text-[12.5px] leading-[1.5]">{error}</p>}

      <PrimaryButton
        disabled={busy || !name.trim()}
        onClick={async () => {
          setBusy(true); setError(null);
          try { await onAdd({ name: name.trim(), mobile: mobile.trim(), role }); onClose(); }
          catch (e) { setError(e instanceof Error ? e.message : 'That could not be saved.'); }
          finally { setBusy(false); }
        }}
        className="!py-3 !text-[14px]"
      >
        {busy ? 'Sending…' : 'Send them a link'}
      </PrimaryButton>
    </Sheet>
  );
}

const PRESETS = [
  { cents: 0, label: 'Off' },
  { cents: 25_000, label: '$250' },
  { cents: 50_000, label: '$500' },
  { cents: 100_000, label: '$1,000' },
] as const;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const;

function press(entry: string, key: string): string {
  if (key === 'del') return entry.slice(0, -1);
  if (key === '.') return entry.includes('.') ? entry : `${entry || '0'}.`;
  const [, c] = entry.split('.');
  if (c !== undefined && c.length >= 2) return entry;
  if (!entry.includes('.') && entry.replace('.', '').length >= 7) return entry;
  return entry + key;
}

/**
 * What a manager can approve — reference section 08.
 *
 * The owner sets it, not Clear: it is their money and their staffing. Only the owner can change it
 * and only signed in, or a manager raises their own ceiling and then uses it — a PIN can never
 * raise its own limit. The summary states both sides of the line, because a threshold that only
 * says its own value leaves the owner to infer the consequence.
 */
export function RefundLimitModal({ limitCents, maxCents, onClose, onSave }: {
  limitCents: number | null; maxCents: number | null;
  onClose: () => void; onSave: (cents: number) => Promise<void>;
}) {
  const [entry, setEntry] = useState(limitCents == null || limitCents === 0 ? '' : String(fromCents(limitCents)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cents = entry ? toCents(Number(entry) || 0) : 0;
  const overCap = maxCents !== null && maxCents > 0 && cents > maxCents;
  const [whole, frac] = entry.includes('.') ? entry.split('.') : [entry, ''];
  const shownWhole = whole === '' ? '0' : Number(whole).toLocaleString('en-US');
  const shownFrac = entry.includes('.') ? frac.padEnd(2, '0').slice(0, 2) : '00';

  return (
    <Sheet title="What a manager can approve" onClose={onClose}>
      <p className="m-0 mb-0.5 text-[11px] text-[var(--clear-text-muted)]">A manager can approve refunds up to</p>
      {/* The cents dim to surface-0 in the reference: the dollars are the decision. */}
      <p className="m-0 mb-[3px] text-[34px] font-medium tracking-[-1px] tabular-nums">
        ${shownWhole}<span className="text-[var(--clear-surface-0)]">.{shownFrac}</span>
      </p>
      <p className="m-0 mb-[14px] text-[12px] text-[var(--clear-text-muted)]">Above this, only you can approve</p>

      <div className="mb-[14px] flex gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.label} type="button"
            onClick={() => setEntry(p.cents === 0 ? '' : String(fromCents(p.cents)))}
            className={`flex-1 rounded-[8px] border-[0.5px] py-[7px] text-[12px] ${
              cents === p.cents
                ? 'border-[var(--clear-border-accent)] bg-[var(--clear-bg-accent)] text-[var(--clear-text-accent)]'
                : 'border-[var(--clear-border)] bg-[var(--clear-surface-1)] text-[var(--clear-text-secondary)]'
            }`}>{p.label}</button>
        ))}
      </div>

      <div className="mb-[13px] grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button key={k} type="button" onClick={() => setEntry((e) => press(e, k))}
            aria-label={k === 'del' ? 'Delete' : k}
            className="flex items-center justify-center rounded-[11px] bg-[var(--clear-surface-1)] py-[13px] text-[19px]">
            {k === 'del' ? '⌫' : k}
          </button>
        ))}
      </div>

      <div className="mb-3 rounded-[10px] border-[0.5px] border-[var(--clear-border)] px-[14px] py-3">
        {cents === 0 ? (
          <Line label="Every refund" value="Your PIN or your phone" />
        ) : (
          <>
            <Line label={`Under ${dollars(fromCents(cents))}`} value="A manager's PIN" />
            <Line label={`${dollars(fromCents(cents))} and above`} value="Your PIN or your phone" />
          </>
        )}
        <div className="mt-2 flex justify-between border-t-[0.5px] border-[var(--clear-border)] pt-2 text-[12.5px] leading-[2]">
          <span className="text-[var(--clear-text-secondary)]">Highest you can set</span>
          <span className="tabular-nums">{maxCents === null ? '—' : dollars(fromCents(maxCents))}</span>
        </div>
      </div>

      {(error || overCap) && (
        <p role="alert" className="m-0 mb-2 text-[12.5px] leading-[1.5]">
          {error ?? 'The most you can set is your approval cap.'}
        </p>
      )}

      <PrimaryButton
        disabled={busy || overCap}
        onClick={async () => {
          setBusy(true); setError(null);
          try { await onSave(cents); onClose(); }
          catch (e) { setError(e instanceof Error ? e.message : 'That could not be saved.'); }
          finally { setBusy(false); }
        }}
        className="!py-3 !text-[14px]"
      >{busy ? 'Saving…' : 'Save'}</PrimaryButton>
    </Sheet>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-[12.5px] leading-[2]">
      <span className="text-[var(--clear-text-secondary)]">{label}</span>
      <span>{value}</span>
    </div>
  );
}
