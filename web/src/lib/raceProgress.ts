/**
 * Seats are held for racers who drop mid-race, but the server only knows
 * how far along someone was — not the exact characters they typed. Keeping
 * a local copy lets a reconnecting racer pick up mid-passage instead of
 * restarting from zero.
 */

const KEY_PREFIX = "typing-race:progress:";
const MAX_AGE_MS = 15 * 60 * 1000;

export interface StoredProgress {
  typed: string;
  totalKeystrokes: number;
}

interface StoredRecord extends StoredProgress {
  passageId: string;
  savedAt: number;
}

export function saveRaceProgress(
  roomId: string,
  passageId: string,
  progress: StoredProgress
): void {
  try {
    const record: StoredRecord = {
      ...progress,
      passageId,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(KEY_PREFIX + roomId, JSON.stringify(record));
  } catch {
    // sessionStorage unavailable — resume just won't work
  }
}

export function loadRaceProgress(
  roomId: string,
  passageId: string
): StoredProgress | null {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + roomId);
    if (!raw) return null;
    const record = JSON.parse(raw) as Partial<StoredRecord>;
    if (record.passageId !== passageId) return null;
    if (typeof record.typed !== "string") return null;
    if (typeof record.savedAt !== "number") return null;
    if (Date.now() - record.savedAt > MAX_AGE_MS) return null;
    return {
      typed: record.typed,
      totalKeystrokes:
        typeof record.totalKeystrokes === "number"
          ? record.totalKeystrokes
          : record.typed.length,
    };
  } catch {
    return null;
  }
}

export function clearRaceProgress(roomId: string): void {
  try {
    sessionStorage.removeItem(KEY_PREFIX + roomId);
  } catch {
    // ignore
  }
}
