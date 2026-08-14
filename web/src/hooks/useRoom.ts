import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSessionToken,
  roomWsUrl,
  setSessionToken,
} from "../lib/api";
import type {
  ClientMsg,
  ParticipantKind,
  PublicRoomState,
  ReactionKey,
  Seat,
  ServerMsg,
} from "../lib/protocol";

export type ConnectionState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

/** Live typing state for one seat, updated between state broadcasts. */
export interface PlayerLive {
  seat: Seat;
  pos: number;
  correctCount: number;
  wpm: number;
  accuracy: number;
  finished: boolean;
  finishElapsedMs?: number;
}

export type LivePlayers = Record<number, PlayerLive>;

export interface ReactionEvent {
  id: number;
  seat: Seat;
  key: ReactionKey;
}

export interface UseRoomResult {
  roomState: PublicRoomState | null;
  connectionState: ConnectionState;
  error: string | null;
  mode: ParticipantKind | null;
  seat: Seat | null;
  isHost: boolean;
  livePlayers: LivePlayers;
  /** Append-only, capped. Consumers track which ids they've shown. */
  reactions: ReactionEvent[];
  send: (msg: ClientMsg) => void;
}

const MAX_RETRIES = 4;
const RETRY_DELAYS_MS = [500, 1500, 3000, 5000];
const REACTION_BUFFER = 8;

function emptyLive(seat: Seat): PlayerLive {
  return {
    seat,
    pos: 0,
    correctCount: 0,
    wpm: 0,
    accuracy: 100,
    finished: false,
  };
}

export function useRoom(roomId: string): UseRoomResult {
  const [roomState, setRoomState] = useState<PublicRoomState | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ParticipantKind | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [livePlayers, setLivePlayers] = useState<LivePlayers>({});
  const [reactions, setReactions] = useState<ReactionEvent[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);

  // Progress arrives per keystroke from up to three rivals at once. Buffer
  // it in a ref and publish once per frame so the passage doesn't re-render
  // on every inbound message.
  const liveRef = useRef<LivePlayers>({});
  const flushHandleRef = useRef<number | null>(null);
  const reactionSeqRef = useRef(0);

  const flushLive = useCallback(() => {
    flushHandleRef.current = null;
    setLivePlayers({ ...liveRef.current });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushHandleRef.current !== null) return;
    flushHandleRef.current = window.requestAnimationFrame(flushLive);
  }, [flushLive]);

  const resetLive = useCallback(() => {
    liveRef.current = {};
    if (flushHandleRef.current !== null) {
      window.cancelAnimationFrame(flushHandleRef.current);
      flushHandleRef.current = null;
    }
    setLivePlayers({});
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    retryCountRef.current = 0;

    function connect() {
      if (unmountedRef.current) return;

      const token = getSessionToken(roomId) ?? undefined;
      const ws = new WebSocket(roomWsUrl(roomId, token));
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        retryCountRef.current = 0;
        setConnectionState("open");
        ws.send(JSON.stringify({ t: "hello" } satisfies ClientMsg));
      });

      ws.addEventListener("message", (ev) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(ev.data) as ServerMsg;
        } catch {
          return;
        }

        switch (msg.t) {
          case "welcome":
            setMode("player");
            setSeat(msg.seat);
            setIsHost(msg.isHost);
            setSessionToken(roomId, msg.sessionToken);
            return;
          case "spectator_welcome":
            setMode("spectator");
            setSeat(null);
            setIsHost(false);
            return;
          case "state":
            setRoomState({
              ...msg.room,
              serverOffsetMs:
                msg.room.serverNow === undefined
                  ? 0
                  : msg.room.serverNow - Date.now(),
            });
            if (
              msg.room.status === "starting" ||
              msg.room.status === "waiting"
            ) {
              resetLive();
            }
            return;
          case "error":
            setError(msg.code);
            return;
          case "player_progress": {
            const current = liveRef.current[msg.seat] ?? emptyLive(msg.seat);
            liveRef.current = {
              ...liveRef.current,
              [msg.seat]: {
                ...current,
                pos: msg.pos,
                correctCount: msg.correctCount,
                wpm: msg.wpm,
                accuracy: msg.accuracy,
              },
            };
            scheduleFlush();
            return;
          }
          case "player_finished": {
            const current = liveRef.current[msg.seat] ?? emptyLive(msg.seat);
            liveRef.current = {
              ...liveRef.current,
              [msg.seat]: {
                ...current,
                wpm: msg.wpm,
                accuracy: msg.accuracy,
                finished: true,
                finishElapsedMs: msg.elapsedMs,
              },
            };
            scheduleFlush();
            return;
          }
          case "player_reaction": {
            reactionSeqRef.current += 1;
            const event: ReactionEvent = {
              id: reactionSeqRef.current,
              seat: msg.seat,
              key: msg.key,
            };
            setReactions((current) =>
              [...current, event].slice(-REACTION_BUFFER)
            );
            return;
          }
          case "pong":
            return;
        }
      });

      ws.addEventListener("close", (ev) => {
        if (unmountedRef.current) return;

        // Terminal errors — no retry.
        if (ev.code === 4004 || ev.reason?.includes("not_found")) {
          setError("room_not_found");
          setConnectionState("closed");
          return;
        }
        if (ev.code === 4010 || ev.reason?.includes("spectator_full")) {
          setError("spectator_full");
          setConnectionState("closed");
          return;
        }

        // Reconnect with backoff.
        if (retryCountRef.current < MAX_RETRIES) {
          const delay = RETRY_DELAYS_MS[retryCountRef.current] ?? 5000;
          retryCountRef.current += 1;
          setConnectionState("reconnecting");
          retryTimeoutRef.current = window.setTimeout(connect, delay);
        } else {
          setConnectionState("closed");
          setError("connection_lost");
        }
      });

      ws.addEventListener("error", () => {
        // close handler does the actual reconnect; onerror alone isn't
        // always followed by a useful code, so we just let close drive.
      });
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (retryTimeoutRef.current !== null) {
        window.clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      if (flushHandleRef.current !== null) {
        window.cancelAnimationFrame(flushHandleRef.current);
        flushHandleRef.current = null;
      }
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
    };
  }, [roomId, resetLive, scheduleFlush]);

  const send = useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }, []);

  return {
    roomState,
    connectionState,
    error,
    mode,
    seat,
    isHost,
    livePlayers,
    reactions,
    send,
  };
}
