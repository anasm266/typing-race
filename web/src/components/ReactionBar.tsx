import { useCallback, useState } from "react";
import type { ClientMsg, ReactionKey } from "../lib/protocol";
import {
  REACTIONS,
  REACTION_COOLDOWN_MS,
  type ReactionDef,
} from "../lib/reactions";

interface ReactionBarProps {
  send: (msg: ClientMsg) => void;
}

export function ReactionBar({ send }: ReactionBarProps) {
  const [locked, setLocked] = useState<ReactionKey[]>([]);
  const [pulsing, setPulsing] = useState<ReactionKey | null>(null);

  const trigger = useCallback(
    (key: ReactionKey) => {
      if (locked.includes(key)) return;
      send({ t: "reaction", key });
      setPulsing(key);
      setLocked((prev) => [...prev, key]);
      window.setTimeout(() => {
        setLocked((prev) => prev.filter((k) => k !== key));
      }, REACTION_COOLDOWN_MS);
      window.setTimeout(
        () => setPulsing((prev) => (prev === key ? null : prev)),
        260
      );
    },
    [locked, send]
  );

  return (
    <div
      className="flex flex-wrap justify-center gap-2"
      aria-label="trash-talk reactions"
    >
      {REACTIONS.map((r) => (
        <ReactionButton
          key={r.key}
          reaction={r}
          locked={locked.includes(r.key)}
          pulsing={pulsing === r.key}
          onClick={() => trigger(r.key)}
        />
      ))}
    </div>
  );
}

function ReactionButton({
  reaction,
  locked,
  pulsing,
  onClick,
}: {
  reaction: ReactionDef;
  locked: boolean;
  pulsing: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={locked}
      title={reaction.label}
      aria-label={reaction.label}
      className={
        "flex flex-col items-center gap-0.5 px-3 py-2 min-w-[64px] border transition-colors " +
        (locked
          ? "border-border/50 text-fg-dimmer cursor-not-allowed"
          : "border-border text-fg-dim hover:border-accent hover:text-accent cursor-pointer") +
        (pulsing ? " reaction-pulse" : "")
      }
    >
      <span
        className={
          "text-xl leading-none " +
          (locked ? "opacity-40" : "opacity-100")
        }
      >
        {reaction.emoji}
      </span>
      <span
        className={
          "text-[0.55rem] uppercase tracking-[0.1em] " +
          (locked ? "opacity-40" : "opacity-100")
        }
      >
        {reaction.text}
      </span>
    </button>
  );
}
