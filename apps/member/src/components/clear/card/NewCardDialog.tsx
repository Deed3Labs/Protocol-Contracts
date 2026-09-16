import { useEffect, useState } from 'react';
import Modal from '../Modal';
import { Btn, Line, Rows } from '../brand/anatomy';
import CardFace from './CardFace';
import { cn } from '@/lib/utils';

export type CardKind = 'virtual' | 'physical';

/** What came back when a card was made: enough to draw its face and say what happens next. */
export interface NewCardResult {
  kind: CardKind;
  last4: string;
  label?: string;
}

/**
 * New card — three steps, and the first is the only real decision.
 *
 * Both kinds spend from the same limit and the same waterfall, so the choice is only about where
 * the card works, and the first sheet says exactly that rather than selling the difference.
 *
 * The physical review is a shipping review: the address comes from Personal information rather than
 * being typed again, with a line saying that changing it here changes it there — a second address
 * quietly diverging from the identity record is worse than the extra sentence.
 */
export default function NewCardDialog({
  open,
  onOpenChange,
  cardholder,
  expiry,
  network,
  address,
  cardsHeld,
  busy = false,
  error = null,
  result = null,
  onCreate,
  onChangeAddress,
  onSeeDetails,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardholder: string;
  expiry: string;
  network: string;
  /** Where a physical card would go. Null when Personal information has no address yet. */
  address?: { name: string; lines: string } | null;
  cardsHeld: number;
  busy?: boolean;
  error?: string | null;
  /** Set by the container once the card exists; the sheet then shows what happened. */
  result?: NewCardResult | null;
  onCreate?: (kind: CardKind, label: string) => void;
  onChangeAddress?: () => void;
  onSeeDetails?: () => void;
}) {
  const [kind, setKind] = useState<CardKind>('virtual');
  const [step, setStep] = useState<'kind' | 'review'>('kind');
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (open) return;
    // Closed is the only place to reset: doing it on open would wipe the outcome the moment the
    // sheet re-rendered with one.
    setStep('kind');
    setKind('virtual');
    setLabel('');
  }, [open]);

  // ---- Step three: what happened -----------------------------------------------------------------
  if (result) {
    const virtual = result.kind === 'virtual';
    return (
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title=" "
        description={virtual ? 'Your new virtual card is ready.' : 'Your new card is on its way.'}
        footer={
          virtual ? (
            <div className="c-pair">
              <Btn primary onClick={onSeeDetails}>
                See details
              </Btn>
              <Btn onClick={() => onOpenChange(false)}>Done</Btn>
            </div>
          ) : (
            <Btn lg onClick={() => onOpenChange(false)}>
              Done
            </Btn>
          )
        }
      >
        <div className="mb-s3">
          <CardFace
            variant={result.kind}
            frozen={!virtual}
            last4={result.last4}
            cardholder={cardholder}
            expiry={expiry}
            network={network}
            meta={virtual ? `Virtual${result.label ? ` · ${result.label}` : ' · online'}` : `${cardholder} · on its way`}
          />
        </div>
        <p className="c-fig c-fig-sec">{virtual ? 'Card created' : 'Card ordered'}</p>
        <p className="c-det mt-[4px]">{virtual ? 'Ready to use online now' : 'Arrives in 5 to 7 days'}</p>
        <div className="c-conseq mt-s3">
          {virtual ? (
            <>
              <div>
                <span>Number</span>
                <span>Shown in Details</span>
              </div>
              <div>
                <span>Spends from</span>
                <span>The same limit</span>
              </div>
              <div>
                <span>Cards you hold</span>
                <span>{cardsHeld}</span>
              </div>
            </>
          ) : (
            <>
              <div>
                <span>Tracking</span>
                <span>In Card once it ships</span>
              </div>
              <div>
                <span>Arrives</span>
                <span>Frozen until you activate it</span>
              </div>
              <div>
                <span>Your current card</span>
                <span>Keeps working</span>
              </div>
            </>
          )}
        </div>
      </Modal>
    );
  }

  // ---- Step one: which kind ----------------------------------------------------------------------
  if (step === 'kind') {
    const choice = (id: CardKind, title: string, body: string) => (
      <div>
        <button type="button" className="block w-full text-left" onClick={() => setKind(id)}>
          <Line className="items-center!">
            <span className="flex min-w-0 items-start gap-3">
              <span className={cn('c-pick mt-[2px]', kind === id && 'c-on')} aria-hidden />
              <span className="min-w-0">
                <span className="block text-sec">{title}</span>
                <span className="c-det mt-[3px] block">{body}</span>
              </span>
            </span>
          </Line>
        </button>
      </div>
    );

    return (
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="New card"
        description="Choose a virtual or a physical card."
        footer={
          <Btn primary lg onClick={() => setStep('review')}>
            Continue
          </Btn>
        }
      >
        <p className="c-det mb-s2">
          Both spend from the same limit and the same waterfall. What differs is where they work.
        </p>
        <Rows>
          {choice(
            'virtual',
            'Virtual',
            'Online only, issued now, its own number. Freeze or replace it without touching your physical card.',
          )}
          {choice(
            'physical',
            'Physical',
            'Tap, chip and online. Posted to you, and it arrives frozen until you activate it.',
          )}
        </Rows>
      </Modal>
    );
  }

  // ---- Step two: the review ----------------------------------------------------------------------
  if (kind === 'virtual') {
    return (
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="New virtual card"
        description="Name it for yourself, then create it."
        footer={
          <>
            <div className="c-conseq">
              <div className="c-earn">
                <span>Issued</span>
                <span>Now, with its own number</span>
              </div>
              <div>
                <span>Spends from</span>
                <span>The same limit and waterfall</span>
              </div>
              <div>
                <span>Freeze or replace</span>
                <span>Without touching your physical card</span>
              </div>
              <div className="c-limit">
                <span>Cards after this one</span>
                <span>No limit</span>
              </div>
            </div>
            {error && <p className="c-det c-errline mt-s2">{error}</p>}
            <Btn primary lg className="mt-s2" disabled={busy} onClick={() => onCreate?.('virtual', label.trim())}>
              {busy ? 'Creating…' : 'Create card'}
            </Btn>
            <p className="c-det mt-s1 text-center">Nothing is charged for a virtual card.</p>
          </>
        }
      >
        <label className="block">
          <span className="c-label mb-[6px] block">Label</span>
          <input
            className="c-field w-full"
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, 50))}
            placeholder="Subscriptions"
          />
        </label>
        <p className="c-det mt-[6px]">For you only. The shop never sees it.</p>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="New physical card"
      description="Check where it is going, then order it."
      footer={
        <>
          <div className="c-conseq">
            <div className="c-earn">
              <span>Arrives</span>
              <span>In 5 to 7 days</span>
            </div>
            <div>
              <span>Arrives frozen</span>
              <span>Until you activate it</span>
            </div>
            <div>
              <span>Your current card</span>
              <span>Keeps working until then</span>
            </div>
            <div className="c-limit">
              <span>Cost</span>
              <span>None</span>
            </div>
          </div>
          {error && <p className="c-det c-errline mt-s2">{error}</p>}
          <Btn
            primary
            lg
            className="mt-s2"
            disabled={busy || !address}
            onClick={() => onCreate?.('physical', label.trim())}
          >
            {busy ? 'Ordering…' : 'Order card'}
          </Btn>
          <p className="c-det mt-s1 text-center">You can track it in Card once it ships.</p>
        </>
      }
    >
      <p className="c-label mb-[6px]">Deliver to</p>
      <Rows>
        <div>
          <Line className="items-center!">
            <div className="min-w-0">
              <p className="text-sec">{address ? address.name : 'No address on file'}</p>
              <p className="c-det mt-[3px]">
                {address ? address.lines : 'A card cannot be posted until Personal information has one.'}
              </p>
            </div>
            <Btn className="h-[30px]! px-3! text-detail!" onClick={onChangeAddress}>
              {address ? 'Change' : 'Add'}
            </Btn>
          </Line>
        </div>
      </Rows>
      <p className="c-det mt-s2">From your Personal information. Changing it here changes it there too.</p>
    </Modal>
  );
}
