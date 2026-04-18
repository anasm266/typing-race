import { calcAccuracy, calcWpm, formatElapsed } from "../lib/wpm";

interface StatsProps {
  elapsedMs: number;
  correctChars: number;
  totalKeystrokes: number;
  state: "idle" | "typing" | "done";
}

export function Stats({
  elapsedMs,
  correctChars,
  totalKeystrokes,
  state,
}: StatsProps) {
  const wpm = calcWpm(correctChars, elapsedMs);
  const acc = calcAccuracy(correctChars, totalKeystrokes);

  const isLive = state === "typing";

  return (
    <div className="flex gap-8 items-end justify-center font-mono">
      <Stat label="time" value={formatElapsed(elapsedMs)} live={isLive} />
      <Stat
        label="wpm"
        value={state === "idle" ? "—" : wpm.toString()}
        live={isLive}
        accent
      />
      <Stat
        label="acc"
        value={state === "idle" ? "—" : `${acc}%`}
        live={isLive}
      />
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  live?: boolean;
  accent?: boolean;
}

function Stat({ label, value, accent }: StatProps) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[0.7rem] uppercase tracking-[0.15em] text-fg-dim">
        {label}
      </span>
      <span
        className={
          "text-2xl tabular-nums " +
          (accent ? "text-accent" : "text-fg")
        }
      >
        {value}
      </span>
    </div>
  );
}
