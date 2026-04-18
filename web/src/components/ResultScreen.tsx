import { useEffect } from "react";
import { calcAccuracy, calcWpm, formatElapsed } from "../lib/wpm";

interface ResultScreenProps {
  elapsedMs: number;
  correctChars: number;
  totalKeystrokes: number;
  passageWords: number;
  onRestart: () => void;
}

export function ResultScreen({
  elapsedMs,
  correctChars,
  totalKeystrokes,
  passageWords,
  onRestart,
}: ResultScreenProps) {
  const wpm = calcWpm(correctChars, elapsedMs);
  const acc = calcAccuracy(correctChars, totalKeystrokes);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onRestart();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRestart]);

  return (
    <div className="flex flex-col items-center gap-10 w-full max-w-[800px]">
      <div className="flex flex-col items-center">
        <span className="text-[0.75rem] uppercase tracking-[0.2em] text-fg-dim">
          finished
        </span>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-7xl text-accent tabular-nums font-medium">
            {wpm}
          </span>
          <span className="text-2xl text-fg-dim">wpm</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
        <ResultStat label="accuracy" value={`${acc}%`} />
        <ResultStat label="time" value={formatElapsed(elapsedMs)} />
        <ResultStat label="keystrokes" value={totalKeystrokes.toString()} />
        <ResultStat label="words" value={passageWords.toString()} />
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          onClick={onRestart}
          className="px-6 py-2 border border-border text-fg-dim hover:border-accent hover:text-accent transition-colors"
        >
          next passage
        </button>
        <span className="text-xs text-fg-dimmer">
          press <span className="text-fg-dim">enter</span> or{" "}
          <span className="text-fg-dim">space</span>
        </span>
      </div>
    </div>
  );
}

function ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
        {label}
      </span>
      <span className="text-2xl text-fg tabular-nums">{value}</span>
    </div>
  );
}
