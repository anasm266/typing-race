import { useCallback, useEffect, useState } from "react";
import type { ClientMsg, PublicRoomState, Seat } from "../lib/protocol";
import { seatName, seatTheme } from "../lib/seats";
import { Passage } from "./Passage";

interface ReadyCheckProps {
  room: PublicRoomState;
  seat: Seat | null;
  send: (msg: ClientMsg) => void;
}

export function ReadyCheck({ room, seat, send }: ReadyCheckProps) {
  const [sent, setSent] = useState(false);

  const me = room.players.find((player) => player.seat === seat);
  const alreadyReady = !!me?.ready;
  const waitingOn = room.players.filter(
    (player) => player.connected && !player.ready
  );
  const isDuel = room.players.length <= 2;

  const lockIn = useCallback(() => {
    if (sent || alreadyReady) return;
    setSent(true);
    send({ t: "lock_in" });
  }, [sent, alreadyReady, send]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      )
        return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        lockIn();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lockIn]);

  const locked = sent || alreadyReady;

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-[800px]">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex items-center gap-2 text-accent">
          <span className="inline-block size-1.5 rounded-full bg-accent" />
          <span className="text-[0.75rem] uppercase tracking-[0.2em]">
            {isDuel ? "rival is here" : "everyone is here"}
          </span>
        </div>
        <h2 className="text-2xl mt-1">
          {locked ? (
            <>
              <span className="text-fg-dim">waiting on</span>{" "}
              <span className="text-accent">
                {waitingOn.length}{" "}
                {waitingOn.length === 1 ? "racer" : "racers"}
              </span>
            </>
          ) : (
            <span>ready when you are</span>
          )}
        </h2>
      </div>

      <ReadyRoster room={room} mySeat={seat} />

      <div className="opacity-60 pointer-events-none">
        <Passage passage={room.passage.text} typed="" showCursor={false} />
      </div>

      {locked ? (
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-sm text-fg-dim">
            <span className="inline-block size-1.5 rounded-full bg-fg-dim animate-pulse" />
            <span>
              {waitingOn.length === 0
                ? "starting..."
                : `${waitingOn
                    .map((player) => seatName(player.seat, seat))
                    .join(", ")} hasn't locked in yet`}
            </span>
          </div>
          <span className="text-xs text-fg-dimmer">
            race starts when everyone locks in · safety auto-start is on
          </span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={lockIn}
            className="px-8 py-3 border border-accent text-accent text-lg hover:bg-accent hover:text-bg transition-colors"
          >
            lock in
          </button>
          <span className="text-xs text-fg-dimmer">
            press <span className="text-fg-dim">enter</span> or{" "}
            <span className="text-fg-dim">space</span> · then the countdown
            starts
          </span>
        </div>
      )}
    </div>
  );
}

function ReadyRoster({
  room,
  mySeat,
}: {
  room: PublicRoomState;
  mySeat: Seat | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {room.players.map((player) => {
        const theme = seatTheme(player.seat);
        return (
          <span
            key={player.seat}
            className={
              "seat-chip flex items-center gap-2 border px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.15em] transition-colors " +
              (player.ready
                ? `${theme.borderSoft} ${theme.text}`
                : "border-border text-fg-dim")
            }
          >
            <span
              className={
                `inline-block size-1.5 rounded-full ${theme.bg} ` +
                (player.ready ? "" : "opacity-40")
              }
              aria-hidden
            />
            {seatName(player.seat, mySeat)}
            <span className="text-fg-dimmer normal-case tracking-normal">
              {player.ready ? "ready" : "..."}
            </span>
          </span>
        );
      })}
    </div>
  );
}
