import { useEffect, useState } from 'react';
import { Eye, EyeOff, Copy, Check, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Card from './Card';
import Modal from './Modal';
import ClearCardFace from './ClearCardFace';
import InfoBlock from './InfoBlock';
import type { CardData } from '@/lib/clearModel';

/** How long the details stay on screen before hiding themselves again. */
const REVEAL_SECONDS = 300;

function CopyField({
  label,
  value,
  /** Hidden behind its own toggle even while the rest is revealed. */
  secret,
  last,
}: {
  label: string;
  value: string;
  secret?: boolean;
  last?: boolean;
}) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);

  return (
    <div
      className={`flex items-center justify-between gap-3 py-2 ${last ? '' : 'border-b-[0.5px] border-border'}`}
    >
      <div className="min-w-0">
        <p className="text-xs text-foreground-secondary">{label}</p>
        <p className="mt-[3px] truncate font-mono text-[13px]">
          {shown ? value : '•'.repeat(value.length)}
        </p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        {secret && (
          <Button
            variant="clear"
            size="xs"
            aria-label={shown ? `Hide ${label}` : `Show ${label}`}
            onClick={() => setShown((s) => !s)}
          >
            {shown ? <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />}
          </Button>
        )}
        <Button
          variant="clear"
          size="xs"
          aria-label={`Copy ${label}`}
          onClick={() => {
            navigator.clipboard?.writeText(value).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-tier-savings-fg" strokeWidth={1.75} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </Button>
      </div>
    </div>
  );
}

/**
 * Card details — behind the Details action on Card (spec §9).
 *
 * The full number is shown, but on a timer: it hides itself again after five
 * minutes, so a card left open on a desk doesn't stay readable. The security
 * code takes a second toggle on top of that, because it's the one value that
 * turns a visible number into a usable one.
 *
 * Until issuing is live these are placeholder digits. When it's wired, the real
 * ones have to come from the issuer behind a re-authentication step — they
 * should never sit in page state before the member asks for them.
 */
export default function CardDetailsDialog({
  card,
  open,
  onOpenChange,
}: {
  card: CardData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(REVEAL_SECONDS);
  const revealed = secondsLeft > 0;

  // Restart the countdown each time the surface is opened, and run it down while it's up.
  useEffect(() => {
    if (!open) return;
    setSecondsLeft(REVEAL_SECONDS);
    const tick = setInterval(() => setSecondsLeft((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(tick);
  }, [open]);

  const mins = Math.floor(secondsLeft / 60);
  const secs = String(secondsLeft % 60).padStart(2, '0');

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Card details"
      description="Your full card number, expiry and security code. They hide again automatically."
    >
      <ClearCardFace card={card} revealNumber={revealed} className="mb-3.5" />

      {revealed ? (
        <>
          <Card className="mb-3">
            <CopyField label="Card number" value={card.pan} />
            <CopyField label="Expiry" value={card.expiry} />
            <CopyField label="Security code" value={card.cvc} secret last />
          </Card>

          <InfoBlock tone="neutral" className="mb-3 text-[11px]">
            Details hide again in{' '}
            <strong className="tabular-nums">
              {mins}:{secs}
            </strong>
            . Never share these — Clear will never ask for them.
          </InfoBlock>
        </>
      ) : (
        <Button
          variant="clear"
          size="xs"
          className="mb-3 w-full"
          onClick={() => setSecondsLeft(REVEAL_SECONDS)}
        >
          <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
          Show details
        </Button>
      )}

      <Button variant="clear" size="xs" className="w-full">
        <Wallet className="h-3.5 w-3.5" strokeWidth={1.75} />
        Add to Apple Wallet
      </Button>
    </Modal>
  );
}
