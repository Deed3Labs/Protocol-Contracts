import * as React from 'react';
import * as Recharts from 'recharts';
import { cn } from '@/lib/utils';

export type ChartConfig = Record<
  string,
  { label?: React.ReactNode; color?: string }
>;

interface ChartContextValue {
  config: ChartConfig;
}

const ChartContext = React.createContext<ChartContextValue | null>(null);

export function useChart() {
  const ctx = React.useContext(ChartContext);
  if (!ctx) throw new Error('useChart must be used within a <ChartContainer />');
  return ctx;
}

/**
 * shadcn-style chart wrapper over recharts. Injects `--color-{key}` from the
 * config so chart elements can reference `var(--color-{key})`, and styles
 * recharts axes/grid with the neutral theme tokens. Pass a single recharts
 * chart element (e.g. <AreaChart>) as the child.
 */
export function ChartContainer({
  config,
  className,
  height = 240,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig;
  height?: number;
  children: React.ReactElement;
}) {
  const styleVars = React.useMemo(() => {
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(config)) {
      if (value.color) vars[`--color-${key}`] = value.color;
    }
    return vars as React.CSSProperties;
  }, [config]);

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        className={cn(
          'w-full touch-pan-y [&_.recharts-surface]:touch-pan-y [&_.recharts-wrapper]:touch-pan-y [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/70 [&_.recharts-surface]:outline-none',
          className,
        )}
        style={{ ...styleVars, height }}
        {...props}
      >
        <Recharts.ResponsiveContainer width="100%" height={height} minWidth={0}>
          {children}
        </Recharts.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = Recharts.Tooltip;

interface TooltipItem {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  hideLabel = false,
  formatter,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: React.ReactNode;
  hideLabel?: boolean;
  formatter?: (value: number) => string;
}) {
  const { config } = useChart();
  if (!active || !payload?.length) return null;

  const fmt = formatter ?? ((v: number) => `$${Number(v).toLocaleString()}`);

  return (
    <div className="grid min-w-[8rem] gap-1.5 rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-md">
      {!hideLabel && <div className="font-medium text-foreground">{label}</div>}
      <div className="grid gap-1">
        {payload.map((item, i) => {
          const key = String(item.dataKey ?? item.name ?? i);
          const cfg = config[key];
          const color = item.color ?? `var(--color-${key})`;
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: color }} />
              <span className="text-muted-foreground">{cfg?.label ?? item.name ?? key}</span>
              <span className="ml-auto font-medium tabular-nums text-foreground">
                {fmt(Number(item.value))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
