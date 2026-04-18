import { useEffect, useState } from "react";
import type {
  PlayerResult,
  PlayerRole,
  PublicRoomState,
  RaceResult,
} from "../lib/protocol";
import { formatElapsed, type WpmSample } from "../lib/wpm";
import { WpmGraph } from "./WpmGraph";

interface EndScreenProps {
  room: PublicRoomState;
  role: PlayerRole | null;
  mySamples: WpmSample[];
  opponentSamples: WpmSample[];
  onRematchRequest: () => void;
  onRematchCancel: () => void;
  onNewRace: () => void;
}

export function EndScreen({
  room,
  role,
  mySamples,
  opponentSamples,
  onRematchRequest,
  onRematchCancel,
  onNewRace,
}: EndScreenProps) {
  const result = room.result;
  const [requested, setRequested] = useState(false);

  const iAmReady =
    !!role && !!room.rematchReady && room.rematchReady[role];
  const opponentReady =
    !!role &&
    !!room.rematchReady &&
    room.rematchReady[role === "host" ? "guest" : "host"];

  // Rematch only makes sense if both players are currently connected.
  // A disconnect forfeit that later reconnects (via their session token)
  // should re-enable rematch — only the live WS count matters.
  const rivalPresent = room.playerCount >= 2;

  // Keep local "requested" in sync with server echo, so if server clears
  // (e.g., after cancel or rival leave) we track it too.
  useEffect(() => {
    setRequested(iAmReady);
  }, [iAmReady]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!rivalPresent) {
          onNewRace();
          return;
        }
        if (requested) {
          onRematchCancel();
        } else {
          onRematchRequest();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requested, rivalPresent, onRematchRequest, onRematchCancel, onNewRace]);

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

  // Truncate samples to the race window (client keeps ticking even after
  // server ends the race, so we clip to the actual duration).
  const raceDurationSec =
    result.endReason === "time_up"
      ? room.config.timeLimit
      : Math.max(
          result.host.elapsedMs,
          result.guest.elapsedMs
        ) / 1000;

  const clippedMine = mySamples.filter((s) => s.t <= raceDurationSec);
  const clippedTheirs = opponentSamples.filter(
    (s) => s.t <= raceDurationSec
  );

  return (
    <div className="flex flex-col items-center gap-10 w-full max-w-[760px]">
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

      <WpmGraph
        mySamples={clippedMine}
        opponentSamples={clippedTheirs}
        raceDurationSec={raceDurationSec}
      />

      <div className="flex flex-col items-center gap-3">
        <RematchControls
          requested={requested}
          opponentReady={opponentReady}
          rivalPresent={rivalPresent}
          onRequest={onRematchRequest}
          onCancel={onRematchCancel}
          onNewRace={onNewRace}
        />
      </div>
    </div>
  );
}

/* -------------------- rematch controls -------------------- */

interface RematchControlsProps {
  requested: boolean;
  opponentReady: boolean;
  rivalPresent: boolean;
  onRequest: () => void;
  onCancel: () => void;
  onNewRace: () => void;
}

function RematchControls({
  requested,
  opponentReady,
  rivalPresent,
  onRequest,
  onCancel,
  onNewRace,
}: RematchControlsProps) {
  // Rival is gone — rematch is impossible. Show only "new race" and
  // explain why. (Server auto-clears the leaver's rematchReady on
  // disconnect, so if a stale requested=true sneaks through we just
  // ignore it.)
  if (!rivalPresent) {
    return (
      <>
        <div className="flex items-center gap-4">
          <button
            disabled
            className="px-6 py-2 border border-border text-fg-dimmer cursor-not-allowed"
            aria-disabled="true"
            title="rival disconnected"
          >
            rematch unavailable
          </button>
          <button
            onClick={onNewRace}
            className="px-6 py-2 border border-accent text-accent hover:bg-accent hover:text-bg transition-colors"
          >
            new race
          </button>
        </div>

        <div className="text-xs text-opponent min-h-[1em] flex items-center gap-1.5">
          <span className="inline-block size-1.5 rounded-full bg-opponent" />
          rival disconnected · can't rematch without them
        </div>
        <div className="text-[0.65rem] text-fg-dimmer">
          press <span className="text-fg-dim">enter</span> to start a new race
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-4">
        {requested ? (
          <button
            onClick={onCancel}
            className="px-6 py-2 border border-accent text-accent hover:bg-bg-soft transition-colors flex items-center gap-2"
          >
            <span className="inline-block size-1.5 rounded-full bg-accent animate-pulse" />
            waiting for rival...
            <span className="text-fg-dim text-xs">(cancel)</span>
          </button>
        ) : (
          <button
            onClick={onRequest}
            className="px-6 py-2 border border-accent text-accent hover:bg-accent hover:text-bg transition-colors"
          >
            rematch
          </button>
        )}
        <button
          onClick={onNewRace}
          className="text-sm text-fg-dim hover:text-accent transition-colors"
        >
          new race
        </button>
      </div>

      <div className="text-xs text-fg-dimmer min-h-[1em]">
        {opponentReady && !requested && (
          <span className="text-opponent">rival wants a rematch</span>
        )}
        {!opponentReady && !requested && (
          <span>
            press <span className="text-fg-dim">enter</span> for rematch
          </span>
        )}
        {requested && !opponentReady && (
          <span>waiting on rival to click rematch</span>
        )}
        {requested && opponentReady && (
          <span className="text-accent">both ready · new race starting</span>
        )}
      </div>
    </>
  );
}

/* -------------------- banner + results -------------------- */

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
