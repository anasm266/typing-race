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

interface WpmGraphProps {
  mySamples: WpmSample[];
  opponentSamples: WpmSample[];
  raceDurationSec: number;
}

interface Point {
  t: number;
  you?: number;
  rival?: number;
}

function mergeSamples(
  mine: WpmSample[],
  theirs: WpmSample[]
): Point[] {
  const map = new Map<number, Point>();

  for (const s of mine) {
    const key = Math.round(s.t);
    const existing = map.get(key) ?? { t: key };
    existing.you = s.wpm;
    map.set(key, existing);
  }
  for (const s of theirs) {
    const key = Math.round(s.t);
    const existing = map.get(key) ?? { t: key };
    existing.rival = s.wpm;
    map.set(key, existing);
  }

  return Array.from(map.values()).sort((a, b) => a.t - b.t);
}

export function WpmGraph({
  mySamples,
  opponentSamples,
  raceDurationSec,
}: WpmGraphProps) {
  const data = mergeSamples(mySamples, opponentSamples);

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
    ...data.map((d) => Math.max(d.you ?? 0, d.rival ?? 0))
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
          <Line
            type="monotone"
            dataKey="you"
            name="you"
            stroke="var(--color-accent)"
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="rival"
            name="rival"
            stroke="var(--color-opponent)"
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex gap-6 text-[0.7rem] uppercase tracking-[0.15em] text-fg-dim">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 rounded-full bg-accent" />
          you
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 rounded-full bg-opponent" />
          rival
        </span>
      </div>
    </div>
  );
}
