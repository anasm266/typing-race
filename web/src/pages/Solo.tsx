import { useState } from "react";
import { Link } from "wouter";
import { TypingRace } from "../components/TypingRace";
import {
  getSavedPassageLength,
  savePassageLength,
} from "../lib/preferences";
import { DEFAULT_CONFIG, type PassageLength } from "../lib/protocol";

export function Solo() {
  const [passageLength, setPassageLength] = useState<PassageLength>(
    () => getSavedPassageLength() ?? DEFAULT_CONFIG.passageLength
  );

  function changePassageLength(length: PassageLength) {
    savePassageLength(length);
    setPassageLength(length);
  }

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      <div className="flex items-center gap-3 text-[0.7rem] uppercase tracking-[0.2em] text-fg-dim">
        <Link href="/" className="hover:text-accent transition-colors">
          {"<-"} home
        </Link>
        <span className="text-fg-dimmer">.</span>
        <span>practice . offline</span>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {(["short", "medium", "long"] satisfies PassageLength[]).map(
          (length) => {
            const selected = length === passageLength;
            return (
              <button
                key={length}
                onClick={() => changePassageLength(length)}
                className={
                  "px-4 py-2 text-sm transition-colors border " +
                  (selected
                    ? "border-accent text-accent bg-accent/5"
                    : "border-border text-fg-dim hover:border-fg-dim hover:text-fg")
                }
              >
                {length}
              </button>
            );
          }
        )}
      </div>

      <TypingRace key={passageLength} passageLength={passageLength} />
    </div>
  );
}
