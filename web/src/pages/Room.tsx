import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useRoom } from "../hooks/useRoom";
import { RaceView } from "../components/RaceView";
import { ReadyCheck } from "../components/ReadyCheck";
import { SpectatorView } from "../components/SpectatorView";
import { WaitingWarmup } from "../components/WaitingWarmup";
import { trackEvent } from "../lib/analytics";
import {
  MIN_PLAYERS,
  type ClientMsg,
  type PlayerSlot,
  type PublicRoomState,
  type RoomConfig,
  type Seat,
} from "../lib/protocol";
import { seatName, seatTheme } from "../lib/seats";
import { formatCountdownMs, raceConfigSummary } from "../lib/raceLabels";
import {
  canNativeShare,
  copyText,
  nativeShareInvite,
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
    seat,
    isHost,
    livePlayers,
    reactions,
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
  const droppedRivals =
    roomState.status === "racing"
      ? roomState.players.filter(
          (player) => player.seat !== seat && !player.connected
        )
      : [];

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      <Banners
        reconnecting={reconnecting}
        droppedRivals={droppedRivals}
        mySeat={seat}
      />
      {(roomState.connectedCount >= MIN_PLAYERS || mode === "spectator") && (
        <WatchLinkButton roomId={roomId} />
      )}
      {mode === "spectator" ? (
        <SpectatorView room={roomState} livePlayers={livePlayers} />
      ) : roomState.status === "waiting" ? (
        <WaitingLobby
          roomId={roomId}
          room={roomState}
          seat={seat}
          isHost={isHost}
          send={send}
        />
      ) : roomState.status === "ready_check" ? (
        <ReadyCheck room={roomState} seat={seat} send={send} />
      ) : (
        <RaceView
          key={roomState.passage.id}
          room={roomState}
          seat={seat}
          livePlayers={livePlayers}
          reactions={reactions}
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
        same room link. once the seats are taken, extra visitors watch live.
      </span>
    </div>
  );
}

function Banners({
  reconnecting,
  droppedRivals,
  mySeat,
}: {
  reconnecting: boolean;
  droppedRivals: PlayerSlot[];
  mySeat: Seat | null;
}) {
  if (!reconnecting && droppedRivals.length === 0) return null;

  return (
    <div className="w-full max-w-[800px] flex flex-col gap-2">
      {reconnecting && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 text-xs bg-bg-soft border border-border">
          <span className="inline-block size-1.5 rounded-full bg-accent animate-pulse" />
          <span className="text-fg-dim">reconnecting to the room...</span>
        </div>
      )}
      {droppedRivals.length > 0 && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 text-xs bg-bg-soft border border-opponent/40">
          <span className="inline-block size-1.5 rounded-full bg-opponent animate-pulse" />
          <span className="text-opponent">
            {droppedRivals
              .map((player) => seatName(player.seat, mySeat))
              .join(", ")}{" "}
            dropped
          </span>
          <span className="text-fg-dim">
            · seat held, the race keeps going
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

function WaitingLobby({
  roomId,
  room,
  seat,
  isHost,
  send,
}: {
  roomId: string;
  room: PublicRoomState;
  seat: Seat | null;
  isHost: boolean;
  send: (msg: ClientMsg) => void;
}) {
  const shareUrl = roomShareUrl(roomId);
  const inviteText = shareUrl;
  const inviteRef = useRef<HTMLInputElement>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const nativeShare = canNativeShare();

  const seatsLeft = room.config.maxPlayers - room.players.length;
  const canStartEarly = isHost && room.connectedCount >= MIN_PLAYERS;

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

  async function shareInvite() {
    const result = await nativeShareInvite({
      title: "typing race",
      text: shareUrl,
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
            {seatsLeft === 1
              ? "waiting for 1 more"
              : `waiting for ${seatsLeft} more`}
          </span>
        </div>
        <h2 className="text-2xl mt-2">invite your friends</h2>
        <RaceConfigBadges config={room.config} />
        {room.lobbyExpiresAt !== undefined && (
          <LobbyExpiryCountdown
            expiresAt={room.lobbyExpiresAt}
            serverOffsetMs={room.serverOffsetMs ?? 0}
          />
        )}
      </div>

      <SeatStrip room={room} mySeat={seat} />

      <div className="flex flex-col gap-4 w-full">
        <input
          ref={inviteRef}
          readOnly
          value={inviteText}
          onClick={(e) => e.currentTarget.select()}
          className="invite-link-field h-12 w-full bg-bg-soft border border-border px-4 text-accent text-sm font-mono focus:outline-none focus:border-accent"
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
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
          {canStartEarly && (
            <button
              onClick={() => send({ t: "start_race" })}
              className="px-6 py-3 border border-ok text-ok text-sm hover:bg-ok hover:text-bg transition-colors"
            >
              start with {room.connectedCount}
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs text-fg-dimmer text-left sm:text-center">
            paste the invite into discord, imessage, or reddit. the race starts
            on its own once every seat is taken
            {isHost ? ", or start early whenever you like" : ""}. extra
            visitors watch live.
          </span>
        </div>

        {isHost && <WaitingWarmup />}
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

function SeatStrip({
  room,
  mySeat,
}: {
  room: PublicRoomState;
  mySeat: Seat | null;
}) {
  const slots = Array.from({ length: room.config.maxPlayers }, (_, index) =>
    room.players.find((player) => player.seat === index)
  );

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {slots.map((player, index) => {
        const theme = seatTheme(index);
        if (!player) {
          return (
            <span
              key={index}
              className="flex items-center gap-2 border border-dashed border-border px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.15em] text-fg-dimmer"
            >
              <span className="inline-block size-1.5 rounded-full bg-fg-dimmer animate-pulse" />
              open
            </span>
          );
        }
        return (
          <span
            key={index}
            className={`seat-chip flex items-center gap-2 border ${theme.borderSoft} px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.15em] ${theme.text}`}
          >
            <span
              className={`inline-block size-1.5 rounded-full ${theme.bg}`}
              aria-hidden
            />
            {seatName(player.seat, mySeat)}
            {player.isHost && (
              <span className="text-fg-dimmer normal-case tracking-normal">
                host
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function RaceConfigBadges({ config }: { config: RoomConfig }) {
  const summary = raceConfigSummary(config);
  const [length, mode] = summary.split(" · ");

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
      <ConfigBadge label={length} tone="accent" />
      <ConfigBadge label={mode} tone="muted" />
      <ConfigBadge label={`${config.maxPlayers} racers`} tone="muted" />
    </div>
  );
}

function ConfigBadge({
  label,
  tone,
}: {
  label: string;
  tone: "accent" | "muted";
}) {
  const classes =
    tone === "accent"
      ? "border-accent/50 text-accent"
      : "border-border text-fg-dim";
  return (
    <span
      className={`border px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.16em] ${classes}`}
    >
      {label}
    </span>
  );
}

function LobbyExpiryCountdown({
  expiresAt,
  serverOffsetMs,
}: {
  expiresAt: number;
  serverOffsetMs: number;
}) {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      setRemainingMs(
        Math.max(0, expiresAt - (Date.now() + serverOffsetMs))
      );
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [expiresAt, serverOffsetMs]);

  if (remainingMs === null) {
    return null;
  }

  const urgent = remainingMs < 60_000;
  return (
    <p
      className={
        "text-xs tabular-nums " +
        (urgent ? "text-opponent" : "text-fg-dimmer")
      }
    >
      invite window closes in{" "}
      <span className={urgent ? "text-opponent" : "text-fg-dim"}>
        {formatCountdownMs(remainingMs)}
      </span>
    </p>
  );
}
