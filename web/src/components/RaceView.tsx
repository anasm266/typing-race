import { useEffect, useRef, useState } from "react";
import { useTyping } from "../hooks/useTyping";
import { Passage } from "./Passage";
import { EndScreen } from "./EndScreen";
import { ReactionBar } from "./ReactionBar";
import { ReactionToast } from "./ReactionToast";
import { calcAccuracy, formatElapsed, type WpmSample } from "../lib/wpm";
import type {
  ClientMsg,
  FinishGraceInfo,
  PlayerRole,
  PublicRoomState,
} from "../lib/protocol";
import type {
  OpponentFinish,
  OpponentProgress,
  OpponentReaction,
} from "../hooks/useRoom";

interface RaceViewProps {
  room: PublicRoomState;
  role: PlayerRole | null;
  opponentProgress: OpponentProgress | null;
  opponentFinish: OpponentFinish | null;
  opponentReaction: OpponentReaction | null;
  send: (msg: ClientMsg) => void;
  onNewRace: () => void;
}

export function RaceView({
  room,
  role,
  opponentProgress,
  opponentFinish,
  opponentReaction,
  send,
  onNewRace,
}: RaceViewProps) {
  const { passage, status, startAt, config } = room;
  const racing = status === "racing";

  const typing = useTyping(passage.text, {
    startAt: racing ? startAt : undefined,
  });

  const now = useNow(status === "starting" || racing);

  // Accumulate opponent WPM samples for the post-race graph.
  const [opponentSamples, setOpponentSamples] = useState<WpmSample[]>(
    []
  );
  const lastOpponentWpmRef = useRef<number | null>(null);
  useEffect(() => {
    if (!racing || !startAt) return;
    if (!opponentProgress) return;
    if (lastOpponentWpmRef.current === opponentProgress.wpm) return;
    lastOpponentWpmRef.current = opponentProgress.wpm;
    const t = Math.round(((Date.now() - startAt) / 1000) * 10) / 10;
    setOpponentSamples((s) => [...s, { t, wpm: opponentProgress.wpm }]);
  }, [opponentProgress, racing, startAt]);

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
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "Backspace" || e.key === " " || e.key.length === 1) {
        e.preventDefault();
        if (status === "racing" && typing.state !== "done") {
          typing.handleKey(e.key);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [status, typing.state, typing.handleKey]);

  // Broadcast progress on every local position change.
  const latestRef = useRef({
    correctChars: 0,
    wpm: 0,
    accuracy: 100,
  });
  latestRef.current = {
    correctChars: typing.correctChars,
    wpm: typing.wpm,
    accuracy: calcAccuracy(
      typing.correctChars,
      typing.totalKeystrokes
    ),
  };
  useEffect(() => {
    if (!racing) return;
    if (typing.state === "idle") return;
    send({
      t: "progress",
      pos: typing.typed.length,
      correctCount: latestRef.current.correctChars,
      wpm: latestRef.current.wpm,
      accuracy: latestRef.current.accuracy,
    });
  }, [typing.typed.length, racing, typing.state, send]);

  // One-shot finished message.
  const finishedSentRef = useRef(false);
  useEffect(() => {
    if (typing.state !== "done") return;
    if (finishedSentRef.current) return;
    finishedSentRef.current = true;
    send({
      t: "finished",
      wpm: typing.wpm,
      accuracy: calcAccuracy(
        typing.correctChars,
        typing.totalKeystrokes
      ),
      elapsedMs: typing.elapsedMs,
      correctCount: typing.correctChars,
    });
  }, [
    typing.state,
    typing.wpm,
    typing.correctChars,
    typing.totalKeystrokes,
    typing.elapsedMs,
    send,
  ]);

  useEffect(() => {
    finishedSentRef.current = false;
  }, [passage.text]);

  // Render end screen once race is over, preserving sample history.
  if (status === "ended") {
    return (
      <EndScreen
        room={room}
        role={role}
        mySamples={typing.wpmSamples}
        opponentSamples={opponentSamples}
        onRematchRequest={() => send({ t: "rematch_request" })}
        onRematchCancel={() => send({ t: "rematch_cancel" })}
        onNewRace={onNewRace}
      />
    );
  }

  const opponentPos =
    opponentProgress?.pos ??
    (opponentFinish ? passage.text.length : undefined);

  const myRoleDone = typing.state === "done";
  const finishGraceForMe: FinishGraceInfo | null =
    room.finishGrace && role
      ? room.finishGrace.firstFinisher === role
        ? room.finishGrace // I'm the one who finished first
        : room.finishGrace // rival finished first; I'm racing the clock
      : null;

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-[800px]">
      {finishGraceForMe && (
        <FinishGraceBanner
          grace={finishGraceForMe}
          iFinishedFirst={
            !!role && finishGraceForMe.firstFinisher === role
          }
          now={now}
        />
      )}

      {status === "starting" ? (
        <Countdown startAt={startAt} now={now} />
      ) : (
        <StatsBar
          room={room}
          now={now}
          selfElapsedMs={typing.elapsedMs}
          selfWpm={typing.wpm}
          selfAccuracy={calcAccuracy(
            typing.correctChars,
            typing.totalKeystrokes
          )}
          opponentWpm={
            opponentProgress?.wpm ?? opponentFinish?.wpm ?? null
          }
          selfDone={myRoleDone}
          opponentDone={!!opponentFinish}
        />
      )}

      <Passage
        passage={passage.text}
        typed={typing.typed}
        opponentPos={opponentPos}
      />

      <ReactionBar send={send} />

      <FooterHint
        status={status}
        selfDone={myRoleDone}
        opponentDone={!!opponentFinish}
        endMode={config.endMode}
        hasFinishGrace={!!room.finishGrace}
      />

      <ReactionToast latest={opponentReaction} myRole={role} />
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
              · waiting for rival to complete
            </span>
          </>
        ) : (
          <>
            <span className="text-opponent">rival finished</span>
            <span className="text-fg-dim">
              {" "}
              · finish your passage to see full results
            </span>
          </>
        )}
      </span>
      <span className="text-sm tabular-nums text-fg">
        {remaining}s
      </span>
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

/* -------------------- stats bar -------------------- */

interface StatsBarProps {
  room: PublicRoomState;
  now: number;
  selfElapsedMs: number;
  selfWpm: number;
  selfAccuracy: number;
  opponentWpm: number | null;
  selfDone: boolean;
  opponentDone: boolean;
}

function StatsBar({
  room,
  now,
  selfElapsedMs,
  selfWpm,
  selfAccuracy,
  opponentWpm,
  selfDone,
  opponentDone,
}: StatsBarProps) {
  const isTimeMode = room.config.endMode === "time";
  const timeValue =
    isTimeMode && room.endAt
      ? formatElapsed(Math.max(0, room.endAt - now))
      : formatElapsed(selfElapsedMs);
  const timeLabel = isTimeMode ? "time left" : "time";

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-10 w-full">
      <PlayerStats
        label="you"
        wpm={selfWpm}
        accuracy={`${selfAccuracy}%`}
        done={selfDone}
        color="accent"
        align="right"
      />
      <div className="flex flex-col items-center">
        <span className="text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
          {timeLabel}
        </span>
        <span className="text-2xl tabular-nums text-fg">
          {timeValue}
        </span>
      </div>
      <PlayerStats
        label="rival"
        wpm={opponentWpm}
        accuracy={null}
        done={opponentDone}
        color="opponent"
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
  color: "accent" | "opponent";
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
  const textColor = color === "accent" ? "text-accent" : "text-opponent";
  const dotColor = color === "accent" ? "bg-accent" : "bg-opponent";
  const alignment = align === "right" ? "items-end" : "items-start";
  return (
    <div className={`flex flex-col ${alignment} gap-1`}>
      <span className="text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim flex items-center gap-1.5">
        <span className={`inline-block size-1.5 rounded-full ${dotColor}`} />
        {label}
        {done && (
          <span className={`ml-1 ${textColor} text-[0.6rem]`}>
            · done
          </span>
        )}
      </span>
      <div className="flex gap-3 items-baseline">
        <span className={`text-2xl tabular-nums ${textColor}`}>
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
  opponentDone,
  endMode,
  hasFinishGrace,
}: {
  status: PublicRoomState["status"];
  selfDone: boolean;
  opponentDone: boolean;
  endMode: "finish" | "time";
  hasFinishGrace: boolean;
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

  if (endMode === "time" && selfDone) {
    return (
      <div className="text-xs text-ok">
        you finished the passage · waiting for time to run out
      </div>
    );
  }
  if (selfDone && opponentDone) {
    return (
      <div className="text-xs text-fg-dim">calculating result...</div>
    );
  }
  if (selfDone) {
    return (
      <div className="text-xs text-ok">
        you finished · waiting for rival
      </div>
    );
  }
  if (opponentDone) {
    return (
      <div className="text-xs text-opponent">
        rival finished · keep going
      </div>
    );
  }
  return null;
}

/* -------------------- useNow -------------------- */

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}
