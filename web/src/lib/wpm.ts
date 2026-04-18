export interface TypingMetrics {
  wpm: number;
  accuracy: number;
  elapsedMs: number;
  correctChars: number;
  totalKeystrokes: number;
}

/**
 * Industry-standard WPM: 5 characters = 1 word.
 * Only *correctly typed* characters count toward WPM.
 */
export function calcWpm(correctChars: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  const minutes = elapsedMs / 60_000;
  return Math.round(correctChars / 5 / minutes);
}

/**
 * Accuracy = correct keystrokes / total keystrokes committed.
 * Backspaces aren't counted as keystrokes here (see useTyping).
 */
export function calcAccuracy(
  correctChars: number,
  totalKeystrokes: number
): number {
  if (totalKeystrokes === 0) return 100;
  return Math.round((correctChars / totalKeystrokes) * 1000) / 10;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mm = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const ss = (totalSeconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export interface WpmSample {
  /** seconds since race started */
  t: number;
  wpm: number;
}
