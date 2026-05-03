import type { PassageLength } from "./protocol";

const PASSAGE_LENGTH_KEY = "typing-race:passage-length";
const PASSAGE_LENGTHS = new Set<PassageLength>([
  "short",
  "medium",
  "long",
]);

export function getSavedPassageLength(): PassageLength | null {
  try {
    const value = localStorage.getItem(PASSAGE_LENGTH_KEY);
    return PASSAGE_LENGTHS.has(value as PassageLength)
      ? (value as PassageLength)
      : null;
  } catch {
    return null;
  }
}

export function savePassageLength(length: PassageLength): void {
  try {
    localStorage.setItem(PASSAGE_LENGTH_KEY, length);
  } catch {
    // localStorage unavailable, keep the in-memory selection only.
  }
}
