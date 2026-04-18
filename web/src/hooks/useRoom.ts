import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSessionToken,
  roomWsUrl,
  setSessionToken,
} from "../lib/api";
import type {
  ClientMsg,
  PlayerRole,
  PublicRoomState,
  ReactionKey,
  ServerMsg,
} from "../lib/protocol";

export type ConnectionState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

export interface OpponentProgress {
  pos: number;
  correctCount: number;
  wpm: number;
  accuracy: number;
}

export interface OpponentFinish {
  wpm: number;
  accuracy: number;
  elapsedMs: number;
}

export interface OpponentReaction {
  key: ReactionKey;
  from: PlayerRole;
  /** monotonically increasing id so repeated identical reactions still
   *  trigger a fresh toast render */
  at: number;
}

export interface UseRoomResult {
  roomState: PublicRoomState | null;
  connectionState: ConnectionState;
  error: string | null;
  role: PlayerRole | null;
  opponentProgress: OpponentProgress | null;
  opponentFinish: OpponentFinish | null;
  opponentReaction: OpponentReaction | null;
  send: (msg: ClientMsg) => void;
}

const MAX_RETRIES = 4;
const RETRY_DELAYS_MS = [500, 1500, 3000, 5000];

export function useRoom(roomId: string): UseRoomResult {
  const [roomState, setRoomState] = useState<PublicRoomState | null>(
    null
  );
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<PlayerRole | null>(null);
  const [opponentProgress, setOpponentProgress] =
    useState<OpponentProgress | null>(null);
  const [opponentFinish, setOpponentFinish] =
    useState<OpponentFinish | null>(null);
  const [opponentReaction, setOpponentReaction] =
    useState<OpponentReaction | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    setConnectionState("connecting");
    setError(null);
    setRoomState(null);
    setRole(null);
    setOpponentProgress(null);
    setOpponentFinish(null);
    setOpponentReaction(null);
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
            setRole(msg.role);
            setSessionToken(roomId, msg.sessionToken);
            return;
          case "state":
            setRoomState(msg.room);
            if (
              msg.room.status === "starting" ||
              msg.room.status === "waiting"
            ) {
              setOpponentProgress(null);
              setOpponentFinish(null);
            }
            return;
          case "error":
            setError(msg.code);
            return;
          case "opponent_progress":
            setOpponentProgress({
              pos: msg.pos,
              correctCount: msg.correctCount,
              wpm: msg.wpm,
              accuracy: msg.accuracy,
            });
            return;
          case "opponent_finished":
            setOpponentFinish({
              wpm: msg.wpm,
              accuracy: msg.accuracy,
              elapsedMs: msg.elapsedMs,
            });
            return;
          case "opponent_reaction":
            setOpponentReaction({
              key: msg.key,
              from: msg.from,
              at: Date.now(),
            });
            return;
          case "peer_joined":
          case "peer_left":
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
        if (ev.code === 4009 || ev.reason?.includes("full")) {
          setError("room_full");
          setConnectionState("closed");
          return;
        }

        // Reconnect with backoff.
        if (retryCountRef.current < MAX_RETRIES) {
          const delay =
            RETRY_DELAYS_MS[retryCountRef.current] ?? 5000;
          retryCountRef.current += 1;
          setConnectionState("reconnecting");
          retryTimeoutRef.current = window.setTimeout(
            connect,
            delay
          );
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
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
    };
  }, [roomId]);

  const send = useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }, []);

  return {
    roomState,
    connectionState,
    error,
    role,
    opponentProgress,
    opponentFinish,
    opponentReaction,
    send,
  };
}
