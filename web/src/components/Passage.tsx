import { useMemo } from "react";

interface PassageProps {
  passage: string;
  typed: string;
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

export function Passage({ passage, typed }: PassageProps) {
  const tokens = useMemo(() => tokenize(passage), [passage]);

  return (
    <div
      className="font-mono text-[clamp(1.1rem,2.2vw,1.5rem)] leading-[2] tracking-wide text-fg-dim max-w-[800px] w-full select-none"
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
                />
              );
            })}
          </span>
        );
      })}
    </div>
  );
}

interface CharProps {
  ch: string;
  globalIdx: number;
  typed: string;
}

function Char({ ch, globalIdx, typed }: CharProps) {
  const isTyped = globalIdx < typed.length;
  const isCorrect = isTyped && typed[globalIdx] === ch;
  const isWrong = isTyped && !isCorrect;
  const isCursor = globalIdx === typed.length;

  return (
    <span
      className={
        "passage-char " +
        (isCorrect ? "text-fg" : "") +
        (!isTyped && !isCursor ? "text-fg-dim" : "")
      }
      data-cursor={isCursor ? "true" : undefined}
      data-wrong={isWrong ? "true" : undefined}
    >
      {ch}
    </span>
  );
}
