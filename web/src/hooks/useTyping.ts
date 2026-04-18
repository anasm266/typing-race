import { useCallback, useEffect, useRef, useState } from "react";
import { calcWpm, type WpmSample } from "../lib/wpm";

export type TypingState = "idle" | "typing" | "done";

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
  deleteWord: () => void;
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

      if (key.length !== 1) return;

      if (startedAt === null) setStartedAt(Date.now());

      setTotalKeystrokes((k) => k + 1);
      setTyped((t) => (t.length >= passage.length ? t : t + key));
    },
    [startedAt, endedAt, passage]
  );

  /**
   * Ctrl+Backspace / Alt+Backspace semantics: wipe back to the start of
   * the current word. If we're already on a whitespace run, skip that
   * first, then keep deleting non-whitespace. Matches how every text
   * input on the planet handles the shortcut.
   */
  const deleteWord = useCallback(() => {
    if (endedAt !== null) return;
    setTyped((t) => {
      if (t.length === 0) return t;
      let i = t.length;
      // Skip trailing whitespace
      while (i > 0 && /\s/.test(t[i - 1])) i--;
      // Delete non-whitespace run
      while (i > 0 && !/\s/.test(t[i - 1])) i--;
      return t.slice(0, i);
    });
  }, [endedAt]);

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
    deleteWord,
    reset,
  };
}
