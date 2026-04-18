/**
 * Protocol types shared between Worker and web client.
 * Keep this file in sync with web/src/lib/protocol.ts
 */

export type PassageLength = "short" | "medium" | "long";
export type EndMode = "finish" | "time";
export type TimeLimit = 30 | 60 | 90;

export type PlayerRole = "host" | "guest";

export interface RoomConfig {
  endMode: EndMode;
  passageLength: PassageLength;
  timeLimit: TimeLimit;
}

export interface PassageInfo {
  id: string;
  text: string;
  wordCount: number;
}

export type RoomStatus =
  | "waiting"
  | "starting"
  | "racing"
  | "ended";

export type RaceOutcome = "host_wins" | "guest_wins" | "tie";
export type EndReason = "finish" | "time_up";

export interface PlayerResult {
  role: PlayerRole;
  wpm: number;
  accuracy: number;
  elapsedMs: number;
  pos: number;
  correctCount: number;
  finishedPassage: boolean;
}

export interface RaceResult {
  outcome: RaceOutcome;
  endReason: EndReason;
  host: PlayerResult;
  guest: PlayerResult;
}

export interface RematchReady {
  host: boolean;
  guest: boolean;
}

export interface PublicRoomState {
  roomId: string;
  passage: PassageInfo;
  config: RoomConfig;
  status: RoomStatus;
  playerCount: number;
  createdAt: number;
  /** ms timestamp when racing begins (server clock). Set when 2nd player joins. */
  startAt?: number;
  /** ms timestamp when race ends in time-mode (startAt + timeLimit*1000). */
  endAt?: number;
  /** Final result, set when status transitions to "ended". */
  result?: RaceResult;
  /** Per-role rematch readiness, only populated while status === "ended". */
  rematchReady?: RematchReady;
}

/** Client → Server messages */
export type ClientMsg =
  | { t: "hello" }
  | { t: "ping" }
  | {
      t: "progress";
      pos: number;
      correctCount: number;
      wpm: number;
      accuracy: number;
    }
  | { t: "finished"; wpm: number; accuracy: number; elapsedMs: number }
  | { t: "rematch_request" }
  | { t: "rematch_cancel" };

/** Server → Client messages */
export type ServerMsg =
  | { t: "welcome"; role: PlayerRole }
  | { t: "state"; room: PublicRoomState }
  | { t: "peer_joined"; playerCount: number }
  | { t: "peer_left"; playerCount: number }
  | {
      t: "opponent_progress";
      pos: number;
      correctCount: number;
      wpm: number;
      accuracy: number;
    }
  | { t: "opponent_finished"; wpm: number; accuracy: number; elapsedMs: number }
  | { t: "error"; code: string; message: string }
  | { t: "pong" };

/** HTTP request body for POST /room */
export interface CreateRoomRequest {
  config?: Partial<RoomConfig>;
}

export interface CreateRoomResponse {
  roomId: string;
}

export const DEFAULT_CONFIG: RoomConfig = {
  endMode: "finish",
  passageLength: "medium",
  timeLimit: 60,
};

/** Pre-race buffer (3-2-1 countdown). */
export const START_BUFFER_MS = 3000;
