import type { RoomConfig } from "./protocol";

/** Short label for badges and invite text, e.g. `short · finish`. */
export function raceConfigSummary(config: RoomConfig): string {
  const length =
    config.passageLength === "word" ? "one-word" : config.passageLength;
  if (config.passageLength === "word") {
    return `${length} · sprint`;
  }
  if (config.endMode === "time") {
    return `${length} · ${config.timeLimit}s`;
  }
  return `${length} · finish`;
}

export function formatCountdownMs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export function serverNowFromRoom(room: {
  serverOffsetMs?: number;
}): number {
  return Date.now() + (room.serverOffsetMs ?? 0);
}
