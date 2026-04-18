import { useEffect, useState } from "react";
import type { ClientMsg, PlayerRole, PublicRoomState } from "../lib/protocol";
import { Passage } from "./Passage";

interface ReadyCheckProps {
  room: PublicRoomState;
  role: PlayerRole | null;
  send: (msg: ClientMsg) => void;
}

export function ReadyCheck({ room, role, send }: ReadyCheckProps) {
  const [now, setNow] = useState(() => Date.now());
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const remainingSec = room.readyCheckUntil
    ? Math.max(0, Math.ceil((room.readyCheckUntil - now) / 1000))
    : 0;

  const lockIn = () => {
    if (sent) return;
    setSent(true);
    send({ t: "lock_in" });
  };

  // Any player can advance with Enter, though only the guest actually
  // sees the button (host just waits).
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
  });

  const isHost = role === "host";

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-[800px]">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex items-center gap-2 text-accent">
          <span className="inline-block size-1.5 rounded-full bg-accent" />
          <span className="text-[0.75rem] uppercase tracking-[0.2em]">
            rival is here
          </span>
        </div>
        <h2 className="text-2xl mt-1">
          {isHost ? (
            <>
              <span className="text-fg-dim">waiting on rival to</span>{" "}
              <span className="text-accent">lock in</span>
            </>
          ) : (
            <>
              <span>ready when you are</span>
            </>
          )}
        </h2>
      </div>

      <div className="opacity-60 pointer-events-none">
        <Passage passage={room.passage.text} typed="" />
      </div>

      {isHost ? (
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-sm text-fg-dim">
            <span className="inline-block size-1.5 rounded-full bg-fg-dim animate-pulse" />
            <span>rival hasn't locked in yet</span>
          </div>
          <span className="text-xs text-fg-dimmer">
            race auto-starts in{" "}
            <span className="text-fg-dim tabular-nums">
              {remainingSec}s
            </span>
          </span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={lockIn}
            disabled={sent}
            className={
              "px-8 py-3 border text-lg transition-colors " +
              (sent
                ? "border-accent text-accent bg-accent/5 cursor-default"
                : "border-accent text-accent hover:bg-accent hover:text-bg")
            }
          >
            {sent ? "locked in · starting..." : "lock in"}
          </button>
          <span className="text-xs text-fg-dimmer">
            press <span className="text-fg-dim">enter</span> or{" "}
            <span className="text-fg-dim">space</span> · auto-start in{" "}
            <span className="text-fg-dim tabular-nums">
              {remainingSec}s
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
