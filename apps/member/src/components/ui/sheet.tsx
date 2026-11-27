import * as React from 'react';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { motion, useDragControls, type PanInfo } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Responsive sheet: a bottom sheet on mobile (slides up, rounded top, a pull handle you can drag down to
 * dismiss) and a right-side drawer on desktop. Radix Dialog under the hood (same primitive as our Dialog).
 */
const Sheet = SheetPrimitive.Root;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0', className)}
    {...props}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

function useIsMobile() {
  const [m, setM] = React.useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches);
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> {
  /** Called when the mobile bottom sheet is flung/dragged down past the dismiss threshold. */
  onDismiss?: () => void;
}

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ className, children, onDismiss, ...props }, ref) => {
    const isMobile = useIsMobile();
    const controls = useDragControls();
    const pos = isMobile
      ? 'inset-x-0 bottom-0 max-h-[92vh] rounded-t-2xl border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom'
      : 'inset-y-0 right-0 h-full w-full max-w-[460px] border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right';

    return (
      <SheetPortal>
        <SheetOverlay />
        <SheetPrimitive.Content ref={ref} asChild {...props}>
          <motion.div
            drag={isMobile ? 'y' : false}
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_e, info: PanInfo) => { if (isMobile && (info.offset.y > 110 || info.velocity.y > 500)) onDismiss?.(); }}
            className={cn(
              'fixed z-50 flex flex-col border-border bg-background shadow-xl outline-none duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out',
              pos,
              className,
            )}
          >
            {isMobile && (
              <div className="flex shrink-0 touch-none cursor-grab justify-center pb-1 pt-2.5 active:cursor-grabbing" onPointerDown={(e) => controls.start(e)}>
                <div className="h-1.5 w-10 rounded-full bg-border" />
              </div>
            )}
            {children}
          </motion.div>
        </SheetPrimitive.Content>
      </SheetPortal>
    );
  },
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

export { Sheet, SheetClose, SheetContent };
