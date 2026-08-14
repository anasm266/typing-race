import type { EndMode, EndReason, PassageLength } from "./protocol";

const PROFILE_KEY = "typing-race.local-profile.v1";
const HISTORY_KEY = "typing-race.local-history.v1";
const HISTORY_LIMIT = 50;

export type LocalHistoryKind = "practice" | "race";
export type LocalHistoryOutcome = "win" | "lose" | "tie";

export interface LocalHistoryEntry {
  id: string;
  kind: LocalHistoryKind;
  finishedAt: number;
  passageLength: PassageLength;
  passageWords: number;
  passageId?: string;
  endMode?: EndMode;
  endReason?: EndReason;
  outcome?: LocalHistoryOutcome;
  wpm: number;
  accuracy: number;
  elapsedMs: number;
  correctChars: number;
  totalKeystrokes?: number;
  /** Best rival result in the race, for the two-player summary line. */
  opponentWpm?: number;
  opponentAccuracy?: number;
  /** 1-based finishing position; only set for races with 3+ racers. */
  place?: number;
  playerCount?: number;
}

type NewLocalHistoryEntry = Omit<
  LocalHistoryEntry,
  "finishedAt"
> & {
  finishedAt?: number;
};

export function getLocalProfileId(): string {
  const storage = getStorage();
  if (!storage) return "local";

  const existing = storage.getItem(PROFILE_KEY);
  if (existing) return existing;

  const id = createProfileId();
  storage.setItem(PROFILE_KEY, id);
  return id;
}

export function getLocalHistory(): LocalHistoryEntry[] {
  const storage = getStorage();
  if (!storage) return [];

  try {
    const parsed = JSON.parse(storage.getItem(HISTORY_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLocalHistoryEntry);
  } catch {
    return [];
  }
}

export function addLocalHistoryEntry(entry: NewLocalHistoryEntry): void {
  const storage = getStorage();
  if (!storage) return;

  const nextEntry: LocalHistoryEntry = {
    ...entry,
    finishedAt: entry.finishedAt ?? Date.now(),
  };
  const current = getLocalHistory();
  if (current.some((item) => item.id === nextEntry.id)) return;

  const next = [nextEntry, ...current].slice(0, HISTORY_LIMIT);
  storage.setItem(HISTORY_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("typing-race:local-history"));
}

export function clearLocalHistory(): void {
  const storage = getStorage();
  if (!storage) return;

  storage.removeItem(HISTORY_KEY);
  window.dispatchEvent(new Event("typing-race:local-history"));
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function createProfileId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2)}`;
  return `browser-${random.slice(0, 8)}`;
}

function isLocalHistoryEntry(value: unknown): value is LocalHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<LocalHistoryEntry>;
  return (
    typeof entry.id === "string" &&
    (entry.kind === "practice" || entry.kind === "race") &&
    typeof entry.finishedAt === "number" &&
    typeof entry.passageLength === "string" &&
    typeof entry.passageWords === "number" &&
    typeof entry.wpm === "number" &&
    typeof entry.accuracy === "number" &&
    typeof entry.elapsedMs === "number" &&
    typeof entry.correctChars === "number"
  );
}
