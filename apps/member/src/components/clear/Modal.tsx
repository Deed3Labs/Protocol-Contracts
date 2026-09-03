import { useEffect, useState, type ReactNode } from 'react';
import { X, ArrowLeft } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
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
 * Task surface — centered modal on desktop, bottom sheet on mobile.
 *
 * These are surfaces you go into and come back from, not inline expansions:
 * expanding in place would push the rest of the page around, and on Home it
 * would break the two-column balance.
 *
 * Mobile reuses the Sheet primitive, which brings drag-to-dismiss and the
 * grabber with it. Desktop uses a centered Dialog rather than Sheet's own
 * desktop form, which is a right-hand drawer.
 *
 * `onBack` swaps the close X for a back arrow, for surfaces that read as a
 * sub-view of the page behind them rather than a separate task.
 */
export default function Modal({
  open,
  onOpenChange,
  title,
  description,
  onBack,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Screen-reader only context, when the title alone isn't enough. */
  description?: string;
  onBack?: () => void;
  children: ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();

  const header = (
    <div className="mb-4 flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2.5">
        {onBack && (
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className="shrink-0 text-foreground-secondary transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
        <span className="truncate text-[15px] font-medium">{title}</span>
      </span>
      {!onBack && (
        <button
          type="button"
          aria-label="Close"
          onClick={() => onOpenChange(false)}
          className="shrink-0 text-foreground-secondary transition-colors hover:text-foreground"
        >
          <X className="h-[17px] w-[17px]" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent onDismiss={() => onOpenChange(false)} className={cn('px-5 pb-8 pt-3', className)}>
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {description && <DialogDescription className="sr-only">{description}</DialogDescription>}
          <div className="overflow-y-auto">
            {header}
            {children}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('max-w-[360px] rounded-[14px] p-[17px]', className)}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {description && <DialogDescription className="sr-only">{description}</DialogDescription>}
        {header}
        {children}
      </DialogContent>
    </Dialog>
  );
}
