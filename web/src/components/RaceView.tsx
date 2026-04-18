import { useEffect, useRef, useState } from "react";
import { useTyping } from "../hooks/useTyping";
import { Passage } from "./Passage";
import { calcAccuracy, formatElapsed } from "../lib/wpm";
import type {
  ClientMsg,
  PublicRoomState,
} from "../lib/protocol";
import type {
  OpponentFinish,
  OpponentProgress,
} from "../hooks/useRoom";

interface RaceViewProps {
  room: PublicRoomState;
  opponentProgress: OpponentProgress | null;
  opponentFinish: OpponentFinish | null;
  send: (msg: ClientMsg) => void;
}

export function RaceView({
  room,
  opponentProgress,
  opponentFinish,
  send,
}: RaceViewProps) {
  const { passage, status, startAt } = room;
  const racing = status === "racing";

  const typing = useTyping(passage.text, {
    startAt: racing ? startAt : undefined,
  });

  const [now, setNow] = useState(() => Date.now());

  // Pre-race ticker for the "starting in N..." display.
  useEffect(() => {
    if (status !== "starting") return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [status]);

  // Keystroke capture — only when racing and not already done.
  useEffect(() => {
    if (!racing || typing.state === "done") return;

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      )
        return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "Backspace" || e.key === " " || e.key.length === 1) {
        e.preventDefault();
        typing.handleKey(e.key);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [racing, typing.state, typing.handleKey]);

  // Broadcast progress on every local position change.
  // We read latest correctChars/wpm via refs to avoid re-firing on timer ticks.
  const latestRef = useRef({ correctChars: 0, wpm: 0 });
  latestRef.current = {
    correctChars: typing.correctChars,
    wpm: typing.wpm,
  };
  useEffect(() => {
    if (!racing) return;
    if (typing.state === "idle") return;
    send({
      t: "progress",
      pos: typing.typed.length,
      correctCount: latestRef.current.correctChars,
      wpm: latestRef.current.wpm,
    });
  }, [typing.typed.length, racing, typing.state, send]);

  // On local finish, tell the server once.
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
    });
  }, [typing.state, typing.wpm, typing.correctChars, typing.totalKeystrokes, typing.elapsedMs, send]);

  // Reset "finished" flag if passage changes (e.g., rematch later).
  useEffect(() => {
    finishedSentRef.current = false;
  }, [passage.text]);

  const preRaceRemaining =
    startAt !== undefined && status === "starting"
      ? Math.max(0, Math.ceil((startAt - now) / 1000))
      : 0;

  const opponentPos = opponentProgress?.pos ?? (opponentFinish ? passage.text.length : undefined);

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-[800px]">
      {status === "starting" ? (
        <StartingBanner seconds={preRaceRemaining} />
      ) : (
        <StatsBar
          elapsedMs={typing.elapsedMs}
          selfWpm={typing.wpm}
          selfAccuracy={calcAccuracy(
            typing.correctChars,
            typing.totalKeystrokes
          )}
          opponentWpm={opponentProgress?.wpm ?? opponentFinish?.wpm ?? null}
          selfDone={typing.state === "done"}
          opponentDone={!!opponentFinish}
        />
      )}

      <Passage
        passage={passage.text}
        typed={typing.typed}
        opponentPos={opponentPos}
      />

      <FooterHint
        status={status}
        selfDone={typing.state === "done"}
        opponentDone={!!opponentFinish}
      />
    </div>
  );
}

function StartingBanner({ seconds }: { seconds: number }) {
  const label =
    seconds > 0 ? (
      <span>
        <span className="text-accent">starting</span> in{" "}
        <span className="text-accent">{seconds}</span>
      </span>
    ) : (
      <span className="text-accent">go!</span>
    );
  return (
    <div className="flex items-center justify-center h-[72px] text-xl tracking-wide">
      {label}
    </div>
  );
}

interface StatsBarProps {
  elapsedMs: number;
  selfWpm: number;
  selfAccuracy: number;
  opponentWpm: number | null;
  selfDone: boolean;
  opponentDone: boolean;
}

function StatsBar({
  elapsedMs,
  selfWpm,
  selfAccuracy,
  opponentWpm,
  selfDone,
  opponentDone,
}: StatsBarProps) {
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
          time
        </span>
        <span className="text-2xl tabular-nums text-fg">
          {formatElapsed(elapsedMs)}
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
  const alignment = align === "right" ? "items-end" : "items-start";
  return (
    <div className={`flex flex-col ${alignment} gap-1`}>
      <span className="text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim flex items-center gap-1.5">
        <span className={`inline-block size-1.5 rounded-full ${color === "accent" ? "bg-accent" : "bg-opponent"}`} />
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

function FooterHint({
  status,
  selfDone,
  opponentDone,
}: {
  status: PublicRoomState["status"];
  selfDone: boolean;
  opponentDone: boolean;
}) {
  if (status === "starting") {
    return (
      <div className="text-xs text-fg-dimmer">
        get ready · input unlocks in a moment
      </div>
    );
  }
  if (selfDone && opponentDone) {
    return (
      <div className="text-xs text-fg-dim">
        both finished · winner screen + rematch coming in M4/M5
      </div>
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
