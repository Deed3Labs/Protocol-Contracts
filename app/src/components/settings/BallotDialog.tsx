import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Modal from '@/components/clear/Modal';
import type { Ballot } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * The ballot itself.
 *
 * Abstain is an option on the ballot rather than something you do by closing the
 * surface — a recorded abstention and a member who never showed up are different
 * things, and only one of them counts toward turnout.
 *
 * The last line is the warning that matters: this is written to the co-op ledger
 * and can't be taken back, so it's stated before the button, not after.
 */
export default function BallotDialog({
  ballot,
  open,
  onOpenChange,
  onSubmit,
}: {
  ballot: Ballot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit?: (optionId: string) => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Cast your vote"
      description={ballot.question}
    >
      <p className="mb-1 text-[13px]">{ballot.question}</p>
      <p className="mb-3.5 text-xs text-foreground-secondary">
        Closes {ballot.closesOn} · {ballot.voted} of {ballot.members} members have voted
      </p>

      <div className="mb-3.5 flex flex-col gap-2">
        {ballot.options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={choice === option.id}
            onClick={() => setChoice(option.id)}
            className={cn(
              'flex items-center justify-between gap-3 rounded-[10px] border-[0.5px] px-3.5 py-3 text-left text-[13px] transition-colors',
              choice === option.id
                ? 'border-tier-boost text-tier-boost-fg'
                : 'border-border hover:bg-secondary/60',
            )}
          >
            <span className="min-w-0 truncate">{option.label}</span>
            {choice === option.id && (
              <Check aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            )}
          </button>
        ))}
      </div>

      <Button
        size="xs"
        className="w-full"
        disabled={!choice}
        onClick={() => choice && onSubmit?.(choice)}
      >
        Submit vote
      </Button>
      <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
        Your vote is recorded on the co-op ledger and can&rsquo;t be changed after submitting.
      </p>
    </Modal>
  );
}
