import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { CFoot, CHead, CMain, Line } from './brand/anatomy';
import { CloseIcon } from './brand/icons';
import { cn } from '@/lib/utils';

/** Matches the `sm` breakpoint the Sheet primitive uses for its bottom-sheet form. */
function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}

/**
 * Opening focus goes to the surface itself, not its first button. Radix otherwise lands on the close
 * control and the app's focus ring draws a box round it before anyone has touched a key. Focus still
 * moves into the modal and stays trapped there; Tab reaches the close as the first stop.
 */
const focusSurface = (e: Event) => {
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.focus();
};

/**
 * Task surface — the guide's `.sheet` / `.modal`. "A component like any other": header, main,
 * footer, with the same edge-to-edge rules as everything on the page.
 *
 * The header is the title and the close. `children` is main. `footer`, when given, is pinned below a
 * rule and holds the consequences and the action, so the thing you are about to do always sits in
 * the same place. `sections` replaces the single main with several stacked ones, for surfaces that
 * group their body (the limit breakdown's secured and unsecured).
 *
 * Centred on desktop, a bottom sheet on mobile, which brings drag-to-dismiss and the grabber with it.
 * The sheet takes the guide's 26px radius; `onBack` swaps the close for a back arrow, for surfaces that
 * read as a sub-view of the page behind them.
 */
export default function Modal({
  open,
  onOpenChange,
  title,
  description,
  onBack,
  children,
  sections,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Screen-reader only context, when the title alone isn't enough. */
  description?: string;
  onBack?: () => void;
  children?: ReactNode;
  /** Several mains, each its own section. Used instead of `children`. */
  sections?: ReactNode[];
  footer?: ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();

  const body = (
    <div className="c-modal c-text">
      <CHead>
        <Line className="items-center!">
          <span className="flex min-w-0 items-center gap-2.5">
            {onBack && (
              <button type="button" aria-label="Back" onClick={onBack} className="c-mclose">
                <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
              </button>
            )}
            <span className="c-mtitle truncate">{title}</span>
          </span>
          {!onBack && (
            <button type="button" aria-label="Close" onClick={() => onOpenChange(false)} className="c-mclose">
              <CloseIcon />
            </button>
          )}
        </Line>
      </CHead>
      {sections ? sections.map((section, i) => <CMain key={i}>{section}</CMain>) : <CMain>{children}</CMain>}
      {footer && <CFoot>{footer}</CFoot>}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          onOpenAutoFocus={focusSurface}
          onDismiss={() => onOpenChange(false)}
          className={cn('rounded-t-[26px] border-ink-28 bg-paper pb-s3 font-text text-ink shadow-none', className)}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {description && <DialogDescription className="sr-only">{description}</DialogDescription>}
          <div className="overflow-y-auto">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={focusSurface}
        className={cn(
          'c-sheet block w-[340px] outline-none max-w-[calc(100vw-32px)] gap-0 rounded-[26px] border-ink-28 bg-paper p-0 font-text shadow-none sm:rounded-[26px]',
          className,
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {description && <DialogDescription className="sr-only">{description}</DialogDescription>}
        {body}
      </DialogContent>
    </Dialog>
  );
}
