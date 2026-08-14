import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { Seat } from "../lib/protocol";
import { REACTION_BY_KEY, REACTION_TOAST_MS } from "../lib/reactions";
import { seatName, seatTheme } from "../lib/seats";
import type { ReactionEvent } from "../hooks/useRoom";

interface ReactionToastProps {
  reactions: ReactionEvent[];
  mySeat: Seat | null;
}

const TOAST_LEAVE_MS = 160;
const MAX_VISIBLE = 3;
const STACK_OFFSET_PX = 52;

export const ReactionToast = memo(function ReactionToast({
  reactions,
  mySeat,
}: ReactionToastProps) {
  const [stack, setStack] = useState<ReactionEvent[]>([]);
  const seenRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const fresh = reactions.filter(
      (reaction) =>
        !seenRef.current.has(reaction.id) && reaction.seat !== mySeat
    );
    if (fresh.length === 0) return;
    for (const reaction of fresh) seenRef.current.add(reaction.id);
    setStack((current) => [...current, ...fresh].slice(-MAX_VISIBLE));
  }, [reactions, mySeat]);

  const dismiss = useCallback((id: number) => {
    setStack((current) => current.filter((toast) => toast.id !== id));
  }, []);

  if (stack.length === 0) return null;

  return (
    <>
      {stack.map((toast, index) => (
        <Toast
          key={toast.id}
          reaction={toast}
          mySeat={mySeat}
          offset={index * STACK_OFFSET_PX}
          onDone={dismiss}
        />
      ))}
    </>
  );
});

function Toast({
  reaction,
  mySeat,
  offset,
  onDone,
}: {
  reaction: ReactionEvent;
  mySeat: Seat | null;
  offset: number;
  onDone: (id: number) => void;
}) {
  const [phase, setPhase] = useState<"hidden" | "visible" | "leaving">(
    "hidden"
  );

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setPhase("visible"));
    return () => window.cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const leaveId = window.setTimeout(
      () => setPhase("leaving"),
      Math.max(0, REACTION_TOAST_MS - TOAST_LEAVE_MS)
    );
    const clearId = window.setTimeout(
      () => onDone(reaction.id),
      REACTION_TOAST_MS
    );
    return () => {
      window.clearTimeout(leaveId);
      window.clearTimeout(clearId);
    };
  }, [reaction.id, onDone]);

  const def = REACTION_BY_KEY[reaction.key];
  if (!def) return null;

  const theme = seatTheme(reaction.seat);

  return (
    <div
      role="status"
      aria-live="polite"
      data-state={phase}
      className="reaction-toast fixed top-4 left-1/2 z-50 flex items-center gap-3 px-4 py-2 bg-bg-soft border shadow-lg"
      style={
        {
          "--toast-offset": `${offset}px`,
          borderColor: theme.color,
        } as React.CSSProperties
      }
    >
      <span className="text-2xl leading-none">{def.emoji}</span>
      <div className="flex flex-col items-start">
        <span
          className="text-[0.6rem] uppercase tracking-[0.15em]"
          style={{ color: theme.color }}
        >
          {seatName(reaction.seat, mySeat)}
        </span>
        <span className="text-sm text-fg">{def.text}</span>
      </div>
    </div>
  );
}
