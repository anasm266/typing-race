import { memo, useEffect, useState } from "react";
import type { PlayerRole, ReactionKey } from "../lib/protocol";
import { REACTION_BY_KEY, REACTION_TOAST_MS } from "../lib/reactions";
import type { OpponentReaction } from "../hooks/useRoom";

interface ReactionToastProps {
  latest: OpponentReaction | null;
  myRole: PlayerRole | null;
}

interface ActiveToast {
  id: number;
  key: ReactionKey;
  phase: "hidden" | "visible" | "leaving";
}

const TOAST_LEAVE_MS = 160;

export const ReactionToast = memo(function ReactionToast({
  latest,
  myRole,
}: ReactionToastProps) {
  const [toast, setToast] = useState<ActiveToast | null>(null);

  useEffect(() => {
    if (!latest) return;
    // Ignore reactions the current client sent (shouldn't happen since
    // server broadcasts with broadcastExcept, but belt + suspenders).
    if (myRole && latest.from === myRole) return;
    setToast({ id: latest.at, key: latest.key, phase: "hidden" });
  }, [latest, myRole]);

  useEffect(() => {
    if (!toast) return;
    if (toast.phase !== "hidden") return;

    const raf = window.requestAnimationFrame(() => {
      setToast((prev) =>
        prev?.id === toast.id ? { ...prev, phase: "visible" } : prev
      );
    });

    return () => window.cancelAnimationFrame(raf);
  }, [toast]);

  useEffect(() => {
    if (!toast || toast.phase !== "visible") return;

    const leaveDelay = Math.max(0, REACTION_TOAST_MS - TOAST_LEAVE_MS);
    const leaveId = window.setTimeout(() => {
      setToast((prev) =>
        prev?.id === toast.id ? { ...prev, phase: "leaving" } : prev
      );
    }, leaveDelay);

    const clearId = window.setTimeout(() => {
      setToast((prev) => (prev?.id === toast.id ? null : prev));
    }, REACTION_TOAST_MS);

    return () => {
      window.clearTimeout(leaveId);
      window.clearTimeout(clearId);
    };
  }, [toast]);

  if (!toast) return null;
  const def = REACTION_BY_KEY[toast.key];
  if (!def) return null;

  return (
    <div
      key={toast.id}
      role="status"
      aria-live="polite"
      data-state={toast.phase}
      className="reaction-toast fixed top-4 left-1/2 z-50 flex items-center gap-3 px-4 py-2 bg-bg-soft border border-opponent/50 shadow-lg shadow-opponent/10"
    >
      <span className="text-2xl leading-none">{def.emoji}</span>
      <div className="flex flex-col items-start">
        <span className="text-[0.6rem] uppercase tracking-[0.15em] text-opponent">
          rival
        </span>
        <span className="text-sm text-fg">{def.text}</span>
      </div>
    </div>
  );
});
