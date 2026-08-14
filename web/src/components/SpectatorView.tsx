import { useEffect, useState } from "react";
import { Passage, type PassageCursor } from "./Passage";
import { RaceRail, type RailPlayer } from "./RaceRail";
import type { PublicRoomState, RaceResult, Seat } from "../lib/protocol";
import type { LivePlayers } from "../hooks/useRoom";
import { seatTheme } from "../lib/seats";
import { formatElapsed } from "../lib/wpm";

interface SpectatorViewProps {
  room: PublicRoomState;
  livePlayers: LivePlayers;
}

export function SpectatorView({ room, livePlayers }: SpectatorViewProps) {
  const now = useServerNow(
    room.serverOffsetMs ?? 0,
    room.status === "starting" || room.status === "racing"
  );

  const passageLength = Math.max(1, room.passage.text.length);
  const resultBySeat = new Map(
    (room.result?.players ?? []).map((player) => [player.seat, player])
  );

  const railPlayers: RailPlayer[] = room.players.map((player) => {
    const live = livePlayers[player.seat];
    const final = resultBySeat.get(player.seat);
    const pos = final?.pos ?? (live?.finished ? passageLength : live?.pos ?? 0);
    return {
      seat: player.seat,
      name: seatTheme(player.seat).label,
      wpm: final?.wpm ?? live?.wpm ?? null,
      progress: pos / passageLength,
      finished: final?.finishedPassage ?? !!live?.finished,
      connected: player.connected,
      isSelf: false,
    };
  });

  const cursors: PassageCursor[] = room.players
    .map((player) => {
      const live = livePlayers[player.seat];
      const final = resultBySeat.get(player.seat);
      const pos =
        final?.pos ??
        (live ? (live.finished ? room.passage.text.length : live.pos) : null);
      if (pos === null) return null;
      return {
        seat: player.seat,
        pos,
        color: seatTheme(player.seat).color,
        label: seatTheme(player.seat).label,
      } satisfies PassageCursor;
    })
    .filter((cursor): cursor is PassageCursor => cursor !== null);

  if (room.status === "waiting" || room.status === "ready_check") {
    return (
      <div className="flex flex-col items-center gap-8 w-full max-w-[800px] text-center">
        <ViewerHeader room={room} />
        <div className="opacity-60 pointer-events-none">
          <Passage passage={room.passage.text} typed="" showCursor={false} />
        </div>
        <p className="text-sm text-fg-dim">
          waiting for the racers to line up
        </p>
      </div>
    );
  }

  const timeLabel =
    room.config.endMode === "time" ? "time left" : "watching";
  const timeValue =
    room.config.endMode === "time" && room.endAt
      ? formatElapsed(Math.max(0, room.endAt - now))
      : formatElapsed(Math.max(0, now - (room.startAt ?? now)));

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-[800px]">
      <ViewerHeader room={room} />

      {room.status === "ended" ? (
        <ResultBanner result={room.result} />
      ) : room.status === "starting" ? (
        <Countdown startAt={room.startAt} now={now} />
      ) : (
        <div className="flex flex-col items-center">
          <span className="text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
            {timeLabel}
          </span>
          <span className="text-2xl tabular-nums text-fg">{timeValue}</span>
        </div>
      )}

      <RaceRail players={railPlayers} />

      <Passage
        passage={room.passage.text}
        typed=""
        showCursor={false}
        cursors={cursors}
        showTags={room.players.length > 2}
      />

      {room.status !== "ended" && (
        <div className="text-xs text-fg-dimmer">
          watch-only view. spectators cannot affect the race
        </div>
      )}
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
        <span className="text-fg-dimmer">·</span>
        <span>{room.players.length} racing</span>
        <span className="text-fg-dimmer">·</span>
        <span>{room.config.passageLength} passage</span>
      </div>
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
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span className="text-[0.75rem] uppercase tracking-[0.25em] text-fg-dim">
        race over
      </span>
      <h2 className="text-5xl md:text-6xl font-medium text-fg">
        {winnerLabel(result.winnerSeat)}
      </h2>
    </div>
  );
}

function winnerLabel(winnerSeat: Seat | null): string {
  if (winnerSeat === null) return "tie";
  return `${seatTheme(winnerSeat).label} wins`;
}

function useServerNow(offsetMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(
      () => setNow(Date.now() + offsetMs),
      100
    );
    return () => window.clearInterval(id);
  }, [active, offsetMs]);
  return now;
}
