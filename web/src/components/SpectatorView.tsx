import { useEffect, useState } from "react";
import { Passage } from "./Passage";
import type {
  PlayerRole,
  PublicRoomState,
  RaceOutcome,
  RaceResult,
} from "../lib/protocol";
import type {
  SpectatorFinish,
  SpectatorProgress,
} from "../hooks/useRoom";
import { formatElapsed } from "../lib/wpm";

interface SpectatorViewProps {
  room: PublicRoomState;
  progress: SpectatorProgress;
  finish: SpectatorFinish;
}

export function SpectatorView({
  room,
  progress,
  finish,
}: SpectatorViewProps) {
  const now = useNow(room.status === "starting" || room.status === "racing");
  const host = progress.host;
  const guest = progress.guest;
  const hostDone = !!finish.host || !!room.result?.host.finishedPassage;
  const guestDone = !!finish.guest || !!room.result?.guest.finishedPassage;

  if (room.status === "waiting" || room.status === "ready_check") {
    return (
      <div className="flex flex-col items-center gap-8 w-full max-w-[800px] text-center">
        <ViewerHeader room={room} />
        <div className="opacity-60 pointer-events-none">
          <Passage passage={room.passage.text} typed="" showCursor={false} />
        </div>
        <p className="text-sm text-fg-dim">
          waiting for both racers to reconnect
        </p>
      </div>
    );
  }

  if (room.status === "ended") {
    return (
      <div className="flex flex-col items-center gap-8 w-full max-w-[800px]">
        <ViewerHeader room={room} />
        <ResultBanner result={room.result} />
        <SpectatorStats
          hostWpm={room.result?.host.wpm ?? finish.host?.wpm ?? host?.wpm ?? 0}
          guestWpm={room.result?.guest.wpm ?? finish.guest?.wpm ?? guest?.wpm ?? 0}
          hostDone={hostDone}
          guestDone={guestDone}
          hostAccuracy={room.result?.host.accuracy ?? finish.host?.accuracy ?? host?.accuracy}
          guestAccuracy={room.result?.guest.accuracy ?? finish.guest?.accuracy ?? guest?.accuracy}
        />
        <Passage
          passage={room.passage.text}
          typed=""
          showCursor={false}
          playerOnePos={room.result?.host.pos ?? host?.pos}
          playerTwoPos={room.result?.guest.pos ?? guest?.pos}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-[800px]">
      <ViewerHeader room={room} />

      {room.status === "starting" ? (
        <Countdown startAt={room.startAt} now={now} />
      ) : (
        <SpectatorStats
          hostWpm={host?.wpm ?? finish.host?.wpm ?? null}
          guestWpm={guest?.wpm ?? finish.guest?.wpm ?? null}
          hostDone={hostDone}
          guestDone={guestDone}
          hostAccuracy={host?.accuracy ?? finish.host?.accuracy}
          guestAccuracy={guest?.accuracy ?? finish.guest?.accuracy}
          timeLabel={room.config.endMode === "time" ? "time left" : "watching"}
          timeValue={
            room.config.endMode === "time" && room.endAt
              ? formatElapsed(Math.max(0, room.endAt - now))
              : formatElapsed(
                  Math.max(0, now - (room.startAt ?? now))
                )
          }
        />
      )}

      <Passage
        passage={room.passage.text}
        typed=""
        showCursor={false}
        playerOnePos={host?.pos}
        playerTwoPos={guest?.pos}
      />

      <div className="text-xs text-fg-dimmer">
        watch-only view. spectators cannot affect the race
      </div>
    </div>
  );
}

function ViewerHeader({ room }: { room: PublicRoomState }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span className="text-[0.7rem] uppercase tracking-[0.2em] text-fg-dim">
        watching live
      </span>
      <div className="flex items-center gap-4 text-xs text-fg-dim">
        <span>{room.spectatorCount} watching</span>
        <span className="text-fg-dimmer">.</span>
        <span>{room.config.passageLength} passage</span>
      </div>
    </div>
  );
}

function SpectatorStats({
  hostWpm,
  guestWpm,
  hostDone,
  guestDone,
  hostAccuracy,
  guestAccuracy,
  timeLabel = "watching",
  timeValue,
}: {
  hostWpm: number | null;
  guestWpm: number | null;
  hostDone: boolean;
  guestDone: boolean;
  hostAccuracy?: number;
  guestAccuracy?: number;
  timeLabel?: string;
  timeValue?: string;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-8 w-full">
      <PlayerStat
        label="Player 1"
        role="host"
        wpm={hostWpm}
        accuracy={hostAccuracy}
        done={hostDone}
        align="right"
      />
      <div className="flex flex-col items-center min-w-24">
        <span className="text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
          {timeLabel}
        </span>
        <span className="text-2xl tabular-nums text-fg">
          {timeValue ?? "live"}
        </span>
      </div>
      <PlayerStat
        label="Player 2"
        role="guest"
        wpm={guestWpm}
        accuracy={guestAccuracy}
        done={guestDone}
        align="left"
      />
    </div>
  );
}

function PlayerStat({
  label,
  role,
  wpm,
  accuracy,
  done,
  align,
}: {
  label: string;
  role: PlayerRole;
  wpm: number | null;
  accuracy?: number;
  done: boolean;
  align: "left" | "right";
}) {
  const color = role === "host" ? "text-accent" : "text-opponent";
  const dot = role === "host" ? "bg-accent" : "bg-opponent";
  return (
    <div
      className={`flex flex-col gap-1 ${
        align === "right" ? "items-end text-right" : "items-start text-left"
      }`}
    >
      <span className="text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim flex items-center gap-1.5">
        <span className={`inline-block size-1.5 rounded-full ${dot}`} />
        {label}
        {done && <span className={`${color} text-[0.6rem]`}>. done</span>}
      </span>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl tabular-nums ${color}`}>
          {wpm === null ? "-" : wpm}
        </span>
        <span className="text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
          wpm
        </span>
      </div>
      {accuracy !== undefined && (
        <span className="text-xs tabular-nums text-fg-dim">
          {accuracy}% accuracy
        </span>
      )}
    </div>
  );
}

function Countdown({ startAt, now }: { startAt?: number; now: number }) {
  if (!startAt) return <div className="h-[120px]" />;
  const seconds = Math.ceil((startAt - now) / 1000);
  return (
    <div className="h-[120px] flex flex-col items-center justify-center">
      <span className="text-[5rem] leading-none text-accent font-medium tabular-nums">
        {seconds > 0 ? seconds : "go!"}
      </span>
      <span className="text-[0.7rem] uppercase tracking-[0.2em] text-fg-dim mt-3">
        race starting
      </span>
    </div>
  );
}

function ResultBanner({ result }: { result?: RaceResult }) {
  if (!result) {
    return <h2 className="text-4xl text-fg">race over</h2>;
  }
  const winner = winnerLabel(result.outcome);
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span className="text-[0.75rem] uppercase tracking-[0.25em] text-fg-dim">
        race over
      </span>
      <h2 className="text-5xl md:text-6xl font-medium text-fg">
        {winner}
      </h2>
    </div>
  );
}

function winnerLabel(outcome: RaceOutcome): string {
  if (outcome === "host_wins") return "Player 1 wins";
  if (outcome === "guest_wins") return "Player 2 wins";
  return "tie";
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}
