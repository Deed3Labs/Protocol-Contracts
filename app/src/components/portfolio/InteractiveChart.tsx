import { LineChart, Line, Area, XAxis, YAxis, ResponsiveContainer, ReferenceLine, Tooltip } from 'recharts';
import { format } from 'date-fns';

interface ChartPoint {
  time: number;
  value: number;
  date: Date;
}

interface InteractiveChartProps {
  data: ChartPoint[];
  isNegative?: boolean;
  color?: string;
  showReferenceLine?: boolean;
}

const CustomTooltip = ({ active, payload, baseValue }: any) => {
  if (active && payload && payload.length) {
    const value = payload[0].value;
    const change = value - baseValue;
    const changePercent = baseValue !== 0 ? ((value - baseValue) / baseValue) * 100 : 0;
    const isUp = change >= 0;
    const point = payload?.[0]?.payload;
    const pointDateRaw = point?.date ?? point?.time;
    const pointDate =
      pointDateRaw instanceof Date
        ? pointDateRaw
        : typeof pointDateRaw === 'number' || typeof pointDateRaw === 'string'
          ? new Date(pointDateRaw)
          : new Date();
    
    return (
      <div className="bg-zinc-900/95 backdrop-blur-sm border border-zinc-700 rounded-lg px-3 py-2 shadow-xl">
        <p className="text-white font-semibold text-lg">
          ${value.toFixed(2)}
        </p>
        <p className={`text-sm ${isUp ? 'text-[#30D158]' : 'text-[#FF3B30]'}`}>
          {isUp ? '+' : ''}{change.toFixed(2)} ({isUp ? '+' : ''}{changePercent.toFixed(2)}%)
        </p>
        <p className="text-zinc-500 text-xs mt-1">
          {format(pointDate, 'MMM d, yyyy h:mm a')}
        </p>
      </div>
    );
  }
  return null;
};

const CustomCursor = ({ points, height }: any) => {
  if (!points || points.length === 0) return null;
  const { x } = points[0];
  
  return (
    <line
      x1={x}
      y1={0}
      x2={x}
      y2={height}
      stroke="#6B7280"
      strokeWidth={1}
      strokeDasharray="4 4"
    />
  );
};

export default function InteractiveChart({ data, isNegative = false, color, showReferenceLine = true }: InteractiveChartProps) {
  const baseValue = data.length > 0 ? data[0].value : 100;
  const chartColor = color || (isNegative ? '#FF3B30' : '#30D158');
  
  // Create a unique pattern ID for this chart instance
  const patternId = `dot-pattern-${isNegative ? 'negative' : 'positive'}-${chartColor.replace('#', '')}`;
  
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart 
          data={data} 
          margin={{ top: 10, right: 0, left: 0, bottom: 0 }}
        >
          <defs>
            {/* Create a dotted pattern similar to Coinbase */}
            <pattern
              id={patternId}
              x="0"
              y="0"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="3" cy="3" r="0.8" fill={chartColor} opacity="0.4" />
            </pattern>
          </defs>
          <XAxis dataKey="time" hide />
          <YAxis hide domain={['auto', 'auto']} />
          {showReferenceLine && data.length > 0 && (
            <ReferenceLine 
              y={data[0]?.value} 
              stroke="#3A3A3C" 
              strokeDasharray="6 6" 
            />
          )}
          <Tooltip 
            content={<CustomTooltip baseValue={baseValue} />}
            cursor={<CustomCursor height={200} />}
            position={{ y: 0 }}
          />
          {/* Area fill with dotted pattern - fills from line down to baseline */}
          <Area
            type="monotone"
            dataKey="value"
            stroke="none"
            fill={`url(#${patternId})`}
            fillOpacity={1}
            baseLine={baseValue}
            style={{ color: chartColor }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={chartColor}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ 
              r: 6, 
              fill: chartColor, 
              stroke: '#000', 
              strokeWidth: 2 
            }}
            animationDuration={500}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

