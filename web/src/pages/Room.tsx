import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useRoom } from "../hooks/useRoom";
import { RaceView } from "../components/RaceView";

export function Room() {
  const params = useParams<{ id: string }>();
  const roomId = params.id ?? "";
  const [, setLocation] = useLocation();
  const {
    roomState,
    connectionState,
    error,
    opponentProgress,
    opponentFinish,
    send,
  } = useRoom(roomId);

  if (error === "room_not_found") {
    return (
      <StatusScreen
        title="this room has expired"
        subtitle="the link is stale or the race already ended"
        cta={{ label: "create your own", onClick: () => setLocation("/") }}
      />
    );
  }

  if (error === "room_full") {
    return (
      <StatusScreen
        title="race already in progress"
        subtitle="this room has two players already"
        cta={{ label: "create your own", onClick: () => setLocation("/") }}
      />
    );
  }

  if (connectionState === "connecting") {
    return <StatusScreen title="connecting..." />;
  }

  if (connectionState !== "open" || !roomState) {
    return (
      <StatusScreen
        title="connection lost"
        subtitle={error ?? "try reopening the link"}
        cta={{ label: "back home", onClick: () => setLocation("/") }}
      />
    );
  }

  if (roomState.status === "waiting") {
    return <WaitingLobby roomId={roomId} />;
  }

  return (
    <RaceView
      room={roomState}
      opponentProgress={opponentProgress}
      opponentFinish={opponentFinish}
      send={send}
    />
  );
}

function StatusScreen({
  title,
  subtitle,
  cta,
}: {
  title: string;
  subtitle?: string;
  cta?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h2 className="text-2xl">{title}</h2>
      {subtitle && <p className="text-fg-dim text-sm">{subtitle}</p>}
      {cta && (
        <button
          onClick={cta.onClick}
          className="mt-4 px-6 py-2 border border-accent text-accent hover:bg-accent hover:text-bg transition-colors"
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}

function WaitingLobby({ roomId }: { roomId: string }) {
  const shareUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/room/${roomId}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }

  return (
    <div className="flex flex-col items-center gap-10 w-full max-w-[640px] text-center">
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 text-fg-dim">
          <span className="inline-block size-2 rounded-full bg-accent animate-pulse" />
          <span className="text-[0.75rem] uppercase tracking-[0.2em]">
            waiting for opponent
          </span>
        </div>
        <h2 className="text-2xl mt-2">send this link</h2>
      </div>

      <div className="flex flex-col gap-2 w-full">
        <div className="flex gap-2 w-full">
          <input
            ref={inputRef}
            readOnly
            value={shareUrl}
            onClick={(e) => e.currentTarget.select()}
            className="flex-1 bg-bg-soft border border-border px-4 py-3 text-fg text-sm font-mono focus:outline-none focus:border-accent selection:bg-accent/30"
          />
          <button
            onClick={copy}
            className={
              "px-5 py-3 border text-sm transition-colors " +
              (copied
                ? "border-ok text-ok"
                : "border-border text-fg-dim hover:border-accent hover:text-accent")
            }
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
        <span className="text-xs text-fg-dimmer">
          text it, post it, paste it — race starts when they open it
        </span>
      </div>

      <Link
        href="/"
        className="text-xs text-fg-dim hover:text-accent transition-colors"
      >
        ← cancel
      </Link>
    </div>
  );
}

