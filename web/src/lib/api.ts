import type {
  CreateRoomRequest,
  CreateRoomResponse,
  RoomConfig,
} from "./protocol";

export const WORKER_URL =
  import.meta.env.VITE_WORKER_URL ?? "http://localhost:8787";

export const WS_URL = WORKER_URL.replace(/^http/, "ws");

export async function createRoom(
  config?: Partial<RoomConfig>
): Promise<CreateRoomResponse> {
  const body: CreateRoomRequest = config ? { config } : {};
  const res = await fetch(`${WORKER_URL}/room`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`create_room_failed_${res.status}`);
  }
  return (await res.json()) as CreateRoomResponse;
}

export function roomWsUrl(roomId: string, sessionToken?: string): string {
  const base = `${WS_URL}/room/${encodeURIComponent(roomId)}/ws`;
  return sessionToken
    ? `${base}?token=${encodeURIComponent(sessionToken)}`
    : base;
}

const TOKEN_KEY_PREFIX = "typing-race:token:";

export function getSessionToken(roomId: string): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY_PREFIX + roomId);
  } catch {
    return null;
  }
}

export function setSessionToken(roomId: string, token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY_PREFIX + roomId, token);
  } catch {
    // sessionStorage unavailable — token just won't persist across reload
  }
}

export function clearSessionToken(roomId: string): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY_PREFIX + roomId);
  } catch {
    // ignore
  }
}
