import { useEffect } from "react";
import type {
  PlayerResult,
  PlayerRole,
  PublicRoomState,
  RaceResult,
} from "../lib/protocol";
import { formatElapsed } from "../lib/wpm";

interface EndScreenProps {
  room: PublicRoomState;
  role: PlayerRole | null;
  onNewRace: () => void;
}

export function EndScreen({ room, role, onNewRace }: EndScreenProps) {
  const result = room.result;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onNewRace();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNewRace]);

  if (!result) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h2 className="text-2xl">race ended</h2>
        <button
          onClick={onNewRace}
          className="mt-4 px-6 py-2 border border-accent text-accent hover:bg-accent hover:text-bg transition-colors"
        >
          new race
        </button>
      </div>
    );
  }

  const outcome = interpretOutcome(result, role);
  const me = role === "guest" ? result.guest : result.host;
  const them = role === "guest" ? result.host : result.guest;

  return (
    <div className="flex flex-col items-center gap-10 w-full max-w-[720px]">
      <Banner outcome={outcome} reason={reasonLabel(result)} />

      <div className="grid grid-cols-[1fr_auto_1fr] gap-10 items-center w-full">
        <ResultColumn
          label="you"
          color="accent"
          result={me}
          align="right"
        />
        <div className="h-24 w-px bg-border" aria-hidden />
        <ResultColumn
          label="rival"
          color="opponent"
          result={them}
          align="left"
        />
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          onClick={onNewRace}
          className="px-6 py-2 border border-accent text-accent hover:bg-accent hover:text-bg transition-colors"
        >
          new race
        </button>
        <span className="text-xs text-fg-dimmer">
          press <span className="text-fg-dim">enter</span> or{" "}
          <span className="text-fg-dim">space</span>
        </span>
        <span className="text-xs text-fg-dimmer mt-2">
          rematch (same opponent) in M5
        </span>
      </div>
    </div>
  );
}

type Outcome = "win" | "lose" | "tie";

function interpretOutcome(
  result: RaceResult,
  role: PlayerRole | null
): Outcome {
  if (result.outcome === "tie") return "tie";
  if (result.outcome === "host_wins") {
    return role === "host" ? "win" : "lose";
  }
  return role === "guest" ? "win" : "lose";
}

function reasonLabel(result: RaceResult): string {
  if (result.endReason === "finish") {
    return "finish mode · first to complete wins";
  }
  return "time mode · higher wpm wins";
}

function Banner({
  outcome,
  reason,
}: {
  outcome: Outcome;
  reason: string;
}) {
  const title =
    outcome === "win"
      ? "you win"
      : outcome === "lose"
      ? "you lose"
      : "tie";

  const color =
    outcome === "win"
      ? "text-accent"
      : outcome === "lose"
      ? "text-opponent"
      : "text-fg";

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-[0.75rem] uppercase tracking-[0.25em] text-fg-dim">
        race over
      </span>
      <h2 className={`text-5xl md:text-6xl font-medium ${color}`}>
        {title}
      </h2>
      <span className="text-xs text-fg-dimmer mt-1">{reason}</span>
    </div>
  );
}

interface ResultColumnProps {
  label: string;
  color: "accent" | "opponent";
  result: PlayerResult;
  align: "left" | "right";
}

function ResultColumn({
  label,
  color,
  result,
  align,
}: ResultColumnProps) {
  const textColor = color === "accent" ? "text-accent" : "text-opponent";
  const dotColor = color === "accent" ? "bg-accent" : "bg-opponent";
  const alignment = align === "right" ? "items-end text-right" : "items-start text-left";

  return (
    <div className={`flex flex-col ${alignment} gap-4`}>
      <span className="text-[0.7rem] uppercase tracking-[0.2em] text-fg-dim flex items-center gap-1.5">
        <span className={`inline-block size-1.5 rounded-full ${dotColor}`} />
        {label}
        {result.finishedPassage && (
          <span className={`ml-1 text-[0.6rem] ${textColor}`}>
            · finished
          </span>
        )}
      </span>

      <div className="flex items-baseline gap-2">
        <span className={`text-5xl tabular-nums font-medium ${textColor}`}>
          {result.wpm}
        </span>
        <span className="text-xs uppercase tracking-[0.15em] text-fg-dim">
          wpm
        </span>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <Stat label="accuracy" value={`${result.accuracy}%`} />
        <Stat label="time" value={formatElapsed(result.elapsedMs)} />
        <Stat
          label="chars"
          value={`${result.correctCount}`}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 justify-between min-w-[140px]">
      <span className="text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
        {label}
      </span>
      <span className="tabular-nums text-fg">{value}</span>
    </div>
  );
}
