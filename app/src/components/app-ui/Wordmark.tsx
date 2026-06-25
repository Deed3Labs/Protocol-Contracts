import { cn } from '@/lib/utils';

/**
 * Brand wordmark — "ClearPath" in Bebas Neue (condensed all-caps), matching the
 * marketing site at useclear.org. Size via the className (font-size + color).
 */
export default function Wordmark({ className }: { className?: string }) {
  return <span className={cn('font-wordmark leading-none text-foreground', className)}>ClearPath</span>;
}
