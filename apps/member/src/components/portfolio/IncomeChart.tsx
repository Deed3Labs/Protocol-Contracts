import { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, ReferenceLine } from 'recharts';
import { useTheme } from '@/context/ThemeContext';

interface IncomeData {
  month: string;
  inflow: number;
  outflow: number;
}

interface IncomeChartProps {
  data: IncomeData[];
}

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-zinc-900/95 backdrop-blur-sm border border-zinc-700 rounded-lg px-3 py-2 shadow-xl">
        <p className="text-zinc-400 text-xs mb-1">{payload[0].payload.month}</p>
        <p className="text-[#30D158] text-sm font-medium">
          Inflow: ${payload[0].value.toFixed(2)}
        </p>
        <p className="text-[#FF3B30] text-sm font-medium">
          Outflow: ${Math.abs(payload[1].value).toFixed(2)}
        </p>
      </div>
    );
  }
  return null;
};

export default function IncomeChart({ data }: IncomeChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const { theme } = useTheme();

  const { maxInflow, minInflow, avgInflow } = useMemo(() => {
    if (!data.length) return { maxInflow: 0, minInflow: 0, avgInflow: 0 };
    const inflows = data.map(d => d.inflow);
    const max = Math.max(...inflows);
    const min = Math.min(...inflows);
    const avg = inflows.reduce((a, b) => a + b, 0) / inflows.length;
    return { maxInflow: max, minInflow: min, avgInflow: avg };
  }, [data]);

  return (
    <div className="h-52 w-full mt-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
          barGap={2}
          onMouseMove={(e: any) => {
            if (e && e.activeTooltipIndex !== undefined) {
              setActiveIndex(e.activeTooltipIndex);
            }
          }}
          onMouseLeave={() => setActiveIndex(null)}
        >
          <XAxis 
            dataKey="month" 
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#71717a', fontSize: 10 }}
            dy={10}
            interval={0}
          />
          <YAxis hide />
          <Tooltip 
            cursor={{ fill: 'transparent' }}
            content={<CustomTooltip />}
          />
          <ReferenceLine 
            y={maxInflow} 
            stroke="#71717a" 
            strokeDasharray="3 3" 
            opacity={0.5} 
            label={{ value: 'High', position: 'right', fill: '#71717a', fontSize: 10 }} 
          />
          <ReferenceLine 
            y={avgInflow} 
            stroke="#3b82f6" 
            strokeDasharray="3 3" 
            opacity={0.6}
            label={{ value: 'Avg', position: 'right', fill: '#3b82f6', fontSize: 10 }} 
          />
          <ReferenceLine 
            y={minInflow} 
            stroke="#71717a" 
            strokeDasharray="3 3" 
            opacity={0.5}
            label={{ value: 'Low', position: 'right', fill: '#71717a', fontSize: 10 }} 
          />
          <Bar 
            dataKey="inflow" 
            fill="#30D158" 
            radius={[2, 2, 0, 0]}
            maxBarSize={16}
          >
            {data.map((_, index) => (
              <Cell 
                key={`cell-inflow-${index}`} 
                fillOpacity={activeIndex === index ? 1 : (theme === 'dark' ? 0.7 : 0.7)}
              />
            ))}
          </Bar>
          <Bar 
            dataKey="outflow" 
            fill="#FF3B30" 
            radius={[2, 2, 0, 0]}
            maxBarSize={16}
          >
             {data.map((_, index) => (
              <Cell 
                key={`cell-outflow-${index}`} 
                fillOpacity={activeIndex === index ? 1 : (theme === 'dark' ? 0.7 : 0.7)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

