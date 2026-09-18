import { useEffect, useState } from 'react';
import Modal from '@/components/clear/Modal';
import { Btn, Rows } from '@/components/clear/brand/anatomy';
import { TickIcon } from '@/components/clear/brand/icons';
import { money } from '@clear/domain';
import { CARD_DISPUTE_REASONS, DISPUTE_KINDS } from '@/data/clearPlaceholder';
import type { CardDisputeReason, DisputeCandidate, DisputeKind } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export interface FileDisputeResult {
  error?: string;
  /** Card disputes: whether the network accepted it. Null for the kinds that never go there. */
  networkFiled?: boolean | null;
}

/**
 * Raise a dispute — an action, so a modal.
 *
 * One payment per kind, the most recent, as the reference draws it: the three kinds are the
 * choice, and each names the payment it would dispute so nobody has to find it first. The footer
 * says what follows before the member commits — who decides and how long it takes — which is the
 * same shape as move money.
 *
 * A card dispute also asks why, in plain words. The network decides on a reason code, and a card
 * dispute sent without one is weaker for it; the member's own words still go with it.
 *
 * Nothing is sent until File dispute, and a failure says so. When the card network does not accept
 * a dispute, the member is told that too — it is still ours and somebody follows up, but "filed with
 * Visa" would be untrue.
 */
export default function RaiseDisputeDialog({
  open,
  onOpenChange,
  candidates,
  onFile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null while loading. */
  candidates: DisputeCandidate[] | null;
  onFile: (input: { kind: DisputeKind; ref: string; detail: string; reason?: CardDisputeReason }) => Promise<FileDisputeResult>;
}) {
  const latest = (kind: DisputeKind) => candidates?.find((c) => c.kind === kind) ?? null;
  const firstAvailable = DISPUTE_KINDS.find((k) => latest(k.kind))?.kind ?? 'card';

  const [kind, setKind] = useState<DisputeKind>(firstAvailable);
  const [reason, setReason] = useState<CardDisputeReason | null>(null);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ kind: DisputeKind; networkFiled: boolean | null } | null>(null);

  // Candidates arrive after the modal opens; start on the first kind that has something to dispute.
  useEffect(() => {
    if (!latest(kind)) setKind(firstAvailable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);

  const info = DISPUTE_KINDS.find((k) => k.kind === kind) ?? DISPUTE_KINDS[0];
  const subject = latest(kind);
  const ready = Boolean(subject && detail.trim() && (kind !== 'card' || reason));

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setDetail('');
      setReason(null);
      setError(null);
      setSent(null);
    }
  };

  const file = async () => {
    if (!subject) return;
    setBusy(true);
    setError(null);
    const result = await onFile({
      kind,
      ref: subject.ref,
      detail: detail.trim(),
      ...(kind === 'card' && reason ? { reason } : {}),
    });
    setBusy(false);
    if (result.error) setError(result.error);
    else setSent({ kind, networkFiled: result.networkFiled ?? null });
  };

  if (sent) {
    const k = DISPUTE_KINDS.find((d) => d.kind === sent.kind) ?? DISPUTE_KINDS[0];
    return (
      <Modal
        open={open}
        onOpenChange={close}
        title="Dispute filed"
        description="We have it, and you will hear what happens next."
        footer={
          <Btn primary lg onClick={() => close(false)}>
            Done
          </Btn>
        }
      >
        <p className="c-det">
          {sent.kind === 'card'
            ? sent.networkFiled
              ? `It has gone to the card network, and Visa’s rules decide it. That usually takes ${k.takes}.`
              : 'We have your dispute, but the card network did not accept it yet. Somebody from Clear will follow up — you do not need to file it again.'
            : `${k.whoDecidesLine} decides it. That usually takes ${k.takes.toLowerCase()}.`}
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title="Raise a dispute"
      description="Choose the payment and tell us what went wrong."
      footer={
        <>
          <div className="c-conseq">
            <div className="c-earn">
              <span>The amount</span>
              <span>Held from today</span>
            </div>
            <div>
              <span>Who decides</span>
              <span>{info.whoDecidesLine}</span>
            </div>
            <div>
              <span>A decision</span>
              <span>{info.takes}</span>
            </div>
            <div className="c-limit">
              <span>Effect on your cycle</span>
              <span>None</span>
            </div>
          </div>
          {error && <p className="c-det c-errline mt-s2">{error}</p>}
          <Btn primary lg className="mt-s2" disabled={busy || !ready} onClick={() => void file()}>
            {busy ? 'Filing…' : 'File dispute'}
          </Btn>
          <p className="c-det mt-s1 text-center">You can withdraw it at any point before a decision.</p>
        </>
      }
    >
      <p className="c-label mb-[6px]">What are you disputing</p>
      <Rows className="mb-s3">
        {DISPUTE_KINDS.map((k) => {
          const c = latest(k.kind);
          const on = k.kind === kind && Boolean(c);
          return (
            <div key={k.kind}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!c}
                onClick={() => setKind(k.kind)}
                className="c-line w-full items-center! text-left disabled:opacity-60"
              >
                <span className="flex min-w-0 items-start gap-3">
                  <span className={cn('c-pick mt-[2px]', on && 'c-on')}>
                    {on && <TickIcon size={12} strokeWidth={3.2} className="text-paper" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sec">{k.title}</span>
                    <span className="c-det mt-[3px] block">
                      {candidates === null
                        ? 'Looking for your payments…'
                        : c
                          ? `${c.label} · ${money(c.amountCents / 100, { cents: true })} · ${shortDate(c.at)}`
                          : 'Nothing to dispute'}
                    </span>
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </Rows>

      {kind === 'card' && subject && (
        <>
          <p className="c-label mb-[6px]">Why</p>
          <div className="mb-s3 grid grid-cols-2 gap-s1">
            {CARD_DISPUTE_REASONS.map((r) => (
              <Btn
                key={r.id}
                className={cn('c-chip-q', reason === r.id && 'c-on')}
                aria-pressed={reason === r.id}
                onClick={() => setReason(r.id)}
              >
                {r.label}
              </Btn>
            ))}
          </div>
        </>
      )}

      <label htmlFor="dispute-detail" className="c-label mb-[6px] block">
        What went wrong
      </label>
      <textarea
        id="dispute-detail"
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Charged twice for the same fitting."
        className="c-field h-[78px]! w-full resize-none py-[10px]! leading-normal text-ink"
      />
    </Modal>
  );
}
