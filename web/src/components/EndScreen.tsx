import { useEffect, useMemo } from "react";
import type {
  PlayerResult,
  PublicRoomState,
  RaceResult,
  Seat,
} from "../lib/protocol";
import { formatElapsed, type WpmSample } from "../lib/wpm";
import { addLocalHistoryEntry } from "../lib/localHistory";
import { trackEvent } from "../lib/analytics";
import { seatName, seatTheme } from "../lib/seats";
import { WpmGraph, type WpmSeries } from "./WpmGraph";

interface EndScreenProps {
  room: PublicRoomState;
  seat: Seat | null;
  mySamples: WpmSample[];
  rivalSamples: Record<number, WpmSample[]>;
  onRematchRequest: () => void;
  onRematchCancel: () => void;
  onNewRace: () => void;
}

type Outcome = "win" | "lose" | "tie";

export function EndScreen({
  room,
  seat,
  mySamples,
  rivalSamples,
  onRematchRequest,
  onRematchCancel,
  onNewRace,
}: EndScreenProps) {
  const result = room.result;
  const standings = useMemo(() => result?.players ?? [], [result]);
  const me = standings.find((player) => player.seat === seat) ?? null;
  const outcome = interpretOutcome(result, seat);
  const isDuel = standings.length <= 2;

  useEffect(() => {
    if (!result || !me) return;

    const rivals = result.players.filter((player) => player.seat !== seat);
    const bestRival = rivals.reduce<PlayerResult | null>(
      (best, player) =>
        best === null || player.wpm > best.wpm ? player : best,
      null
    );
    const raceDurationMs = result.players.reduce(
      (max, player) => Math.max(max, player.elapsedMs),
      0
    );

    addLocalHistoryEntry({
      id: [
        "race",
        room.roomId,
        room.passage.id,
        result.endReason,
        raceDurationMs,
      ].join(":"),
      kind: "race",
      passageLength: room.config.passageLength,
      passageWords: room.passage.wordCount,
      passageId: room.passage.id,
      endMode: room.config.endMode,
      endReason: result.endReason,
      outcome,
      wpm: me.wpm,
      accuracy: me.accuracy,
      elapsedMs: me.elapsedMs,
      correctChars: me.correctCount,
      opponentWpm: bestRival?.wpm,
      opponentAccuracy: bestRival?.accuracy,
      place: me.place,
      playerCount: result.players.length,
    });
    trackEvent("room_result_viewed", {
      roomId: room.roomId,
      path: `/room/${room.roomId}`,
      metadata: {
        seat: me.seat,
        place: me.place,
        playerCount: result.players.length,
        outcome,
        endReason: result.endReason,
        passageLength: room.config.passageLength,
        endMode: room.config.endMode,
        myWpm: me.wpm,
        bestRivalWpm: bestRival?.wpm ?? 0,
      },
    });
  }, [
    result,
    me,
    seat,
    outcome,
    room.config.endMode,
    room.config.passageLength,
    room.passage.id,
    room.passage.wordCount,
    room.roomId,
  ]);

  const iAmReady =
    seat !== null && !!room.rematchReady?.includes(seat);
  const connectedPlayers = room.players.filter((player) => player.connected);
  const canRematch = connectedPlayers.length >= 2;
  const readyCount = (room.rematchReady ?? []).filter((readySeat) =>
    connectedPlayers.some((player) => player.seat === readySeat)
  ).length;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!canRematch) {
          onNewRace();
          return;
        }
        if (iAmReady) {
          onRematchCancel();
        } else {
          onRematchRequest();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [iAmReady, canRematch, onRematchRequest, onRematchCancel, onNewRace]);

  const series: WpmSeries[] = useMemo(() => {
    const lines: WpmSeries[] = [];
    if (seat !== null) {
      lines.push({
        id: `s${seat}`,
        name: "you",
        color: seatTheme(seat).color,
        samples: mySamples,
      });
    }
    for (const player of standings) {
      if (player.seat === seat) continue;
      lines.push({
        id: `s${player.seat}`,
        name: seatTheme(player.seat).label,
        color: seatTheme(player.seat).color,
        samples: rivalSamples[player.seat] ?? [],
      });
    }
    return lines;
  }, [seat, mySamples, rivalSamples, standings]);

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

  // Truncate samples to the race window (client keeps ticking even after
  // the server ends the race, so we clip to the actual duration).
  const raceDurationSec =
    result.endReason === "time_up"
      ? room.config.timeLimit
      : result.players.reduce(
          (max, player) => Math.max(max, player.elapsedMs),
          0
        ) / 1000;

  const clippedSeries = series.map((line) => ({
    ...line,
    samples: line.samples.filter((sample) => sample.t <= raceDurationSec),
  }));

  const showFinishScore = result.endReason === "finish";
  const isWordSprint = room.passage.wordCount === 1;

  return (
    <div className="flex flex-col items-center gap-10 w-full max-w-[760px]">
      <Banner
        outcome={outcome}
        place={me?.place ?? null}
        fieldSize={standings.length}
        reason={reasonLabel(result, isWordSprint)}
      />

      {isDuel ? (
        <DuelResults
          standings={standings}
          mySeat={seat}
          showFinishScore={showFinishScore}
          isWordSprint={isWordSprint}
        />
      ) : (
        <Standings
          standings={standings}
          mySeat={seat}
          showFinishScore={showFinishScore}
          isWordSprint={isWordSprint}
        />
      )}

      {isWordSprint ? (
        <WordSprintSummary
          standings={standings}
          mySeat={seat}
          wordLength={room.passage.text.length}
        />
      ) : (
        <WpmGraph series={clippedSeries} raceDurationSec={raceDurationSec} />
      )}

      <div className="flex flex-col items-center gap-3">
        <RematchControls
          requested={iAmReady}
          readyCount={readyCount}
          connectedCount={connectedPlayers.length}
          canRematch={canRematch}
          isDuel={isDuel}
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
  standings,
  mySeat,
  wordLength,
}: {
  standings: PlayerResult[];
  mySeat: Seat | null;
  wordLength: number;
}) {
  const explanation = sprintExplanation(standings, mySeat);
  const fastest = standings.reduce(
    (min, player) => Math.min(min, Math.max(1, player.elapsedMs)),
    Number.POSITIVE_INFINITY
  );

  return (
    <section className="word-sprint-card relative w-full overflow-hidden border border-border bg-bg-soft/70 px-5 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_0%,rgba(34,211,238,0.14),transparent_34%),radial-gradient(circle_at_75%_15%,rgba(244,114,182,0.12),transparent_34%)]" />
      <div className="relative flex flex-col gap-5">
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-[0.65rem] uppercase tracking-[0.25em] text-fg-dim">
            one word sprint
          </span>
          <strong className="text-lg font-medium text-fg">
            {explanation.headline}
          </strong>
          <span className="text-xs text-fg-dimmer">{explanation.detail}</span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {standings.map((player) => (
            <SprintPlayerCard
              key={player.seat}
              player={player}
              mySeat={mySeat}
              wordLength={wordLength}
              barWidth={Math.max(
                8,
                Math.round((fastest / Math.max(player.elapsedMs, 1)) * 100)
              )}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function SprintPlayerCard({
  player,
  mySeat,
  wordLength,
  barWidth,
}: {
  player: PlayerResult;
  mySeat: Seat | null;
  wordLength: number;
  barWidth: number;
}) {
  const theme = seatTheme(player.seat);
  const winner = player.place === 1 && !player.dnf;

  return (
    <div
      className={
        "word-sprint-player border bg-bg/70 p-4 transition-transform duration-200 hover:-translate-y-0.5 " +
        (winner ? `${theme.borderSoft} ${theme.glow}` : "border-border")
      }
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.2em] text-fg-dim">
          <span
            className={`inline-block size-1.5 rounded-full ${theme.bg}`}
            aria-hidden
          />
          {seatName(player.seat, mySeat)}
        </span>
        {winner && (
          <span
            className={`word-sprint-winner px-2 py-1 text-[0.6rem] uppercase tracking-[0.18em] ${theme.text} border ${theme.borderSoft}`}
          >
            winner
          </span>
        )}
      </div>

      <div className="flex items-end justify-between gap-4">
        <div>
          <div className={`text-4xl tabular-nums ${theme.text}`}>
            {formatSprintTime(player.elapsedMs)}
          </div>
          <div className="mt-1 text-[0.65rem] uppercase tracking-[0.15em] text-fg-dimmer">
            finish time
          </div>
        </div>
        <div className="text-right text-xs text-fg-dim">
          <div>
            <span className="tabular-nums text-fg">{player.wpm}</span> wpm
          </div>
          <div>
            <span className="tabular-nums text-fg">{player.accuracy}%</span>{" "}
            accuracy
          </div>
          <div>
            <span className="tabular-nums text-fg">
              {player.correctCount}/{wordLength}
            </span>{" "}
            chars
          </div>
        </div>
      </div>

      <div className="mt-4 h-1.5 overflow-hidden bg-bg-soft-2">
        <div
          className="h-full word-sprint-bar"
          style={{ width: `${barWidth}%`, background: theme.color }}
        />
      </div>
    </div>
  );
}

function sprintExplanation(
  standings: PlayerResult[],
  mySeat: Seat | null
): { headline: string; detail: string } {
  const winner = standings[0];
  const runnerUp = standings[1];
  if (!winner || !runnerUp) {
    return {
      headline: "sprint over",
      detail: "not enough racers to compare",
    };
  }
  if (winner.place === runnerUp.place) {
    return {
      headline: "dead heat",
      detail: "the top racers were effectively even on this word",
    };
  }

  const label = seatName(winner.seat, mySeat);

  if (winner.finishedPassage && !runnerUp.finishedPassage) {
    return {
      headline: `${label} finished the word`,
      detail: "clean completion decided the sprint",
    };
  }
  if (winner.correctCount !== runnerUp.correctCount) {
    return {
      headline: `${label} typed more clean chars`,
      detail: `${winner.correctCount} chars counted before the result locked`,
    };
  }
  if (winner.accuracy !== runnerUp.accuracy) {
    return {
      headline: `${label} won on accuracy`,
      detail: `${winner.accuracy}% vs ${runnerUp.accuracy}%`,
    };
  }
  const margin = Math.abs(winner.elapsedMs - runnerUp.elapsedMs);
  return {
    headline: `${label} won by ${formatSprintTime(margin)}`,
    detail: "reaction time and clean execution decided it",
  };
}

/* -------------------- standings -------------------- */

function Standings({
  standings,
  mySeat,
  showFinishScore,
  isWordSprint,
}: {
  standings: PlayerResult[];
  mySeat: Seat | null;
  showFinishScore: boolean;
  isWordSprint: boolean;
}) {
  return (
    <div className="flex w-full flex-col divide-y divide-border border-y border-border">
      {standings.map((player, index) => (
        <StandingRow
          key={player.seat}
          player={player}
          mySeat={mySeat}
          index={index}
          showFinishScore={showFinishScore}
          isWordSprint={isWordSprint}
        />
      ))}
    </div>
  );
}

function StandingRow({
  player,
  mySeat,
  index,
  showFinishScore,
  isWordSprint,
}: {
  player: PlayerResult;
  mySeat: Seat | null;
  index: number;
  showFinishScore: boolean;
  isWordSprint: boolean;
}) {
  const theme = seatTheme(player.seat);
  const isMe = player.seat === mySeat;
  const isWinner = player.place === 1 && !player.dnf;

  return (
    <div
      className="word-sprint-player grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 px-1 py-4"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <span
        className={
          "text-sm tabular-nums " +
          (isWinner ? theme.text : "text-fg-dimmer")
        }
      >
        {player.dnf ? "—" : placeLabel(player.place)}
      </span>

      <span className="flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.2em] text-fg-dim">
        <span
          className={`inline-block size-1.5 rounded-full ${theme.bg}`}
          aria-hidden
        />
        <span className={isMe ? theme.text : undefined}>
          {seatName(player.seat, mySeat)}
        </span>
        {player.dnf ? (
          <span className="text-fg-dimmer text-[0.6rem]">left</span>
        ) : (
          player.finishedPassage && (
            <span className="text-ok text-[0.6rem]">finished</span>
          )
        )}
      </span>

      <span className="flex items-baseline gap-4 text-xs text-fg-dim">
        <span className="flex items-baseline gap-1.5">
          <span className={`text-2xl tabular-nums ${theme.text}`}>
            {isWordSprint ? formatSprintTime(player.elapsedMs) : player.wpm}
          </span>
          <span className="text-[0.6rem] uppercase tracking-[0.15em]">
            {isWordSprint ? "time" : "wpm"}
          </span>
        </span>
        <span className="tabular-nums text-fg-dim w-14 text-right">
          {player.accuracy}%
        </span>
        <span className="tabular-nums text-fg-dimmer w-16 text-right">
          {showFinishScore && !isWordSprint
            ? formatScore(finishModeScore(player))
            : formatElapsed(player.elapsedMs)}
        </span>
      </span>
    </div>
  );
}

/** The original side-by-side layout, kept for two-racer rooms. */
function DuelResults({
  standings,
  mySeat,
  showFinishScore,
  isWordSprint,
}: {
  standings: PlayerResult[];
  mySeat: Seat | null;
  showFinishScore: boolean;
  isWordSprint: boolean;
}) {
  const me = standings.find((player) => player.seat === mySeat);
  const them = standings.find((player) => player.seat !== mySeat);
  const left = me ?? standings[0];
  const right = them ?? standings[1];

  if (!left || !right) {
    return (
      <Standings
        standings={standings}
        mySeat={mySeat}
        showFinishScore={showFinishScore}
        isWordSprint={isWordSprint}
      />
    );
  }

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-10 items-center w-full">
      <ResultColumn
        label={seatName(left.seat, mySeat)}
        result={left}
        showFinishScore={showFinishScore}
        isWordSprint={isWordSprint}
        align="right"
      />
      <div className="h-24 w-px bg-border" aria-hidden />
      <ResultColumn
        label={left.seat === mySeat ? "rival" : seatName(right.seat, mySeat)}
        result={right}
        showFinishScore={showFinishScore}
        isWordSprint={isWordSprint}
        align="left"
      />
    </div>
  );
}

interface ResultColumnProps {
  label: string;
  result: PlayerResult;
  showFinishScore: boolean;
  isWordSprint: boolean;
  align: "left" | "right";
}

function ResultColumn({
  label,
  result,
  showFinishScore,
  isWordSprint,
  align,
}: ResultColumnProps) {
  const theme = seatTheme(result.seat);
  const alignment =
    align === "right" ? "items-end text-right" : "items-start text-left";

  return (
    <div className={`flex flex-col ${alignment} gap-4`}>
      <span className="text-[0.7rem] uppercase tracking-[0.2em] text-fg-dim flex items-center gap-1.5">
        <span
          className={`inline-block size-1.5 rounded-full ${theme.bg}`}
          aria-hidden
        />
        {label}
        {result.dnf ? (
          <span className="ml-1 text-[0.6rem] text-fg-dimmer">· left</span>
        ) : (
          result.finishedPassage && (
            <span className={`ml-1 text-[0.6rem] ${theme.text}`}>
              · finished
            </span>
          )
        )}
      </span>

      <div className="flex items-baseline gap-2">
        <span className={`text-5xl tabular-nums font-medium ${theme.text}`}>
          {isWordSprint ? formatSprintTime(result.elapsedMs) : result.wpm}
        </span>
        <span className="text-xs uppercase tracking-[0.15em] text-fg-dim">
          {isWordSprint ? "time" : "wpm"}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        {showFinishScore && !isWordSprint && (
          <Stat label="score" value={formatScore(finishModeScore(result))} />
        )}
        {isWordSprint && <Stat label="wpm" value={`${result.wpm}`} />}
        <Stat label="accuracy" value={`${result.accuracy}%`} />
        {!isWordSprint && (
          <Stat label="time" value={formatElapsed(result.elapsedMs)} />
        )}
        <Stat label="chars" value={`${result.correctCount}`} />
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

/* -------------------- rematch controls -------------------- */

interface RematchControlsProps {
  requested: boolean;
  readyCount: number;
  connectedCount: number;
  canRematch: boolean;
  isDuel: boolean;
  onRequest: () => void;
  onCancel: () => void;
  onNewRace: () => void;
}

function RematchControls({
  requested,
  readyCount,
  connectedCount,
  canRematch,
  isDuel,
  onRequest,
  onCancel,
  onNewRace,
}: RematchControlsProps) {
  // Not enough people left in the room to run another race.
  if (!canRematch) {
    return (
      <>
        <div className="flex items-center gap-4">
          <button
            disabled
            className="px-6 py-2 border border-border text-fg-dimmer cursor-not-allowed"
            aria-disabled="true"
            title="not enough racers left"
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
          {isDuel ? "rival left" : "not enough racers left"} · can't rematch
        </div>
        <div className="text-[0.65rem] text-fg-dimmer">
          press <span className="text-fg-dim">enter</span> to start a new race
        </div>
      </>
    );
  }

  const waitingOn = Math.max(0, connectedCount - readyCount);

  return (
    <>
      <div className="flex items-center gap-4">
        {requested ? (
          <button
            onClick={onCancel}
            className="px-6 py-2 border border-accent text-accent hover:bg-bg-soft transition-colors flex items-center gap-2"
          >
            <span className="inline-block size-1.5 rounded-full bg-accent animate-pulse" />
            waiting · {readyCount}/{connectedCount} ready
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
        {!requested && readyCount > 0 && (
          <span className="text-opponent">
            {readyCount} {readyCount === 1 ? "racer wants" : "racers want"} a
            rematch
          </span>
        )}
        {!requested && readyCount === 0 && (
          <span>
            press <span className="text-fg-dim">enter</span> for rematch
          </span>
        )}
        {requested && waitingOn > 0 && (
          <span>
            waiting on {waitingOn}{" "}
            {waitingOn === 1 ? "racer" : "racers"} to click rematch
          </span>
        )}
        {requested && waitingOn === 0 && (
          <span className="text-accent">everyone ready · new race starting</span>
        )}
      </div>
    </>
  );
}

/* -------------------- banner + helpers -------------------- */

function interpretOutcome(
  result: RaceResult | undefined,
  seat: Seat | null
): Outcome {
  if (!result || seat === null) return "tie";
  const me = result.players.find((player) => player.seat === seat);
  if (!me) return "tie";
  if (me.place !== 1) return "lose";
  const sharedTop =
    result.players.filter((player) => player.place === 1).length > 1;
  return sharedTop ? "tie" : "win";
}

function reasonLabel(result: RaceResult, isWordSprint: boolean): string {
  if (isWordSprint) {
    return "one word sprint · fastest clean finish wins";
  }
  if (result.endReason === "cap") {
    return "race hit its time cap · scored where everyone stood";
  }
  if (result.endReason === "disconnect") {
    return "everyone left · scored where the race stopped";
  }
  if (result.endReason === "finish") {
    return "finish mode · final score balances speed and accuracy";
  }
  return "time mode · higher wpm wins";
}

function Banner({
  outcome,
  place,
  fieldSize,
  reason,
}: {
  outcome: Outcome;
  place: number | null;
  fieldSize: number;
  reason: string;
}) {
  const title =
    outcome === "win" ? "you win" : outcome === "lose" ? "you lose" : "tie";

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
      <h2 className={`text-5xl md:text-6xl font-medium ${color}`}>{title}</h2>
      {fieldSize > 2 && place !== null && (
        <span className="text-sm text-fg-dim">
          {placeLabel(place)} of {fieldSize}
        </span>
      )}
      <span className="text-xs text-fg-dimmer mt-1">{reason}</span>
    </div>
  );
}

function placeLabel(place: number): string {
  if (place === 1) return "1st";
  if (place === 2) return "2nd";
  if (place === 3) return "3rd";
  return `${place}th`;
}

function formatSprintTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function finishModeScore(result: PlayerResult): number {
  const accuracyWeight = result.accuracy / 100;
  return result.wpm * accuracyWeight * accuracyWeight;
}

function formatScore(score: number): string {
  return score.toFixed(1);
}
