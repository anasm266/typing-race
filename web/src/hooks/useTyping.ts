import { useCallback, useEffect, useRef, useState } from "react";
import { calcWpm, type WpmSample } from "../lib/wpm";

export type TypingState = "idle" | "typing" | "done";

export interface UseTypingResult {
  state: TypingState;
  passage: string;
  typed: string;
  correctChars: number;
  totalKeystrokes: number;
  elapsedMs: number;
  wpmSamples: WpmSample[];
  handleKey: (key: string) => void;
  reset: () => void;
}

export function useTyping(passage: string): UseTypingResult {
  const [typed, setTyped] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [totalKeystrokes, setTotalKeystrokes] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [samples, setSamples] = useState<WpmSample[]>([]);

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
      const t = typedRef.current;
      let correct = 0;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === passage[i]) correct++;
      }
      const elapsedMs = Date.now() - start;
      setSamples((s) => [
        ...s,
        { t: Math.round((elapsedMs / 1000) * 10) / 10, wpm: calcWpm(correct, elapsedMs) },
      ]);
    }, 1000);
    return () => window.clearInterval(id);
  }, [active, passage]);

  useEffect(() => {
    if (endedAt !== null) return;
    if (typed.length === passage.length && typed === passage) {
      setEndedAt(Date.now());
    }
  }, [typed, passage, endedAt]);

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

  const reset = useCallback(() => {
    setTyped("");
    setStartedAt(null);
    setEndedAt(null);
    setTotalKeystrokes(0);
    setSamples([]);
    setNow(Date.now());
  }, []);

  let correctChars = 0;
  for (let i = 0; i < typed.length; i++) {
    if (typed[i] === passage[i]) correctChars++;
  }

  const elapsedMs =
    startedAt === null ? 0 : (endedAt ?? now) - startedAt;

  const state: TypingState =
    endedAt !== null ? "done" : startedAt !== null ? "typing" : "idle";

  return {
    state,
    passage,
    typed,
    correctChars,
    totalKeystrokes,
    elapsedMs,
    wpmSamples: samples,
    handleKey,
    reset,
  };
}
