import { useCallback, useEffect, useRef, useState } from "react";
import { roomWsUrl } from "../lib/api";
import type {
  ClientMsg,
  PublicRoomState,
  ServerMsg,
} from "../lib/protocol";

export type ConnectionState =
  | "connecting"
  | "open"
  | "closed"
  | "error";

export interface OpponentProgress {
  pos: number;
  correctCount: number;
  wpm: number;
}

export interface OpponentFinish {
  wpm: number;
  accuracy: number;
  elapsedMs: number;
}

export interface UseRoomResult {
  roomState: PublicRoomState | null;
  connectionState: ConnectionState;
  error: string | null;
  opponentProgress: OpponentProgress | null;
  opponentFinish: OpponentFinish | null;
  send: (msg: ClientMsg) => void;
}

export function useRoom(roomId: string): UseRoomResult {
  const [roomState, setRoomState] = useState<PublicRoomState | null>(
    null
  );
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [opponentProgress, setOpponentProgress] =
    useState<OpponentProgress | null>(null);
  const [opponentFinish, setOpponentFinish] =
    useState<OpponentFinish | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setConnectionState("connecting");
    setError(null);
    setRoomState(null);
    setOpponentProgress(null);
    setOpponentFinish(null);

    const ws = new WebSocket(roomWsUrl(roomId));
    wsRef.current = ws;

    ws.addEventListener("open", () => {
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
        case "state":
          setRoomState(msg.room);
          if (msg.room.status === "starting" || msg.room.status === "waiting") {
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
          });
          return;
        case "opponent_finished":
          setOpponentFinish({
            wpm: msg.wpm,
            accuracy: msg.accuracy,
            elapsedMs: msg.elapsedMs,
          });
          return;
        case "peer_joined":
        case "peer_left":
        case "pong":
          return;
      }
    });

    ws.addEventListener("close", (ev) => {
      setConnectionState("closed");
      if (ev.code === 4004 || ev.reason?.includes("not_found")) {
        setError("room_not_found");
      } else if (ev.code === 4009 || ev.reason?.includes("full")) {
        setError("room_full");
      }
    });

    ws.addEventListener("error", () => {
      setConnectionState("error");
    });

    return () => {
      try {
        ws.close();
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
    opponentProgress,
    opponentFinish,
    send,
  };
}
