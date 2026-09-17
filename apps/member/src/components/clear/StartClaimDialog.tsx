import { useState } from 'react';
import Modal from './Modal';
import { Btn, Line, Rows } from './brand/anatomy';
import { ChevronIcon } from './brand/icons';
import { isAssuranceActive, type AssuranceItem } from '@/lib/clearModel';

/**
 * Start a claim — a modal, because it is an action. Assurance itself is a pane, which is a place.
 *
 * The four reassurances sit under the form rather than after it. A member filing a claim is having
 * a bad day and is about to be asked what happened; what it costs them, when they will hear, and
 * whether it touches their credits are the questions in their head while they type, not afterwards.
 *
 * Nothing is sent until the form is sent, and a failure says so in those words. The one outcome
 * this flow is built against is a claim that looked filed and was not.
 */
export default function StartClaimDialog({
  open,
  onOpenChange,
  items,
  credits,
  onFile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: AssuranceItem[];
  credits: number;
  /** Files the claim. Resolves with an error message, or nothing when it was stored. */
  onFile: (input: { protectionId: string; protectionName: string; detail: string }) => Promise<string | null>;
}) {
  const claimable = items.filter((i) => isAssuranceActive(i, credits));
  const [protectionId, setProtectionId] = useState(claimable[0]?.id ?? '');
  const [choosing, setChoosing] = useState(false);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const chosen = claimable.find((i) => i.id === protectionId) ?? claimable[0];

  const send = async () => {
    if (!chosen || !detail.trim()) return;
    setBusy(true);
    setError(null);
    const failed = await onFile({
      protectionId: chosen.id,
      protectionName: chosen.name,
      detail: detail.trim(),
    });
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    setSent(chosen.name);
  };

  const close = (next: boolean) => {
    if (!next) {
      setSent(null);
      setDetail('');
      setError(null);
      setChoosing(false);
    }
    onOpenChange(next);
  };

  const reassurance = (label: string, value: string) => (
    <div>
      <p className="c-label">{label}</p>
      <p className="text-sec mt-[3px]">{value}</p>
    </div>
  );

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={sent ? 'Claim sent' : 'Start a claim'}
      description={sent ? 'We have it, and somebody will read it.' : 'Tell us what happened and attach anything that helps.'}
      footer={
        sent ? (
          <Btn primary lg onClick={() => close(false)}>
            Done
          </Btn>
        ) : (
          <>
            {error && <p className="c-det c-errline mb-s1">{error}</p>}
            <Btn primary lg disabled={busy || !detail.trim() || !chosen} onClick={() => void send()}>
              {busy ? 'Sending…' : 'Send claim'}
            </Btn>
            <p className="c-det mt-s1">You can add to it while it is open.</p>
          </>
        )
      }
    >
      {sent ? (
        <p className="c-det">
          Your claim on {sent} is with the team. You will hear back in writing, usually the same day
          and always within two.
        </p>
      ) : (
        <>
          <Rows>
            <div>
              <Line className="items-center!">
                <div className="min-w-0">
                  <p className="c-label">Claiming on</p>
                  <p className="text-sec mt-[3px]">{chosen?.name ?? 'Nothing active'}</p>
                </div>
                {/* Only offered when there is a choice to make. */}
                {claimable.length > 1 && (
                  <button
                    type="button"
                    className="c-det flex items-center gap-1 hover:text-ink"
                    onClick={() => setChoosing((was) => !was)}
                  >
                    Change
                    <ChevronIcon />
                  </button>
                )}
              </Line>
              {choosing && (
                <div className="mt-s2 border-t border-ink-13 pt-s2">
                  {claimable.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setProtectionId(item.id);
                        setChoosing(false);
                      }}
                      className="c-line w-full items-center! py-[6px] text-left"
                    >
                      <span className="text-sec">{item.name}</span>
                      {item.id === chosen?.id && <span className="c-det c-pos">Chosen</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Rows>

          <div className="mt-s3">
            <label htmlFor="claim-detail" className="c-label mb-s1 block">
              What happened
            </label>
            <textarea
              id="claim-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Water heater failed on 2 November. Plumber's invoice attached."
              className="w-full resize-none border border-ink-13 bg-transparent p-s2 text-sec text-ink placeholder:text-ink-50 focus:border-ink-28 focus:outline-none"
            />
            <p className="c-det mt-s1">Attach a receipt or photo</p>
          </div>

          <div className="mt-s3 grid grid-cols-2 gap-s2 border-t border-ink-13 pt-s2">
            {reassurance('A decision', 'Usually the same day')}
            {reassurance('If we say yes', 'Paid into your cash account')}
            {reassurance('Your credits', 'Not touched either way')}
            {reassurance('What this costs you', 'Nothing')}
          </div>
        </>
      )}
    </Modal>
  );
}
