import type { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { cn } from '@/lib/utils';

/**
 * A header menu: a dropdown anchored to its trigger on desktop, a bottom sheet on mobile.
 *
 * The guide draws both as the same `.sheet` — "the same component either way" — so the body is
 * rendered once and only its container changes. The sheet takes the 26px radius the guide gives it.
 */
export default function Surface({
  open,
  onOpenChange,
  width,
  trigger,
  label,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Desktop width, from the guide: 280 for the profile menu, 340 for notifications. */
  width: number;
  /**
   * The button that opens it. Receives the opener: on desktop the popover trigger already toggles,
   * so it is a no-op there and the button must not also set state (it would reopen on close).
   */
  trigger: (open: () => void) => ReactNode;
  /** Screen-reader name for the mobile sheet. */
  label: string;
  children: ReactNode;
}) {
  const isDesktop = useIsDesktop();

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>{trigger(() => {})}</PopoverTrigger>
        <PopoverContent
          onOpenAutoFocus={(e) => {
            // Same reason as Modal: focus the surface, not a ring round its first control.
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
          align="end"
          sideOffset={10}
          style={{ width }}
          className={cn('c-sheet rounded-[26px] outline-none border-ink-28 bg-paper p-0 text-ink shadow-none')}
        >
          <div className="c-modal c-text">{children}</div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <>
      {trigger(() => onOpenChange(true))}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
          aria-label={label}
          aria-describedby={undefined}
          onDismiss={() => onOpenChange(false)}
          className="rounded-t-[26px] border-ink-28 bg-paper pb-s3 text-ink shadow-none"
        >
          <div className="c-modal c-text overflow-y-auto">{children}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
