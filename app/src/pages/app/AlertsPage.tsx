import Card from '@/components/clear/Card';
import { ALERTS } from '@/data/clearPlaceholder';
import { ALERT_DOT, type Alert } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Alerts — design spec §1.
 *
 * A page with a history rather than a dropdown that empties itself. The two
 * alerts that matter most here — crossing into credit, and the rebalance date —
 * are things people go back and look for, and a notification tray that forgets
 * them is how you end up not knowing when your cycle closes.
 *
 * Each row takes a dot in the colour of what it's about, so the credit alerts
 * read as the same thing as the credit bar on Home.
 */
export default function AlertsPage({ alerts = ALERTS }: { alerts?: Alert[] }) {
  const groups: { label: string; rows: Alert[] }[] = [];
  for (const alert of alerts) {
    const last = groups[groups.length - 1];
    if (last && last.label === alert.group) last.rows.push(alert);
    else groups.push({ label: alert.group, rows: [alert] });
  }

  if (alerts.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">
        Nothing yet — you&rsquo;ll hear from us when something moves.
      </p>
    );
  }

  return (
    <>
      <h1 className="mb-4 hidden text-xl font-medium lg:block">Alerts</h1>

      <div className="lg:max-w-[640px]">
        {groups.map((group, gi) => (
          <div key={group.label} className={cn(gi > 0 && 'mt-4')}>
            <p className="mb-1.5 text-[11px] text-foreground-secondary">{group.label}</p>
            <Card className="lg:px-4 lg:py-2">
              {group.rows.map((alert, i) => (
                <div
                  key={alert.id}
                  className={cn(
                    'flex gap-2.5 py-2.5',
                    i < group.rows.length - 1 && 'border-b-[0.5px] border-border',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full',
                      ALERT_DOT[alert.tone],
                    )}
                  />
                  <div className="min-w-0">
                    <p className="text-[13px]">{alert.title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      {alert.detail}
                    </p>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        ))}
      </div>
    </>
  );
}
