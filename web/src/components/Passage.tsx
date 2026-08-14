import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";

/** A rival caret to draw over the passage. */
export interface PassageCursor {
  seat: number;
  pos: number;
  /** CSS color, from the seat theme. */
  color: string;
  /** Short tag rendered above the caret, e.g. "P3". */
  label: string;
}

interface PassageProps {
  passage: string;
  typed: string;
  /** Other racers' positions. */
  cursors?: PassageCursor[];
  /** Draw the viewer's own caret at the end of `typed`. */
  showCursor?: boolean;
  selfColor?: string;
  /** Label rival carets. Off for two-player races, where color is enough. */
  showTags?: boolean;
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
  cursors = [],
  showCursor = true,
  selfColor = "var(--color-accent)",
  showTags = false,
}: PassageProps) {
  const tokens = useMemo(() => tokenize(passage), [passage]);
  const containerRef = useRef<HTMLDivElement>(null);
  const charRefs = useRef<Array<HTMLSpanElement | null>>([]);

  const placed = usePassageCursors({
    passage,
    selfPos: showCursor ? typed.length : null,
    cursors,
    containerRef,
    charRefs,
  });

  // Characters only depend on what the viewer typed, so rival carets
  // moving doesn't re-render hundreds of spans.
  const body = useMemo(
    () =>
      tokens.map((token) => {
        if (token.type === "space") {
          return token.text.split("").map((ch, idx) => {
            const globalIdx = token.start + idx;
            return (
              <Char
                key={globalIdx}
                ch={ch}
                globalIdx={globalIdx}
                typed={typed}
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
                  setRef={(node) => {
                    charRefs.current[globalIdx] = node;
                  }}
                />
              );
            })}
          </span>
        );
      }),
    [tokens, typed]
  );

  return (
    <div
      ref={containerRef}
      className="relative font-mono text-[clamp(1.1rem,2.2vw,1.5rem)] leading-[2] tracking-wide text-fg-dim max-w-[800px] w-full select-none"
      aria-label="race passage"
    >
      {body}
      {placed.map((cursor) => (
        <SmoothCursor
          key={cursor.seat}
          cursor={cursor}
          color={cursor.seat === SELF_SEAT ? selfColor : cursor.color}
          isSelf={cursor.seat === SELF_SEAT}
          showTag={showTags && cursor.seat !== SELF_SEAT}
        />
      ))}
    </div>
  );
}

interface CharProps {
  ch: string;
  globalIdx: number;
  typed: string;
  setRef: (node: HTMLSpanElement | null) => void;
}

function Char({ ch, globalIdx, typed, setRef }: CharProps) {
  const isTyped = globalIdx < typed.length;
  const isCorrect = isTyped && typed[globalIdx] === ch;
  const isWrong = isTyped && !isCorrect;

  return (
    <span
      ref={setRef}
      className={
        "passage-char " +
        (isCorrect ? "text-fg" : "") +
        (!isTyped ? "text-fg-dim" : "")
      }
      data-wrong={isWrong ? "true" : undefined}
    >
      {ch}
    </span>
  );
}

const SELF_SEAT = -1;
/** Horizontal nudge applied to carets that land on the same character. */
const STACK_OFFSET_PX = 3;

interface PlacedCursor {
  seat: number;
  color: string;
  label: string;
  x: number;
  y: number;
  height: number;
}

interface CursorInput {
  passage: string;
  selfPos: number | null;
  cursors: PassageCursor[];
  containerRef: RefObject<HTMLDivElement | null>;
  charRefs: RefObject<Array<HTMLSpanElement | null>>;
}

function usePassageCursors({
  passage,
  selfPos,
  cursors,
  containerRef,
  charRefs,
}: CursorInput): PlacedCursor[] {
  const [placed, setPlaced] = useState<PlacedCursor[]>([]);

  // Re-measure only when a caret actually moves, not on every render.
  const signature = cursors
    .map((c) => `${c.seat}:${c.pos}:${c.color}:${c.label}`)
    .join("|");

  useLayoutEffect(() => {
    function measure() {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();

      const wanted: Array<{ seat: number; pos: number; color: string; label: string }> =
        [];
      for (const cursor of cursors) {
        wanted.push(cursor);
      }
      if (selfPos !== null && selfPos <= passage.length) {
        wanted.push({
          seat: SELF_SEAT,
          pos: selfPos,
          color: "",
          label: "you",
        });
      }

      const next: PlacedCursor[] = [];
      for (const cursor of wanted) {
        const position = cursorForIndex(
          cursor.pos,
          containerRect,
          charRefs.current ?? []
        );
        if (!position) continue;
        next.push({ ...cursor, ...position });
      }

      // Carets sharing a character fan out instead of stacking into a blur.
      const columns = new Map<string, number>();
      for (const cursor of next) {
        const key = `${Math.round(cursor.x)}:${Math.round(cursor.y)}`;
        const taken = columns.get(key) ?? 0;
        cursor.x += taken * STACK_OFFSET_PX;
        columns.set(key, taken + 1);
      }

      setPlaced(next);
    }

    measure();

    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passage, selfPos, signature, containerRef, charRefs]);

  return placed;
}

function cursorForIndex(
  index: number,
  containerRect: DOMRect,
  refs: Array<HTMLSpanElement | null>
): { x: number; y: number; height: number } | undefined {
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
  cursor,
  color,
  isSelf,
  showTag,
}: {
  cursor: PlacedCursor;
  color: string;
  isSelf: boolean;
  showTag: boolean;
}) {
  const transform = `translate3d(${cursor.x - 1}px, ${
    cursor.y + cursor.height * 0.08
  }px, 0)`;

  return (
    <>
      <span
        className="smooth-caret"
        data-self={isSelf ? "true" : "false"}
        style={
          {
            height: `${cursor.height * 0.84}px`,
            transform,
            "--caret-color": color,
          } as React.CSSProperties
        }
      />
      {showTag && (
        <span
          className="caret-tag"
          style={
            {
              transform: `translate3d(${cursor.x - 1}px, ${
                cursor.y - cursor.height * 0.18
              }px, 0)`,
              "--caret-color": color,
            } as React.CSSProperties
          }
        >
          {cursor.label}
        </span>
      )}
    </>
  );
}
