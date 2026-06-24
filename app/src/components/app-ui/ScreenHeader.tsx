import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ScreenHeaderProps {
  title: string;
  /** Optional element on the right (avatar, bell, action). */
  action?: ReactNode;
  className?: string;
}

/** Compact top bar shared across the redesigned screens. */
export default function ScreenHeader({ title, action, className }: ScreenHeaderProps) {
  return (
    <header className={cn('flex items-center justify-between pb-5', className)}>
      <h1 className="text-[15px] font-medium text-foreground">{title}</h1>
      {action}
    </header>
  );
}
