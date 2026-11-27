import { cn } from '@/lib/utils';

/**
 * Brand wordmark — "ClearPath" in Bebas Neue (condensed all-caps), matching the
 * marketing site at useclear.org. Size via the className (font-size + color).
 */
export default function Wordmark({ className }: { className?: string }) {
  return (
    <span style={{ lineHeight: 0.8 }} className={cn('inline-block font-wordmark text-foreground', className)}>
      ClearPath
    </span>
  );
}
