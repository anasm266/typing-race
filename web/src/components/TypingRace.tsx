import { useCallback, useEffect, useState } from "react";
import { useCapsLock } from "../hooks/useCapsLock";
import { useTyping } from "../hooks/useTyping";
import { randomPassage, type Passage } from "../lib/passages";
import { CapsLockWarning } from "./CapsLockWarning";
import { Passage as PassageView } from "./Passage";
import { TouchKeyboardInput } from "./TouchKeyboardInput";
import { Stats } from "./Stats";
import { ResultScreen } from "./ResultScreen";

export function TypingRace() {
  const [passage, setPassage] = useState<Passage>(() => randomPassage());
  const typing = useTyping(passage.text);
  const capsLockOn = useCapsLock(typing.state !== "done");
  const { state, handleKey, reset } = typing;

  const restart = useCallback(() => {
    setPassage((prev) => randomPassage(prev.id));
    reset();
  }, [reset]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (state === "done") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      )
        return;

      // Word-delete: Ctrl+Backspace on Windows/Linux, Alt+Backspace on Mac.
      if (e.key === "Backspace" && (e.ctrlKey || e.altKey)) {
        e.preventDefault();
        handleKey("CtrlBackspace");
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "Tab") {
        e.preventDefault();
        restart();
        return;
      }

      if (e.key === "Backspace" || e.key === " " || e.key.length === 1) {
        e.preventDefault();
        handleKey(e.key);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state, handleKey, restart]);

  if (typing.state === "done") {
    return (
      <ResultScreen
        elapsedMs={typing.elapsedMs}
        correctChars={typing.correctChars}
        totalKeystrokes={typing.totalKeystrokes}
        passageWords={passage.wordCount}
        onRestart={restart}
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-10 w-full">
      <Stats
        elapsedMs={typing.elapsedMs}
        correctChars={typing.correctChars}
        totalKeystrokes={typing.totalKeystrokes}
        state={typing.state}
      />

      <CapsLockWarning visible={capsLockOn} />

      <div className="relative w-full max-w-[800px]">
        <TouchKeyboardInput
          typed={typing.typed}
          canFocus={true}
          canType={true}
          onKey={handleKey}
        >
          <PassageView passage={passage.text} typed={typing.typed} />
        </TouchKeyboardInput>
      </div>

      <div className="flex flex-col items-center gap-3">
        <div className="text-xs text-fg-dimmer flex gap-4">
          <span>
            <kbd className="text-fg-dim">tab</kbd> next passage
          </span>
          <span>
            <kbd className="text-fg-dim">esc</kbd> restart{" "}
            <span className="text-fg-dimmer/50">(coming)</span>
          </span>
        </div>
        <div className="text-[0.7rem] uppercase tracking-[0.15em] text-fg-dimmer">
          {passage.length} · {passage.wordCount} words
        </div>
      </div>
    </div>
  );
}
