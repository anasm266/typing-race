import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface TouchKeyboardInputProps {
  typed: string;
  canFocus: boolean;
  canType: boolean;
  onKey: (key: string) => void;
  children: ReactNode;
}

export function TouchKeyboardInput({
  typed,
  canFocus,
  canType,
  onKey,
  children,
}: TouchKeyboardInputProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!canFocus && inputRef.current) {
      inputRef.current.blur();
    }
  }, [canFocus]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el || document.activeElement !== el) return;
    const end = typed.length;
    el.setSelectionRange(end, end);
  }, [typed]);

  function handleChange(nextValue: string) {
    if (!canType) return;
    if (nextValue === typed) return;

    if (nextValue.startsWith(typed)) {
      for (const ch of nextValue.slice(typed.length)) {
        pushChar(ch);
      }
      return;
    }

    if (typed.startsWith(nextValue)) {
      for (let i = 0; i < typed.length - nextValue.length; i++) {
        onKey("Backspace");
      }
      return;
    }

    let prefix = 0;
    while (
      prefix < typed.length &&
      prefix < nextValue.length &&
      typed[prefix] === nextValue[prefix]
    ) {
      prefix++;
    }

    for (let i = 0; i < typed.length - prefix; i++) {
      onKey("Backspace");
    }
    for (const ch of nextValue.slice(prefix)) {
      pushChar(ch);
    }
  }

  function pushChar(ch: string) {
    if (ch === "\n" || ch === "\r") return;
    onKey(ch);
  }

  return (
    <div className="relative w-full">
      {children}
      <textarea
        ref={inputRef}
        value={typed}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        enterKeyHint="done"
        inputMode="text"
        rows={1}
        disabled={!canFocus}
        aria-label="Typing input for mobile keyboard"
        className="mobile-type-capture md:hidden"
      />
    </div>
  );
}
