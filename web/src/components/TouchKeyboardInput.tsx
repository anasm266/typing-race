import { useEffect, useRef, useState } from "react";

interface TouchKeyboardInputProps {
  typed: string;
  canFocus: boolean;
  canType: boolean;
  onKey: (key: string) => void;
}

export function TouchKeyboardInput({
  typed,
  canFocus,
  canType,
  onKey,
}: TouchKeyboardInputProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!canFocus && inputRef.current) {
      inputRef.current.blur();
    }
  }, [canFocus]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el || !focused) return;
    const end = typed.length;
    el.setSelectionRange(end, end);
  }, [typed, focused]);

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

  const hint = !canFocus
    ? "keyboard unavailable right now"
    : focused
    ? "keyboard ready"
    : "tap here to type";

  return (
    <div className="md:hidden w-full max-w-[800px]">
      <div className="relative border border-border bg-bg-soft/50">
        <textarea
          ref={inputRef}
          value={typed}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          enterKeyHint="done"
          inputMode="text"
          rows={1}
          disabled={!canFocus}
          aria-label="Typing input for mobile keyboard"
          className="pointer-events-none absolute inset-0 h-full w-full resize-none opacity-0"
        />

        <button
          type="button"
          onClick={() => inputRef.current?.focus()}
          disabled={!canFocus}
          className={
            "flex min-h-12 w-full items-center justify-between px-4 py-3 text-sm transition-colors " +
            (!canFocus
              ? "cursor-not-allowed text-fg-dimmer"
              : focused
              ? "text-accent"
              : "text-fg-dim hover:text-accent")
          }
        >
          <span>{hint}</span>
          <span className="text-[0.65rem] uppercase tracking-[0.15em] text-fg-dimmer">
            mobile
          </span>
        </button>
      </div>
    </div>
  );
}
