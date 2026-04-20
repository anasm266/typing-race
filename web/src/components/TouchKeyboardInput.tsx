import { useEffect, useRef, useState, type ReactNode } from "react";

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

  function focusInput() {
    const el = inputRef.current;
    if (!el || !canFocus) return;
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  }

  return (
    <div
      className="relative w-full"
      onPointerDown={() => {
        if (window.innerWidth >= 768) return;
        focusInput();
      }}
    >
      {children}
      <div className="sr-only md:hidden" aria-hidden="true">
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
          className="pointer-events-none absolute left-0 top-0 h-px w-px resize-none opacity-0"
        />
      </div>
      {!focused && canFocus && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center md:hidden">
          <span className="bg-bg/80 px-2 py-1 text-[0.6rem] uppercase tracking-[0.12em] text-fg-dimmer backdrop-blur">
            tap passage to type
          </span>
        </div>
      )}
    </div>
  );
}
