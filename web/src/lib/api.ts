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

export function roomWsUrl(roomId: string): string {
  return `${WS_URL}/room/${encodeURIComponent(roomId)}/ws`;
}
