import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";

interface PassageProps {
  passage: string;
  typed: string;
  /** Opponent's current typed position. -1 / undefined = don't render. */
  opponentPos?: number;
  playerOnePos?: number;
  playerTwoPos?: number;
  showCursor?: boolean;
}

interface Token {
  type: "word" | "space";
  start: number;
  text: string;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const isSpace = /\s/.test(text[i]);
    let j = i;
    while (j < text.length && /\s/.test(text[j]) === isSpace) j++;
    tokens.push({
      type: isSpace ? "space" : "word",
      start: i,
      text: text.slice(i, j),
    });
    i = j;
  }
  return tokens;
}

export function Passage({
  passage,
  typed,
  opponentPos,
  playerOnePos,
  playerTwoPos,
  showCursor = true,
}: PassageProps) {
  const tokens = useMemo(() => tokenize(passage), [passage]);
  const containerRef = useRef<HTMLDivElement>(null);
  const charRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const cursors = usePassageCursors({
    passage,
    showCursor,
    selfPos: typed.length,
    opponentPos,
    playerOnePos,
    playerTwoPos,
    containerRef,
    charRefs,
  });

  return (
    <div
      ref={containerRef}
      className="relative font-mono text-[clamp(1.1rem,2.2vw,1.5rem)] leading-[2] tracking-wide text-fg-dim max-w-[800px] w-full select-none"
      aria-label="race passage"
    >
      {tokens.map((token) => {
        if (token.type === "space") {
          return token.text.split("").map((ch, idx) => {
            const globalIdx = token.start + idx;
            return (
              <Char
                key={globalIdx}
                ch={ch}
                globalIdx={globalIdx}
                typed={typed}
                showCursor={showCursor}
                setRef={(node) => {
                  charRefs.current[globalIdx] = node;
                }}
              />
            );
          });
        }
        return (
          <span
            key={token.start}
            className="inline-block whitespace-nowrap"
          >
            {token.text.split("").map((ch, idx) => {
              const globalIdx = token.start + idx;
              return (
                <Char
                  key={globalIdx}
                  ch={ch}
                  globalIdx={globalIdx}
                  typed={typed}
                  showCursor={showCursor}
                  setRef={(node) => {
                    charRefs.current[globalIdx] = node;
                  }}
                />
              );
            })}
          </span>
        );
      })}
      {cursors.self && <SmoothCursor kind="self" cursor={cursors.self} />}
      {cursors.opponent && (
        <SmoothCursor kind="opponent" cursor={cursors.opponent} />
      )}
      {cursors.playerOne && (
        <SmoothCursor kind="playerOne" cursor={cursors.playerOne} />
      )}
      {cursors.playerTwo && (
        <SmoothCursor kind="playerTwo" cursor={cursors.playerTwo} />
      )}
    </div>
  );
}

interface CharProps {
  ch: string;
  globalIdx: number;
  typed: string;
  showCursor: boolean;
  setRef: (node: HTMLSpanElement | null) => void;
}

function Char({
  ch,
  globalIdx,
  typed,
  showCursor,
  setRef,
}: CharProps) {
  const isTyped = globalIdx < typed.length;
  const isCorrect = isTyped && typed[globalIdx] === ch;
  const isWrong = isTyped && !isCorrect;
  const isCursor = showCursor && globalIdx === typed.length;

  return (
    <span
      ref={setRef}
      className={
        "passage-char " +
        (isCorrect ? "text-fg" : "") +
        (!isTyped && !isCursor ? "text-fg-dim" : "")
      }
      data-wrong={isWrong ? "true" : undefined}
    >
      {ch}
    </span>
  );
}

interface CursorPosition {
  x: number;
  y: number;
  height: number;
}

interface CursorInput {
  passage: string;
  showCursor: boolean;
  selfPos: number;
  opponentPos?: number;
  playerOnePos?: number;
  playerTwoPos?: number;
  containerRef: RefObject<HTMLDivElement | null>;
  charRefs: RefObject<Array<HTMLSpanElement | null>>;
}

function usePassageCursors({
  passage,
  showCursor,
  selfPos,
  opponentPos,
  playerOnePos,
  playerTwoPos,
  containerRef,
  charRefs,
}: CursorInput) {
  const [cursors, setCursors] = useState<{
    self?: CursorPosition;
    opponent?: CursorPosition;
    playerOne?: CursorPosition;
    playerTwo?: CursorPosition;
  }>({});

  useLayoutEffect(() => {
    function measure() {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const next = {
        self:
          showCursor && selfPos <= passage.length
            ? cursorForIndex(selfPos, containerRect, charRefs.current)
            : undefined,
        opponent:
          opponentPos !== undefined
            ? cursorForIndex(opponentPos, containerRect, charRefs.current)
            : undefined,
        playerOne:
          playerOnePos !== undefined
            ? cursorForIndex(playerOnePos, containerRect, charRefs.current)
            : undefined,
        playerTwo:
          playerTwoPos !== undefined
            ? cursorForIndex(playerTwoPos, containerRect, charRefs.current)
            : undefined,
      };
      setCursors(next);
    }

    measure();

    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [
    passage,
    showCursor,
    selfPos,
    opponentPos,
    playerOnePos,
    playerTwoPos,
    containerRef,
    charRefs,
  ]);

  return cursors;
}

function cursorForIndex(
  index: number,
  containerRect: DOMRect,
  refs: Array<HTMLSpanElement | null>
): CursorPosition | undefined {
  const bounded = Math.max(0, Math.min(index, refs.length));
  const target = refs[bounded] ?? refs[refs.length - 1];
  if (!target) return undefined;

  const rect = target.getBoundingClientRect();
  const lastChar = bounded >= refs.length;
  return {
    x: (lastChar ? rect.right : rect.left) - containerRect.left,
    y: rect.top - containerRect.top,
    height: rect.height,
  };
}

function SmoothCursor({
  kind,
  cursor,
}: {
  kind: "self" | "opponent" | "playerOne" | "playerTwo";
  cursor: CursorPosition;
}) {
  return (
    <span
      className={`smooth-caret smooth-caret-${kind}`}
      style={{
        height: `${cursor.height * 0.84}px`,
        transform: `translate3d(${cursor.x - 1}px, ${
          cursor.y + cursor.height * 0.08
        }px, 0)`,
      }}
    />
  );
}
