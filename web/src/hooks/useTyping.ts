import { useCallback, useEffect, useRef, useState } from "react";
import { calcWpm, type WpmSample } from "../lib/wpm";

export type TypingState = "idle" | "typing" | "done";

/**
 * Where Ctrl+Backspace should leave the cursor.
 *
 * Anchored to *passage* whitespace, not *typed* whitespace, so if the user
 * inserted spurious spaces in the middle of a word the cursor still lands
 * at the start of the current passage-word — which is what people expect
 * when they hit ctrl+backspace to "redo the word".
 *
 * Algorithm:
 *   1. Walk back over any whitespace immediately before the current pos.
 *      (Handles the case where pos is already at a word boundary — we
 *      should delete the *previous* word, not stay put.)
 *   2. Walk back over the preceding word.
 *   3. Land at the first index of that word.
 */
function ctrlBackspaceTarget(
  typedLen: number,
  passage: string
): number {
  let pos = Math.min(typedLen, passage.length);
  while (pos > 0 && /\s/.test(passage[pos - 1])) pos--;
  while (pos > 0 && !/\s/.test(passage[pos - 1])) pos--;
  return pos;
}

export interface UseTypingOptions {
  /**
   * If provided, timer starts from this ms timestamp regardless of keystrokes.
   * (Used by multiplayer races with a server-anchored start time.)
   * If omitted, timer auto-starts on first keystroke (single-player behavior).
   */
  startAt?: number;
}

export interface UseTypingResult {
  state: TypingState;
  passage: string;
  typed: string;
  correctChars: number;
  totalKeystrokes: number;
  elapsedMs: number;
  wpm: number;
  wpmSamples: WpmSample[];
  handleKey: (key: string) => void;
  reset: () => void;
}

export function useTyping(
  passage: string,
  options: UseTypingOptions = {}
): UseTypingResult {
  const { startAt: startAtOverride } = options;

  const [typed, setTyped] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(
    startAtOverride ?? null
  );
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [totalKeystrokes, setTotalKeystrokes] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [samples, setSamples] = useState<WpmSample[]>([]);

  // If the external startAt changes (race transitions), adopt it.
  useEffect(() => {
    if (startAtOverride === undefined) return;
    setStartedAt(startAtOverride);
  }, [startAtOverride]);

  const active = startedAt !== null && endedAt === null;

  const typedRef = useRef(typed);
  typedRef.current = typed;
  const startedAtRef = useRef(startedAt);
  startedAtRef.current = startedAt;

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      const start = startedAtRef.current;
      if (start === null) return;
      const elapsedMs = Date.now() - start;
      if (elapsedMs <= 0) return;
      const t = typedRef.current;
      let correct = 0;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === passage[i]) correct++;
      }
      setSamples((s) => [
        ...s,
        {
          t: Math.round((elapsedMs / 1000) * 10) / 10,
          wpm: calcWpm(correct, elapsedMs),
        },
      ]);
    }, 1000);
    return () => window.clearInterval(id);
  }, [active, passage]);

  // Race ends as soon as the cursor hits the end of the passage — typos
  // included. Wrong chars stay red, WPM/accuracy absorb the penalty, but
  // the race doesn't get stuck waiting for a character-perfect match.
  useEffect(() => {
    if (endedAt !== null) return;
    if (typed.length >= passage.length) {
      setEndedAt(Date.now());
    }
  }, [typed.length, passage.length, endedAt]);

  const handleKey = useCallback(
    (key: string) => {
      if (endedAt !== null) return;

      if (key === "Backspace") {
        setTyped((t) => (t.length > 0 ? t.slice(0, -1) : t));
        return;
      }

      // Ctrl+Backspace / Alt+Backspace — delete the previous word. RaceView
      // translates the native modifier combo into this synthetic key id
      // before calling handleKey.
      if (key === "CtrlBackspace") {
        setTyped((t) => t.slice(0, ctrlBackspaceTarget(t.length, passage)));
        return;
      }

      if (key.length !== 1) return;

      if (startedAt === null) setStartedAt(Date.now());

      setTotalKeystrokes((k) => k + 1);
      setTyped((t) => (t.length >= passage.length ? t : t + key));
    },
    [startedAt, endedAt, passage]
  );

  const reset = useCallback(() => {
    setTyped("");
    setStartedAt(startAtOverride ?? null);
    setEndedAt(null);
    setTotalKeystrokes(0);
    setSamples([]);
    setNow(Date.now());
  }, [startAtOverride]);

  let correctChars = 0;
  for (let i = 0; i < typed.length; i++) {
    if (typed[i] === passage[i]) correctChars++;
  }

  const rawElapsed =
    startedAt === null ? 0 : (endedAt ?? now) - startedAt;
  const elapsedMs = Math.max(0, rawElapsed);
  const wpm = calcWpm(correctChars, elapsedMs);

  const state: TypingState =
    endedAt !== null ? "done" : startedAt !== null ? "typing" : "idle";

  return {
    state,
    passage,
    typed,
    correctChars,
    totalKeystrokes,
    elapsedMs,
    wpm,
    wpmSamples: samples,
    handleKey,
    reset,
  };
}
