/**
 * Protocol types shared between Worker and web client.
 * Keep this file in sync with web/src/lib/protocol.ts
 */

export type PassageLength = "word" | "short" | "medium" | "long";
export type EndMode = "finish" | "time";
export type TimeLimit = 30 | 60 | 90;
export type RoomSource = "user" | "load_test";

/**
 * Seat index within a room, 0-based. Seat 0 is always the room creator
 * (the host) and is the only seat allowed to force-start a race early.
 */
export type Seat = number;

export type MaxPlayers = 2 | 3 | 4;
export type ParticipantKind = "player" | "spectator";

/** A race needs at least this many racers before it can start. */
export const MIN_PLAYERS = 2;
/** Hard ceiling on seats, independent of a room's configured maxPlayers. */
export const MAX_PLAYERS = 4;
export const HOST_SEAT = 0;

export interface RoomConfig {
  endMode: EndMode;
  passageLength: PassageLength;
  timeLimit: TimeLimit;
  maxPlayers: MaxPlayers;
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

/**
 * - finish:     finish mode resolved (everyone done, or the grace expired)
 * - time_up:    time mode clock ran out
 * - disconnect: fewer than MIN_PLAYERS were still connected
 * - cap:        hard duration backstop fired (see raceCapMs)
 */
export type EndReason = "finish" | "time_up" | "disconnect" | "cap";

/** Roster entry. Live typing progress travels via player_progress instead. */
export interface PlayerSlot {
  seat: Seat;
  isHost: boolean;
  connected: boolean;
  /**
   * Set when a racer drops mid-race. Their seat and progress are held so
   * they can reconnect with the same session token and carry on; the race
   * keeps running for everyone else.
   */
  droppedAt?: number;
  /** Locked in during ready_check, or requested a rematch while ended. */
  ready: boolean;
  finished: boolean;
}

/**
 * Finish-mode grace: the first racer crossed the line, the race is still
 * running so the others can complete too, but a timer is now ticking.
 * When it expires the race is scored wherever everyone else stands.
 */
export interface FinishGraceInfo {
  firstFinisherSeat: Seat;
  at: number;
  graceUntil: number;
}

export interface PlayerResult {
  seat: Seat;
  wpm: number;
  accuracy: number;
  elapsedMs: number;
  pos: number;
  correctCount: number;
  finishedPassage: boolean;
  /** 1-based finishing position. Tied racers share a place. */
  place: number;
  /** Dropped before the race ended and never came back. */
  dnf: boolean;
}

export interface RaceResult {
  endReason: EndReason;
  /** Sorted by place ascending. */
  players: PlayerResult[];
  /** null when the top place is shared. */
  winnerSeat: Seat | null;
}

export interface PublicRoomState {
  roomId: string;
  passage: PassageInfo;
  config: RoomConfig;
  status: RoomStatus;
  players: PlayerSlot[];
  /** Count of seats currently held (including held seats of dropped racers). */
  playerCount: number;
  /** Count of seats with a live socket right now. */
  connectedCount: number;
  spectatorCount: number;
  createdAt: number;
  /**
   * While status === "waiting", ms timestamp after which the room is
   * closed if it never reaches MIN_PLAYERS.
   */
  lobbyExpiresAt?: number;
  /** Server timestamp included with each state broadcast for clock sync. */
  serverNow?: number;
  /** Client-derived server clock offset, populated by web/useRoom. */
  serverOffsetMs?: number;
  /**
   * While status === "ready_check", the ms timestamp at which the race
   * auto-starts even if somebody hasn't locked in.
   */
  readyCheckUntil?: number;
  /** ms timestamp when racing begins (server clock). */
  startAt?: number;
  /** ms timestamp when the race ends in time mode. */
  endAt?: number;
  /** Backstop deadline so a race can never hang open forever. */
  hardEndAt?: number;
  /** Final result, set when status transitions to "ended". */
  result?: RaceResult;
  /** Seats that have asked for a rematch, only while status === "ended". */
  rematchReady?: Seat[];
  /** Set once the first racer finishes in finish mode. */
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
  /** Host-only: start with whoever is already here (needs MIN_PLAYERS). */
  | { t: "start_race" }
  | {
      t: "progress";
      pos: number;
      correctCount: number;
      accuracy: number;
    }
  | {
      t: "finished";
      accuracy: number;
      correctCount: number;
    }
  | { t: "rematch_request" }
  | { t: "rematch_cancel" }
  | { t: "reaction"; key: ReactionKey };

/** Server → Client messages */
export type ServerMsg =
  | { t: "welcome"; seat: Seat; isHost: boolean; sessionToken: string }
  | { t: "spectator_welcome" }
  | { t: "state"; room: PublicRoomState }
  | {
      t: "player_progress";
      seat: Seat;
      pos: number;
      correctCount: number;
      wpm: number;
      accuracy: number;
    }
  | {
      t: "player_finished";
      seat: Seat;
      wpm: number;
      accuracy: number;
      elapsedMs: number;
    }
  | { t: "player_reaction"; seat: Seat; key: ReactionKey }
  | { t: "error"; code: string; message: string }
  | { t: "pong" };

/** HTTP request body for POST /room */
export interface CreateRoomRequest {
  config?: Partial<RoomConfig>;
  source?: RoomSource;
  analytics?: {
    browserId?: string;
    sessionId?: string;
  };
}

export interface CreateRoomResponse {
  roomId: string;
}

export const DEFAULT_CONFIG: RoomConfig = {
  endMode: "finish",
  passageLength: "medium",
  timeLimit: 60,
  maxPlayers: 2,
};

/** Pre-race buffer (3-2-1 countdown). */
export const START_BUFFER_MS = 3000;

/**
 * Once the room is full, how long racers have to lock in before the race
 * auto-starts anyway (safety net so a forgotten tab doesn't hang the room).
 */
export const READY_CHECK_MS = 15_000;

/**
 * In finish mode, how long everyone else has to finish after the first
 * racer crosses. Scales with the number of racers still typing so a
 * four-way race doesn't guillotine the back half of the field.
 */
export const FINISH_GRACE_BASE_MS = 10_000;
export const FINISH_GRACE_PER_PLAYER_MS = 3_000;

export function finishGraceMs(racersStillTyping: number): number {
  const extra = Math.max(0, racersStillTyping - 1);
  return FINISH_GRACE_BASE_MS + extra * FINISH_GRACE_PER_PLAYER_MS;
}

/** A room with zero connected participants expires this long after the last leave. */
export const ROOM_EXPIRY_MS = 10 * 60 * 1000;

/**
 * Absolute backstop on race duration. Seats are held for reconnecting
 * racers rather than forfeited, so nothing else guarantees a finish-mode
 * race terminates if people simply stop typing.
 */
export const RACE_CAP_FLOOR_MS = 90_000;
export const RACE_CAP_CEILING_MS = 8 * 60 * 1000;

export function raceCapMs(config: RoomConfig, passage: PassageInfo): number {
  if (config.endMode === "time") {
    return config.timeLimit * 1000 + 30_000;
  }
  // Budget the passage at a deliberately slow 8 wpm, then clamp.
  const generous = (passage.wordCount / 8) * 60_000;
  return Math.min(
    RACE_CAP_CEILING_MS,
    Math.max(RACE_CAP_FLOOR_MS, Math.round(generous))
  );
}

export function normalizeMaxPlayers(value: unknown): MaxPlayers {
  return value === 3 || value === 4 ? value : 2;
}
