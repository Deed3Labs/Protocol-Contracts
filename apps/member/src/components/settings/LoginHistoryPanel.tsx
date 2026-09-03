import { Button } from '@/components/ui/button';
import InfoBlock from '@/components/clear/InfoBlock';
import type { LoginEvent } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Every sign-in, with what it was signed in with.
 *
 * The method matters as much as the device: with no password, "Face ID" and
 * "Code" are two different levels of proof, and a code sign-in from an unfamiliar
 * place is the thing worth noticing. Sign out everywhere sits at the bottom
 * because it's the response, not the page.
 */
export default function LoginHistoryPanel({ logins }: { logins: LoginEvent[] }) {
  return (
    <>
      <div className="text-[13px]">
        {logins.map((event, i) => (
          <div
            key={event.id}
            className={cn(
              'flex items-center justify-between gap-3 py-2.5',
              i < logins.length - 1 && 'border-b-[0.5px] border-border',
            )}
          >
            <div className="min-w-0">
              <p className="truncate">{event.device}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{event.detail}</p>
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground">{event.when}</span>
          </div>
        ))}
      </div>

      <InfoBlock tone="neutral" className="mt-3.5 text-[11px]">
        See something you don&rsquo;t recognize? Sign out everywhere and message support.
      </InfoBlock>

      <Button variant="clear" size="xs" className="mt-3.5 w-full">
        Sign out everywhere
      </Button>
    </>
  );
}
