import { useCallback, useEffect, useReducer } from "react";
import { calcWpm, type WpmSample } from "../lib/wpm";

export type TypingState = "idle" | "typing" | "done";

/**
 * Where Ctrl+Backspace should leave the cursor.
 *
 * Anchored to *passage* whitespace, not *typed* whitespace, so if the user
 * inserted spurious spaces in the middle of a word the cursor still lands
 * at the start of the current passage-word - which is what people expect
 * when they hit ctrl+backspace to "redo the word".
 *
 * Algorithm:
 *   1. Walk back over any whitespace immediately before the current pos.
 *      (Handles the case where pos is already at a word boundary - we
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

function countCorrectChars(typed: string, passage: string): number {
  let correct = 0;
  for (let i = 0; i < typed.length; i++) {
    if (typed[i] === passage[i]) correct++;
  }
  return correct;
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

interface TypingStore {
  typed: string;
  manualStartedAt: number | null;
  endedAt: number | null;
  totalKeystrokes: number;
  now: number;
  samples: WpmSample[];
}

type TypingAction =
  | { type: "tick"; now: number }
  | {
      type: "sample";
      now: number;
      passage: string;
      startAtOverride?: number;
    }
  | { type: "backspace" }
  | { type: "ctrl_backspace"; passage: string }
  | {
      type: "char";
      key: string;
      now: number;
      passage: string;
      startAtOverride?: number;
    }
  | { type: "reset"; now: number };

function createInitialStore(): TypingStore {
  return {
    typed: "",
    manualStartedAt: null,
    endedAt: null,
    totalKeystrokes: 0,
    now: Date.now(),
    samples: [],
  };
}

function resolveStartedAt(
  state: TypingStore,
  startAtOverride?: number
): number | null {
  return startAtOverride ?? state.manualStartedAt;
}

function typingReducer(
  state: TypingStore,
  action: TypingAction
): TypingStore {
  switch (action.type) {
    case "tick":
      return { ...state, now: action.now };

    case "sample": {
      const startedAt = resolveStartedAt(state, action.startAtOverride);
      if (startedAt === null || state.endedAt !== null) return state;

      const elapsedMs = action.now - startedAt;
      if (elapsedMs <= 0) return state;

      const correctChars = countCorrectChars(state.typed, action.passage);
      return {
        ...state,
        samples: [
          ...state.samples,
          {
            t: Math.round((elapsedMs / 1000) * 10) / 10,
            wpm: calcWpm(correctChars, elapsedMs),
          },
        ],
      };
    }

    case "backspace":
      if (state.endedAt !== null || state.typed.length === 0) return state;
      return { ...state, typed: state.typed.slice(0, -1) };

    case "ctrl_backspace":
      if (state.endedAt !== null) return state;
      return {
        ...state,
        typed: state.typed.slice(
          0,
          ctrlBackspaceTarget(state.typed.length, action.passage)
        ),
      };

    case "char": {
      if (state.endedAt !== null) return state;
      if (state.typed.length >= action.passage.length) return state;

      const manualStartedAt =
        action.startAtOverride === undefined &&
        state.manualStartedAt === null
          ? action.now
          : state.manualStartedAt;
      const nextTyped = state.typed + action.key;

      return {
        ...state,
        typed: nextTyped,
        manualStartedAt,
        totalKeystrokes: state.totalKeystrokes + 1,
        endedAt:
          nextTyped.length >= action.passage.length
            ? action.now
            : state.endedAt,
      };
    }

    case "reset":
      return {
        ...createInitialStore(),
        now: action.now,
      };
  }
}

export function useTyping(
  passage: string,
  options: UseTypingOptions = {}
): UseTypingResult {
  const { startAt: startAtOverride } = options;
  const [store, dispatch] = useReducer(
    typingReducer,
    undefined,
    createInitialStore
  );

  const startedAt = resolveStartedAt(store, startAtOverride);
  const active = startedAt !== null && store.endedAt === null;

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      dispatch({ type: "tick", now: Date.now() });
    }, 100);
    return () => window.clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      dispatch({
        type: "sample",
        now: Date.now(),
        passage,
        startAtOverride,
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [active, passage, startAtOverride]);

  const handleKey = useCallback(
    (key: string) => {
      if (store.endedAt !== null) return;

      if (key === "Backspace") {
        dispatch({ type: "backspace" });
        return;
      }

      // Ctrl+Backspace / Alt+Backspace - delete the previous word. RaceView
      // translates the native modifier combo into this synthetic key id
      // before calling handleKey.
      if (key === "CtrlBackspace") {
        dispatch({ type: "ctrl_backspace", passage });
        return;
      }

      if (key.length !== 1) return;

      dispatch({
        type: "char",
        key,
        now: Date.now(),
        passage,
        startAtOverride,
      });
    },
    [store.endedAt, passage, startAtOverride]
  );

  const reset = useCallback(() => {
    dispatch({ type: "reset", now: Date.now() });
  }, []);

  const correctChars = countCorrectChars(store.typed, passage);
  const rawElapsed =
    startedAt === null ? 0 : (store.endedAt ?? store.now) - startedAt;
  const elapsedMs = Math.max(0, rawElapsed);
  const wpm = calcWpm(correctChars, elapsedMs);

  const state: TypingState =
    store.endedAt !== null
      ? "done"
      : startedAt !== null
      ? "typing"
      : "idle";

  return {
    state,
    passage,
    typed: store.typed,
    correctChars,
    totalKeystrokes: store.totalKeystrokes,
    elapsedMs,
    wpm,
    wpmSamples: store.samples,
    handleKey,
    reset,
  };
}
