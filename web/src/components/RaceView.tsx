import { useEffect, useMemo, useRef, useState } from "react";
import { useCapsLock } from "../hooks/useCapsLock";
import { useTyping } from "../hooks/useTyping";
import { CapsLockWarning } from "./CapsLockWarning";
import { Passage, type PassageCursor } from "./Passage";
import { EndScreen } from "./EndScreen";
import { RaceRail, type RailPlayer } from "./RaceRail";
import { ReactionBar } from "./ReactionBar";
import { ReactionToast } from "./ReactionToast";
import { TouchKeyboardInput } from "./TouchKeyboardInput";
import { calcAccuracy, formatElapsed, type WpmSample } from "../lib/wpm";
import {
  clearRaceProgress,
  loadRaceProgress,
  saveRaceProgress,
} from "../lib/raceProgress";
import { seatName, seatTheme } from "../lib/seats";
import type {
  ClientMsg,
  FinishGraceInfo,
  PublicRoomState,
  Seat,
} from "../lib/protocol";
import type { LivePlayers, ReactionEvent } from "../hooks/useRoom";

interface RaceViewProps {
  room: PublicRoomState;
  seat: Seat | null;
  livePlayers: LivePlayers;
  reactions: ReactionEvent[];
  send: (msg: ClientMsg) => void;
  onNewRace: () => void;
}

export function RaceView({
  room,
  seat,
  livePlayers,
  reactions,
  send,
  onNewRace,
}: RaceViewProps) {
  const { passage, status, startAt, config } = room;
  const racing = status === "racing";
  const capsLockOn = useCapsLock(
    status === "starting" || status === "racing"
  );
  const serverOffsetMs = room.serverOffsetMs ?? 0;
  const now = useServerNow(
    serverOffsetMs,
    status === "starting" || racing
  );
  const localStartAt =
    startAt === undefined ? undefined : startAt - serverOffsetMs;

  // Reconnecting into a live race restores the characters already typed;
  // the server held the seat but only knows the position, not the text.
  const [restored] = useState(() =>
    status === "racing" ? loadRaceProgress(room.roomId, passage.id) : null
  );

  const typing = useTyping(passage.text, {
    startAt: racing ? localStartAt : undefined,
    initial: restored ?? undefined,
  });
  const {
    state: typingState,
    typed,
    correctChars,
    totalKeystrokes,
    elapsedMs,
    wpm,
    wpmSamples,
    handleKey,
  } = typing;
  const selfAccuracy = calcAccuracy(correctChars, totalKeystrokes);

  const rivals = useMemo(
    () => room.players.filter((player) => player.seat !== seat),
    [room.players, seat]
  );
  const isDuel = room.players.length <= 2;

  // Sample rival WPM once a second for the post-race graph, matching the
  // cadence useTyping uses locally. Sampling on a timer rather than on each
  // inbound message keeps the graph evenly spaced and avoids doing work on
  // the hot progress path.
  const [rivalSamples, setRivalSamples] = useState<
    Record<number, WpmSample[]>
  >({});
  const livePlayersRef = useRef(livePlayers);
  useEffect(() => {
    livePlayersRef.current = livePlayers;
  }, [livePlayers]);

  useEffect(() => {
    if (!racing || startAt === undefined) return;
    const id = window.setInterval(() => {
      const elapsedSec = (Date.now() + serverOffsetMs - startAt) / 1000;
      if (elapsedSec <= 0) return;
      const t = Math.round(elapsedSec * 10) / 10;
      const snapshot = livePlayersRef.current;
      setRivalSamples((previous) => {
        const next = { ...previous };
        for (const [key, live] of Object.entries(snapshot)) {
          const rivalSeat = Number(key);
          next[rivalSeat] = [
            ...(next[rivalSeat] ?? []),
            { t, wpm: live.wpm },
          ];
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [racing, startAt, serverOffsetMs]);

  // Always-on keyboard listener: preventDefault during both countdown
  // and race so Space doesn't scroll the page; forward to handleKey only
  // when the race is actually live.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (status !== "starting" && status !== "racing") return;

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      )
        return;

      // Word-delete: Ctrl+Backspace on Windows/Linux, Alt+Backspace on Mac.
      // Translated into a synthetic "CtrlBackspace" key id for useTyping.
      if (e.key === "Backspace" && (e.ctrlKey || e.altKey)) {
        e.preventDefault();
        if (status === "racing" && typingState !== "done") {
          handleKey("CtrlBackspace");
        }
        return;
      }

      // Leave other browser shortcuts (Ctrl+R, Ctrl+L, etc.) alone.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "Backspace" || e.key === " " || e.key.length === 1) {
        e.preventDefault();
        if (status === "racing" && typingState !== "done") {
          handleKey(e.key);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [status, typingState, handleKey]);

  // Broadcast progress on every local position change.
  useEffect(() => {
    if (!racing) return;
    if (typingState === "idle") return;
    send({
      t: "progress",
      pos: typed.length,
      correctCount: correctChars,
      wpm,
      accuracy: selfAccuracy,
    });
  }, [typed.length, racing, typingState, correctChars, wpm, selfAccuracy, send]);

  // Mirror progress locally so a dropped connection can resume mid-passage.
  useEffect(() => {
    if (!racing) return;
    saveRaceProgress(room.roomId, passage.id, { typed, totalKeystrokes });
  }, [racing, room.roomId, passage.id, typed, totalKeystrokes]);

  useEffect(() => {
    if (status === "ended") clearRaceProgress(room.roomId);
  }, [status, room.roomId]);

  // One-shot finished message.
  const finishedSentRef = useRef(false);
  useEffect(() => {
    if (typingState !== "done") return;
    if (finishedSentRef.current) return;
    finishedSentRef.current = true;
    send({
      t: "finished",
      wpm,
      accuracy: selfAccuracy,
      elapsedMs,
      correctCount: correctChars,
    });
  }, [typingState, wpm, selfAccuracy, elapsedMs, correctChars, send]);

  useEffect(() => {
    finishedSentRef.current = false;
  }, [passage.text]);

  // Render end screen once race is over, preserving sample history.
  if (status === "ended") {
    return (
      <EndScreen
        room={room}
        seat={seat}
        mySamples={wpmSamples}
        rivalSamples={rivalSamples}
        onRematchRequest={() => send({ t: "rematch_request" })}
        onRematchCancel={() => send({ t: "rematch_cancel" })}
        onNewRace={onNewRace}
      />
    );
  }

  const passageLength = Math.max(1, passage.text.length);
  const cursors: PassageCursor[] = rivals
    .map((rival) => {
      const live = livePlayers[rival.seat];
      if (!live) return null;
      const pos = live.finished ? passage.text.length : live.pos;
      return {
        seat: rival.seat,
        pos,
        color: seatTheme(rival.seat).color,
        label: seatTheme(rival.seat).label,
      } satisfies PassageCursor;
    })
    .filter((cursor): cursor is PassageCursor => cursor !== null);

  const railPlayers: RailPlayer[] = room.players.map((player) => {
    const isSelf = player.seat === seat;
    const live = livePlayers[player.seat];
    return {
      seat: player.seat,
      name: seatName(player.seat, seat),
      wpm: isSelf ? wpm : (live?.wpm ?? null),
      progress: isSelf
        ? typed.length / passageLength
        : (live?.finished ? passageLength : (live?.pos ?? 0)) / passageLength,
      finished: isSelf ? typingState === "done" : !!live?.finished,
      connected: player.connected,
      isSelf,
    };
  });

  const myRoleDone = typingState === "done";
  const duelRival = isDuel ? rivals[0] : undefined;
  const duelRivalLive = duelRival ? livePlayers[duelRival.seat] : undefined;

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-[800px]">
      {room.finishGrace && (
        <FinishGraceBanner
          grace={room.finishGrace}
          iFinishedFirst={
            seat !== null && room.finishGrace.firstFinisherSeat === seat
          }
          now={now}
        />
      )}

      {status === "starting" ? (
        <Countdown startAt={startAt} now={now} />
      ) : isDuel ? (
        <DuelStats
          room={room}
          seat={seat}
          now={now}
          selfElapsedMs={elapsedMs}
          selfWpm={wpm}
          selfAccuracy={selfAccuracy}
          rivalSeat={duelRival?.seat ?? null}
          rivalWpm={duelRivalLive?.wpm ?? null}
          selfDone={myRoleDone}
          rivalDone={!!duelRivalLive?.finished}
        />
      ) : (
        <div className="flex w-full flex-col gap-4">
          <RaceClock room={room} now={now} selfElapsedMs={elapsedMs} />
          <RaceRail players={railPlayers} />
        </div>
      )}

      <div className="w-full max-w-[800px]">
        <TouchKeyboardInput
          typed={typed}
          canFocus={status === "starting" || status === "racing"}
          canType={status === "racing" && typingState !== "done"}
          onKey={handleKey}
        >
          <Passage
            passage={passage.text}
            typed={typed}
            cursors={cursors}
            selfColor={
              seat === null ? undefined : seatTheme(seat).color
            }
            showTags={!isDuel}
          />
        </TouchKeyboardInput>
      </div>

      <CapsLockWarning visible={capsLockOn} />

      <ReactionBar send={send} />

      <FooterHint
        status={status}
        selfDone={myRoleDone}
        othersDone={rivals.every(
          (rival) => livePlayers[rival.seat]?.finished
        )}
        endMode={config.endMode}
        hasFinishGrace={!!room.finishGrace}
        isDuel={isDuel}
      />

      <ReactionToast reactions={reactions} mySeat={seat} />
    </div>
  );
}

/* -------------------- finish grace banner -------------------- */

function FinishGraceBanner({
  grace,
  iFinishedFirst,
  now,
}: {
  grace: FinishGraceInfo;
  iFinishedFirst: boolean;
  now: number;
}) {
  const remaining = Math.max(
    0,
    Math.ceil((grace.graceUntil - now) / 1000)
  );
  return (
    <div className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-accent/40 bg-accent/5">
      <span className="inline-block size-1.5 rounded-full bg-accent animate-pulse" />
      <span className="text-sm">
        {iFinishedFirst ? (
          <>
            <span className="text-accent">you finished first</span>
            <span className="text-fg-dim">
              {" "}
              · waiting on the rest of the field
            </span>
          </>
        ) : (
          <>
            <span className="text-opponent">
              {seatTheme(grace.firstFinisherSeat).label} finished
            </span>
            <span className="text-fg-dim">
              {" "}
              · finish strong before the result locks in
            </span>
          </>
        )}
      </span>
      <span className="text-sm tabular-nums text-fg">{remaining}s</span>
    </div>
  );
}

/* -------------------- countdown -------------------- */

function Countdown({
  startAt,
  now,
}: {
  startAt?: number;
  now: number;
}) {
  if (!startAt) {
    return <div className="h-[160px]" />;
  }
  const remainingMs = startAt - now;
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <div className="h-[160px] flex flex-col items-center justify-center">
      {seconds > 0 ? (
        <span
          key={seconds}
          className="countdown-number text-[6rem] leading-none text-accent font-medium tabular-nums"
        >
          {seconds}
        </span>
      ) : (
        <span className="countdown-go text-[5rem] leading-none text-accent font-medium tracking-wider">
          go!
        </span>
      )}
      <span className="text-[0.7rem] uppercase tracking-[0.2em] text-fg-dim mt-4">
        {seconds > 0 ? "get ready" : "race starting"}
      </span>
    </div>
  );
}

/* -------------------- clocks and stats -------------------- */

function raceTime(
  room: PublicRoomState,
  now: number,
  selfElapsedMs: number
): { label: string; value: string } {
  const isTimeMode = room.config.endMode === "time";
  return {
    label: isTimeMode ? "time left" : "time",
    value:
      isTimeMode && room.endAt
        ? formatElapsed(Math.max(0, room.endAt - now))
        : formatElapsed(selfElapsedMs),
  };
}

function RaceClock({
  room,
  now,
  selfElapsedMs,
}: {
  room: PublicRoomState;
  now: number;
  selfElapsedMs: number;
}) {
  const { label, value } = raceTime(room, now, selfElapsedMs);
  return (
    <div className="flex flex-col items-center">
      <span className="text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
        {label}
      </span>
      <span className="text-3xl tabular-nums text-fg">{value}</span>
    </div>
  );
}

interface DuelStatsProps {
  room: PublicRoomState;
  seat: Seat | null;
  now: number;
  selfElapsedMs: number;
  selfWpm: number;
  selfAccuracy: number;
  rivalSeat: Seat | null;
  rivalWpm: number | null;
  selfDone: boolean;
  rivalDone: boolean;
}

/** The original head-to-head layout, kept for two-racer rooms. */
function DuelStats({
  room,
  seat,
  now,
  selfElapsedMs,
  selfWpm,
  selfAccuracy,
  rivalSeat,
  rivalWpm,
  selfDone,
  rivalDone,
}: DuelStatsProps) {
  const { label, value } = raceTime(room, now, selfElapsedMs);

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-10 w-full">
      <PlayerStats
        label="you"
        wpm={selfWpm}
        accuracy={`${selfAccuracy}%`}
        done={selfDone}
        color={seat === null ? "var(--color-accent)" : seatTheme(seat).color}
        align="right"
      />
      <div className="flex flex-col items-center">
        <span className="text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
          {label}
        </span>
        <span className="text-2xl tabular-nums text-fg">{value}</span>
      </div>
      <PlayerStats
        label="rival"
        wpm={rivalWpm}
        accuracy={null}
        done={rivalDone}
        color={
          rivalSeat === null
            ? "var(--color-opponent)"
            : seatTheme(rivalSeat).color
        }
        align="left"
      />
    </div>
  );
}

interface PlayerStatsProps {
  label: string;
  wpm: number | null;
  accuracy: string | null;
  done: boolean;
  color: string;
  align: "left" | "right";
}

function PlayerStats({
  label,
  wpm,
  accuracy,
  done,
  color,
  align,
}: PlayerStatsProps) {
  const alignment = align === "right" ? "items-end" : "items-start";
  return (
    <div className={`flex flex-col ${alignment} gap-1`}>
      <span className="text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim flex items-center gap-1.5">
        <span
          className="inline-block size-1.5 rounded-full"
          style={{ background: color }}
        />
        {label}
        {done && (
          <span className="ml-1 text-[0.6rem]" style={{ color }}>
            · done
          </span>
        )}
      </span>
      <div className="flex gap-3 items-baseline">
        <span className="text-2xl tabular-nums" style={{ color }}>
          {wpm === null ? "—" : wpm}
        </span>
        <span className="text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
          wpm
        </span>
        {accuracy && (
          <span className="text-sm tabular-nums text-fg-dim ml-2">
            {accuracy}
          </span>
        )}
      </div>
    </div>
  );
}

/* -------------------- footer hint -------------------- */

function FooterHint({
  status,
  selfDone,
  othersDone,
  endMode,
  hasFinishGrace,
  isDuel,
}: {
  status: PublicRoomState["status"];
  selfDone: boolean;
  othersDone: boolean;
  endMode: "finish" | "time";
  hasFinishGrace: boolean;
  isDuel: boolean;
}) {
  if (status === "starting") {
    return (
      <div className="text-xs text-fg-dimmer">
        get ready · input unlocks in a moment
      </div>
    );
  }
  // In finish mode the prominent banner at the top already explains
  // what's happening — keep the footer quiet so the UI doesn't shout.
  if (hasFinishGrace) return null;

  const others = isDuel ? "rival" : "the field";

  if (endMode === "time" && selfDone) {
    return (
      <div className="text-xs text-ok">
        you finished the passage · waiting for time to run out
      </div>
    );
  }
  if (selfDone && othersDone) {
    return <div className="text-xs text-fg-dim">calculating result...</div>;
  }
  if (selfDone) {
    return (
      <div className="text-xs text-ok">
        you finished · waiting for {others}
      </div>
    );
  }
  if (othersDone) {
    return (
      <div className="text-xs text-opponent">
        {isDuel ? "rival finished" : "everyone else finished"} · keep going
      </div>
    );
  }
  return null;
}

/* -------------------- server-synced clock -------------------- */

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
