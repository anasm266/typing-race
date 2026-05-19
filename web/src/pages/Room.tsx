import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useRoom } from "../hooks/useRoom";
import { RaceView } from "../components/RaceView";
import { ReadyCheck } from "../components/ReadyCheck";
import { SpectatorView } from "../components/SpectatorView";
import { trackEvent } from "../lib/analytics";
import {
  canNativeShare,
  copyText,
  nativeShareInvite,
  raceInviteMessage,
  roomShareUrl,
  watchInviteMessage,
} from "../lib/share";

export function Room() {
  const params = useParams<{ id: string }>();
  const roomId = params.id ?? "";
  return <RoomSession key={roomId} roomId={roomId} />;
}

function RoomSession({ roomId }: { roomId: string }) {
  const [, setLocation] = useLocation();
  const {
    roomState,
    connectionState,
    error,
    mode,
    role,
    opponentProgress,
    opponentFinish,
    opponentReaction,
    spectatorProgress,
    spectatorFinish,
    send,
  } = useRoom(roomId);

  useEffect(() => {
    trackEvent("room_opened", {
      roomId,
      path: `/room/${roomId}`,
    });
  }, [roomId]);

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

  if (error === "spectator_full") {
    return (
      <StatusScreen
        title="this race is packed"
        subtitle="too many people are watching right now"
        cta={{ label: "create your own", onClick: () => setLocation("/") }}
      />
    );
  }

  // Initial connect with no state yet: show "connecting..." (but once we've
  // ever received a state snapshot, we keep rendering it through reconnects).
  if (connectionState === "connecting" && !roomState) {
    return <StatusScreen title="connecting..." />;
  }

  if (connectionState === "closed" && !roomState) {
    return (
      <StatusScreen
        title="connection lost"
        subtitle={error ?? "try reopening the link"}
        cta={{ label: "back home", onClick: () => setLocation("/") }}
      />
    );
  }

  if (!roomState) {
    return <StatusScreen title="connecting..." />;
  }

  const reconnecting = connectionState === "reconnecting";
  const disconnectedRival =
    roomState.disconnected && roomState.disconnected.role !== role
      ? roomState.disconnected
      : null;

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      <Banners
        reconnecting={reconnecting}
        disconnectedRival={disconnectedRival}
      />
      {(roomState.playerCount >= 2 || mode === "spectator") && (
        <WatchLinkButton roomId={roomId} />
      )}
      {mode === "spectator" ? (
        <SpectatorView
          room={roomState}
          progress={spectatorProgress}
          finish={spectatorFinish}
        />
      ) : roomState.status === "waiting" ? (
        <WaitingLobby roomId={roomId} />
      ) : roomState.status === "ready_check" ? (
        <ReadyCheck room={roomState} role={role} send={send} />
      ) : (
        <RaceView
          key={roomState.passage.id}
          room={roomState}
          role={role}
          opponentProgress={opponentProgress}
          opponentFinish={opponentFinish}
          opponentReaction={opponentReaction}
          send={send}
          onNewRace={() => setLocation("/")}
        />
      )}
    </div>
  );
}

function WatchLinkButton({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = roomShareUrl(roomId);
  const inviteText = watchInviteMessage(shareUrl);

  async function copy() {
    if (!(await copyText(inviteText))) return;
    setCopied(true);
    trackEvent("invite_copied", {
      roomId,
      metadata: { kind: "watch" },
    });
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <button
        onClick={copy}
        className="px-3 py-1.5 border border-border text-[0.7rem] uppercase tracking-[0.15em] text-fg-dim hover:border-accent hover:text-accent transition-colors"
      >
        {copied ? "watch invite copied" : "copy watch invite"}
      </button>
      <span className="text-[0.68rem] text-fg-dimmer">
        same room link. extra visitors watch live without joining the race.
      </span>
    </div>
  );
}

function Banners({
  reconnecting,
  disconnectedRival,
}: {
  reconnecting: boolean;
  disconnectedRival: { graceUntil: number } | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!disconnectedRival) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [disconnectedRival]);

  if (!reconnecting && !disconnectedRival) return null;

  return (
    <div className="w-full max-w-[800px] flex flex-col gap-2">
      {reconnecting && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 text-xs bg-bg-soft border border-border">
          <span className="inline-block size-1.5 rounded-full bg-accent animate-pulse" />
          <span className="text-fg-dim">
            reconnecting to the room...
          </span>
        </div>
      )}
      {disconnectedRival && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 text-xs bg-bg-soft border border-opponent/40">
          <span className="inline-block size-1.5 rounded-full bg-opponent animate-pulse" />
          <span className="text-opponent">rival disconnected</span>
          <span className="text-fg-dim">
            ·{" "}
            {Math.max(
              0,
              Math.ceil((disconnectedRival.graceUntil - now) / 1000)
            )}
            s grace
          </span>
        </div>
      )}
    </div>
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
  const shareUrl = roomShareUrl(roomId);
  const inviteText = raceInviteMessage(shareUrl);
  const inviteRef = useRef<HTMLTextAreaElement>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const nativeShare = canNativeShare();

  useEffect(() => {
    inviteRef.current?.focus();
    inviteRef.current?.select();
  }, []);

  async function copyInvite() {
    if (!(await copyText(inviteText))) {
      inviteRef.current?.focus();
      inviteRef.current?.select();
      return;
    }
    setInviteCopied(true);
    trackEvent("invite_copied", {
      roomId,
      metadata: { kind: "race" },
    });
    window.setTimeout(() => setInviteCopied(false), 1500);
  }

  async function copyLink() {
    if (!(await copyText(shareUrl))) return;
    setLinkCopied(true);
    trackEvent("invite_copied", {
      roomId,
      metadata: { kind: "link" },
    });
    window.setTimeout(() => setLinkCopied(false), 1500);
  }

  async function shareInvite() {
    const result = await nativeShareInvite({
      title: "typing race",
      text: inviteText,
      url: shareUrl,
    });
    if (result === "shared") {
      trackEvent("invite_shared", {
        roomId,
        metadata: { kind: "race" },
      });
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
        <h2 className="text-2xl mt-2">invite a friend</h2>
      </div>

      <div className="flex flex-col gap-4 w-full">
        <textarea
          ref={inviteRef}
          readOnly
          rows={2}
          value={inviteText}
          onClick={(e) => e.currentTarget.select()}
          className="w-full resize-none bg-bg-soft border border-border px-4 py-3 text-fg text-sm leading-relaxed focus:outline-none focus:border-accent selection:bg-accent/30"
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            onClick={copyInvite}
            className={
              "px-6 py-3 border text-sm transition-colors " +
              (inviteCopied
                ? "border-ok text-ok"
                : "border-accent text-accent hover:bg-accent hover:text-bg")
            }
          >
            {inviteCopied ? "invite copied" : "copy invite"}
          </button>
          {nativeShare && (
            <button
              onClick={shareInvite}
              className="px-6 py-3 border border-border text-sm text-fg-dim hover:border-accent hover:text-accent transition-colors"
            >
              share
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex gap-2 w-full">
            <input
              readOnly
              value={shareUrl}
              onClick={(e) => e.currentTarget.select()}
              className="flex-1 bg-bg-soft/60 border border-border px-3 py-2 text-fg-dim text-xs font-mono focus:outline-none focus:border-accent selection:bg-accent/30"
            />
            <button
              onClick={copyLink}
              className={
                "shrink-0 px-4 py-2 border text-xs transition-colors " +
                (linkCopied
                  ? "border-ok text-ok"
                  : "border-border text-fg-dim hover:border-accent hover:text-accent")
              }
            >
              {linkCopied ? "copied" : "copy link"}
            </button>
          </div>
          <span className="text-xs text-fg-dimmer text-left sm:text-center">
            paste the invite into discord, imessage, or reddit. first friend to
            open it races you. after two racers join, the same link is a live
            spectator view.
          </span>
        </div>
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
