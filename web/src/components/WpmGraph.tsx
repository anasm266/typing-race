import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WpmSample } from "../lib/wpm";

export interface WpmSeries {
  /** Stable key within the chart. */
  id: string;
  name: string;
  color: string;
  samples: WpmSample[];
}

interface WpmGraphProps {
  series: WpmSeries[];
  raceDurationSec: number;
}

type Point = { t: number } & Record<string, number>;

function mergeSeries(series: WpmSeries[]): Point[] {
  const map = new Map<number, Point>();

  for (const line of series) {
    for (const sample of line.samples) {
      const key = Math.round(sample.t);
      const existing = map.get(key) ?? ({ t: key } as Point);
      existing[line.id] = sample.wpm;
      map.set(key, existing);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.t - b.t);
}

export function WpmGraph({ series, raceDurationSec }: WpmGraphProps) {
  const data = mergeSeries(series);

  if (data.length < 2) {
    return (
      <div className="w-full flex flex-col items-center gap-2">
        <span className="text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
          wpm over time
        </span>
        <div className="h-40 flex items-center justify-center text-xs text-fg-dimmer">
          not enough samples for a graph
        </div>
      </div>
    );
  }

  const maxWpm = Math.max(
    1,
    ...data.flatMap((point) =>
      series.map((line) => point[line.id] ?? 0)
    )
  );
  const yMax = Math.ceil(maxWpm * 1.15);
  const xMax = Math.max(1, Math.ceil(raceDurationSec));

  return (
    <div className="w-full flex flex-col items-center gap-3">
      <span className="text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
        wpm over time
      </span>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart
          data={data}
          margin={{ top: 10, right: 10, bottom: 10, left: -10 }}
        >
          <CartesianGrid
            stroke="var(--color-border)"
            strokeDasharray="2 4"
            vertical={false}
          />
          <XAxis
            dataKey="t"
            type="number"
            domain={[0, xMax]}
            stroke="var(--color-fg-dimmer)"
            tick={{ fontSize: 11, fill: "var(--color-fg-dim)" }}
            tickFormatter={(v) => `${v}s`}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, yMax]}
            stroke="var(--color-fg-dimmer)"
            tick={{ fontSize: 11, fill: "var(--color-fg-dim)" }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-bg-soft)",
              border: "1px solid var(--color-border)",
              borderRadius: 4,
              fontSize: 12,
              fontFamily: "var(--font-mono)",
            }}
            labelFormatter={(v) => `t = ${v}s`}
            labelStyle={{ color: "var(--color-fg-dim)" }}
            itemStyle={{ padding: 0 }}
            cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }}
          />
          {series.map((line) => (
            <Line
              key={line.id}
              type="monotone"
              dataKey={line.id}
              name={line.name}
              stroke={line.color}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-[0.7rem] uppercase tracking-[0.15em] text-fg-dim">
        {series.map((line) => (
          <span key={line.id} className="flex items-center gap-1.5">
            <span
              className="inline-block size-1.5 rounded-full"
              style={{ background: line.color }}
            />
            {line.name}
          </span>
        ))}
      </div>
    </div>
  );
}
