import { useEffect } from "react";
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

  const iAmReady =
    !!role && !!room.rematchReady && room.rematchReady[role];
  const requested = iAmReady;
  const opponentReady =
    !!role &&
    !!room.rematchReady &&
    room.rematchReady[role === "host" ? "guest" : "host"];

  // Rematch only makes sense if both players are currently connected.
  // A disconnect forfeit that later reconnects (via their session token)
  // should re-enable rematch — only the live WS count matters.
  const rivalPresent = room.playerCount >= 2;

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
  const showFinishScore = result.endReason === "finish";
  const isWordSprint = room.passage.wordCount === 1;

  return (
    <div className="flex flex-col items-center gap-10 w-full max-w-[760px]">
      <Banner
        outcome={outcome}
        reason={reasonLabel(result, isWordSprint)}
      />

      <div className="grid grid-cols-[1fr_auto_1fr] gap-10 items-center w-full">
        <ResultColumn
          label="you"
          color="accent"
          result={me}
          showFinishScore={showFinishScore}
          isWordSprint={isWordSprint}
          align="right"
        />
        <div className="h-24 w-px bg-border" aria-hidden />
        <ResultColumn
          label="rival"
          color="opponent"
          result={them}
          showFinishScore={showFinishScore}
          isWordSprint={isWordSprint}
          align="left"
        />
      </div>

      {isWordSprint ? (
        <WordSprintSummary
          outcome={outcome}
          me={me}
          them={them}
          wordLength={room.passage.text.length}
        />
      ) : (
        <WpmGraph
          mySamples={clippedMine}
          opponentSamples={clippedTheirs}
          raceDurationSec={raceDurationSec}
        />
      )}

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

/* -------------------- one-word sprint summary -------------------- */

function WordSprintSummary({
  outcome,
  me,
  them,
  wordLength,
}: {
  outcome: Outcome;
  me: PlayerResult;
  them: PlayerResult;
  wordLength: number;
}) {
  const explanation = sprintExplanation(outcome, me, them);
  const meWon = outcome === "win";
  const themWon = outcome === "lose";
  const fastestElapsed = Math.max(1, Math.min(me.elapsedMs, them.elapsedMs));
  const meBar = Math.max(
    8,
    Math.round((fastestElapsed / Math.max(me.elapsedMs, 1)) * 100)
  );
  const themBar = Math.max(
    8,
    Math.round((fastestElapsed / Math.max(them.elapsedMs, 1)) * 100)
  );

  return (
    <section className="word-sprint-card relative w-full overflow-hidden border border-border bg-bg-soft/70 px-5 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_0%,rgba(34,211,238,0.14),transparent_34%),radial-gradient(circle_at_75%_15%,rgba(244,114,182,0.12),transparent_34%)]" />
      <div className="relative flex flex-col gap-5">
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-[0.65rem] uppercase tracking-[0.25em] text-fg-dim">
            one word sprint
          </span>
          <strong
            className={
              "text-lg font-medium " +
              (outcome === "win"
                ? "text-accent"
                : outcome === "lose"
                ? "text-opponent"
                : "text-fg")
            }
          >
            {explanation.headline}
          </strong>
          <span className="text-xs text-fg-dimmer">
            {explanation.detail}
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <SprintPlayerCard
            label="you"
            color="accent"
            result={me}
            wordLength={wordLength}
            winner={meWon}
            barWidth={meBar}
          />
          <SprintPlayerCard
            label="rival"
            color="opponent"
            result={them}
            wordLength={wordLength}
            winner={themWon}
            barWidth={themBar}
          />
        </div>
      </div>
    </section>
  );
}

function SprintPlayerCard({
  label,
  color,
  result,
  wordLength,
  winner,
  barWidth,
}: {
  label: string;
  color: "accent" | "opponent";
  result: PlayerResult;
  wordLength: number;
  winner: boolean;
  barWidth: number;
}) {
  const textColor = color === "accent" ? "text-accent" : "text-opponent";
  const bgColor = color === "accent" ? "bg-accent" : "bg-opponent";
  const borderColor =
    color === "accent" ? "border-accent/45" : "border-opponent/45";
  const glow =
    color === "accent"
      ? "shadow-[0_0_36px_rgba(34,211,238,0.10)]"
      : "shadow-[0_0_36px_rgba(244,114,182,0.10)]";

  return (
    <div
      className={
        "word-sprint-player border bg-bg/70 p-4 transition-transform duration-200 hover:-translate-y-0.5 " +
        (winner ? `${borderColor} ${glow}` : "border-border")
      }
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.2em] text-fg-dim">
          <span className={`inline-block size-1.5 rounded-full ${bgColor}`} />
          {label}
        </span>
        {winner && (
          <span
            className={`word-sprint-winner px-2 py-1 text-[0.6rem] uppercase tracking-[0.18em] ${textColor} border ${borderColor}`}
          >
            winner
          </span>
        )}
      </div>

      <div className="flex items-end justify-between gap-4">
        <div>
          <div className={`text-4xl tabular-nums ${textColor}`}>
            {formatSprintTime(result.elapsedMs)}
          </div>
          <div className="mt-1 text-[0.65rem] uppercase tracking-[0.15em] text-fg-dimmer">
            finish time
          </div>
        </div>
        <div className="text-right text-xs text-fg-dim">
          <div>
            <span className="tabular-nums text-fg">{result.wpm}</span>{" "}
            wpm
          </div>
          <div>
            <span className="tabular-nums text-fg">{result.accuracy}%</span>{" "}
            accuracy
          </div>
          <div>
            <span className="tabular-nums text-fg">
              {result.correctCount}/{wordLength}
            </span>{" "}
            chars
          </div>
        </div>
      </div>

      <div className="mt-4 h-1.5 overflow-hidden bg-bg-soft-2">
        <div
          className={`h-full ${bgColor} word-sprint-bar`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
    </div>
  );
}

function sprintExplanation(
  outcome: Outcome,
  me: PlayerResult,
  them: PlayerResult
): { headline: string; detail: string } {
  if (outcome === "tie") {
    return {
      headline: "dead heat",
      detail: "both racers were effectively even on this word",
    };
  }

  const winner = outcome === "win" ? me : them;
  const loser = outcome === "win" ? them : me;
  const winnerLabel = outcome === "win" ? "you" : "rival";

  if (winner.finishedPassage && !loser.finishedPassage) {
    return {
      headline: `${winnerLabel} finished the word`,
      detail: "clean completion decided the sprint",
    };
  }

  if (winner.correctCount !== loser.correctCount) {
    return {
      headline: `${winnerLabel} typed more clean chars`,
      detail: `${winner.correctCount} of ${Math.max(
        winner.correctCount,
        loser.correctCount
      )} chars counted before the result locked`,
    };
  }

  if (winner.accuracy !== loser.accuracy) {
    return {
      headline: `${winnerLabel} won on accuracy`,
      detail: `${winner.accuracy}% vs ${loser.accuracy}%`,
    };
  }

  const margin = Math.abs(winner.elapsedMs - loser.elapsedMs);
  return {
    headline: `${winnerLabel} won by ${formatSprintMargin(margin)}`,
    detail: "reaction time and clean execution decided it",
  };
}

function formatSprintTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatSprintMargin(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
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

function reasonLabel(result: RaceResult, isWordSprint: boolean): string {
  if (isWordSprint) {
    return "one word sprint · fastest clean finish wins";
  }
  if (result.endReason === "finish") {
    return "finish mode · final score balances speed and accuracy";
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
  showFinishScore: boolean;
  isWordSprint: boolean;
  align: "left" | "right";
}

function ResultColumn({
  label,
  color,
  result,
  showFinishScore,
  isWordSprint,
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
          {isWordSprint ? formatSprintTime(result.elapsedMs) : result.wpm}
        </span>
        <span className="text-xs uppercase tracking-[0.15em] text-fg-dim">
          {isWordSprint ? "time" : "wpm"}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        {showFinishScore && !isWordSprint && (
          <Stat
            label="score"
            value={formatScore(finishModeScore(result))}
          />
        )}
        {isWordSprint && <Stat label="wpm" value={`${result.wpm}`} />}
        <Stat label="accuracy" value={`${result.accuracy}%`} />
        {!isWordSprint && (
          <Stat label="time" value={formatElapsed(result.elapsedMs)} />
        )}
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

function finishModeScore(result: PlayerResult): number {
  const accuracyWeight = result.accuracy / 100;
  return result.wpm * accuracyWeight * accuracyWeight;
}

function formatScore(score: number): string {
  return score.toFixed(1);
}
