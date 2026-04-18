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
  | "ready_check"
  | "starting"
  | "racing"
  | "ended";

export type RaceOutcome = "host_wins" | "guest_wins" | "tie";
export type EndReason = "finish" | "time_up" | "disconnect";

/** Per-role disconnect grace info while racing. */
export interface DisconnectInfo {
  role: PlayerRole;
  at: number;
  graceUntil: number;
}

/**
 * Finish-mode grace: the first player crossed the line, the race is
 * still running so the other can complete too, but a timer is now
 * ticking. When it expires, the race ends with the first finisher
 * as the winner.
 */
export interface FinishGraceInfo {
  firstFinisher: PlayerRole;
  at: number;
  graceUntil: number;
}

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
  /**
   * While status === "ready_check", the ms timestamp at which the race
   * auto-starts if the guest hasn't clicked lock-in yet.
   */
  readyCheckUntil?: number;
  /** ms timestamp when racing begins (server clock). Set after ready_check resolves. */
  startAt?: number;
  /** ms timestamp when race ends in time-mode (startAt + timeLimit*1000). */
  endAt?: number;
  /** Final result, set when status transitions to "ended". */
  result?: RaceResult;
  /** Per-role rematch readiness, only populated while status === "ended". */
  rematchReady?: RematchReady;
  /** Set while a player is disconnected mid-race and grace is counting down. */
  disconnected?: DisconnectInfo;
  /**
   * In finish mode, after the first player reaches the end, the other
   * player gets this long to finish before the race auto-ends.
   */
  finishGrace?: FinishGraceInfo;
}

/** Pre-written trash-talk reactions. Ids are short + stable so the server
 *  doesn't need to know the display text (keeps copy changes frontend-only). */
export type ReactionKey =
  | "see_you"
  | "take_time"
  | "oof"
  | "wait_up"
  | "lets_go"
  | "gg";

/** Client → Server messages */
export type ClientMsg =
  | { t: "hello" }
  | { t: "ping" }
  | { t: "lock_in" }
  | {
      t: "progress";
      pos: number;
      correctCount: number;
      wpm: number;
      accuracy: number;
    }
  | {
      t: "finished";
      wpm: number;
      accuracy: number;
      elapsedMs: number;
      correctCount: number;
    }
  | { t: "rematch_request" }
  | { t: "rematch_cancel" }
  | { t: "reaction"; key: ReactionKey };

/** Server → Client messages */
export type ServerMsg =
  | { t: "welcome"; role: PlayerRole; sessionToken: string }
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
  | { t: "opponent_reaction"; key: ReactionKey; from: PlayerRole }
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

/**
 * After the guest joins, how long they have to click lock-in before the
 * race auto-starts anyway (safety net so a forgotten tab doesn't hang
 * the host forever).
 */
export const READY_CHECK_MS = 15_000;

/** Grace period when a player drops mid-race before they forfeit. */
export const DISCONNECT_GRACE_MS = 30_000;

/** In finish mode, how long the second player has to finish after the first. */
export const FINISH_GRACE_MS = 10_000;

/** A room with zero connected players expires this long after the last leave. */
export const ROOM_EXPIRY_MS = 10 * 60 * 1000;
