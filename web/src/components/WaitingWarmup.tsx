import { useCallback, useEffect, useRef, useState } from "react";
import { useTyping } from "../hooks/useTyping";
import { randomPassage, type Passage as PassageModel } from "../lib/passages";
import { calcAccuracy } from "../lib/wpm";
import { Passage } from "./Passage";

export function WaitingWarmup() {
  const [active, setActive] = useState(false);
  const [passage, setPassage] = useState<PassageModel>(() =>
    randomPassage("short")
  );
  const [swapping, setSwapping] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const advanceTimerRef = useRef<number | null>(null);
  const {
    state,
    typed,
    correctChars,
    totalKeystrokes,
    wpm,
    handleKey,
    reset,
  } = useTyping(passage.text);
  const accuracy = calcAccuracy(correctChars, totalKeystrokes);

  const focusPanel = useCallback(() => {
    window.requestAnimationFrame(() => panelRef.current?.focus());
  }, []);

  const clearAdvanceTimers = useCallback(() => {
    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  }, []);

  function startWarmup() {
    setActive(true);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    focusPanel();
  }

  const nextPassage = useCallback(() => {
    clearAdvanceTimers();
    setSwapping(false);
    setPassage((current) => randomPassage("short", current.id));
    reset();
  }, [clearAdvanceTimers, reset]);

  useEffect(() => {
    if (!active || state !== "done") return;
    if (advanceTimerRef.current !== null) return;

    fadeTimerRef.current = window.setTimeout(() => {
      setSwapping(true);
      fadeTimerRef.current = null;
    }, 0);
    advanceTimerRef.current = window.setTimeout(() => {
      nextPassage();
      focusPanel();
    }, 120);
    return clearAdvanceTimers;
  }, [active, clearAdvanceTimers, focusPanel, nextPassage, state]);

  useEffect(() => {
    if (!active) return;

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "BUTTON")
      ) {
        return;
      }

      if (e.key === "Backspace" && (e.ctrlKey || e.altKey)) {
        e.preventDefault();
        handleKey("CtrlBackspace");
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "Tab") {
        e.preventDefault();
        nextPassage();
        focusPanel();
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        reset();
        focusPanel();
        return;
      }

      if (
        state !== "done" &&
        (e.key === "Backspace" || e.key === " " || e.key.length === 1)
      ) {
        e.preventDefault();
        handleKey(e.key);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, focusPanel, handleKey, nextPassage, reset, state]);

  if (!active) {
    return (
      <div className="flex flex-col items-center gap-2 pt-1">
        <span className="text-xs text-fg-dimmer">
          warm up while they join
        </span>
        <button
          type="button"
          onClick={startWarmup}
          className="px-4 py-2 border border-border text-xs text-fg-dim hover:border-accent hover:text-accent transition-colors"
        >
          start warmup
        </button>
      </div>
    );
  }

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      className="waiting-warmup w-full border border-border bg-bg-soft/30 px-4 py-4 text-left focus:outline-none"
      onMouseDown={() => focusPanel()}
    >
      <div className="mb-3 flex items-center justify-between gap-4">
        <span className="text-[0.65rem] uppercase tracking-[0.18em] text-fg-dim">
          warmup
        </span>
        <div className="flex items-baseline gap-3 text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
          <span>
            <span className="text-accent tabular-nums">
              {state === "idle" ? "-" : wpm}
            </span>{" "}
            wpm
          </span>
          <span>
            <span className="text-fg tabular-nums">
              {state === "idle" ? "-" : `${accuracy}%`}
            </span>{" "}
            acc
          </span>
        </div>
      </div>

      <div
        key={passage.id}
        className={
          "waiting-warmup-passage transition-all duration-[120ms] ease-out " +
          (swapping ? "translate-y-1 opacity-0" : "translate-y-0 opacity-100")
        }
      >
        <Passage passage={passage.text} typed={typed} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-4 text-[0.68rem] text-fg-dimmer">
        <span>
          <kbd className="text-fg-dim">esc</kbd> reset /{" "}
          <kbd className="text-fg-dim">tab</kbd> next
        </span>
        <span className="uppercase tracking-[0.14em]">
          {passage.wordCount} words
        </span>
      </div>
    </section>
  );
}
