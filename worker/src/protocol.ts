/**
 * Protocol types shared between Worker and web client.
 * Keep this file in sync with web/src/lib/protocol.ts
 */

export type PassageLength = "short" | "medium" | "long";
export type EndMode = "finish" | "time";
export type TimeLimit = 30 | 60 | 90;

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
  | "ready"
  | "locked"
  | "racing"
  | "ended";

export interface PublicRoomState {
  roomId: string;
  passage: PassageInfo;
  config: RoomConfig;
  status: RoomStatus;
  playerCount: number;
  createdAt: number;
}

/** Client → Server messages */
export type ClientMsg =
  | { t: "hello" }
  | { t: "ping" };

/** Server → Client messages */
export type ServerMsg =
  | { t: "state"; room: PublicRoomState }
  | { t: "peer_joined"; playerCount: number }
  | { t: "peer_left"; playerCount: number }
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
