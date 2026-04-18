import type { ReactionKey } from "./protocol";

export interface ReactionDef {
  key: ReactionKey;
  emoji: string;
  /** short copy shown under the button and inside the toast */
  text: string;
  /** accessibility label + tooltip */
  label: string;
}

/**
 * Ordered by the emotional arc of a race: observe → taunt → react →
 * self-deprecate → hype → close. Keep it at 6 — more and the bar gets
 * crowded, and each button stops feeling meaningful.
 */
export const REACTIONS: readonly ReactionDef[] = [
  {
    key: "see_you",
    emoji: "👀",
    text: "i see you",
    label: "i see you",
  },
  {
    key: "take_time",
    emoji: "🐢",
    text: "take your time",
    label: "take your time",
  },
  {
    key: "oof",
    emoji: "😬",
    text: "oof",
    label: "oof",
  },
  {
    key: "wait_up",
    emoji: "🫠",
    text: "wait up!",
    label: "wait up!",
  },
  {
    key: "lets_go",
    emoji: "🔥",
    text: "let's go",
    label: "let's go",
  },
  {
    key: "gg",
    emoji: "💀",
    text: "gg",
    label: "gg",
  },
] as const;

export const REACTION_BY_KEY: Record<ReactionKey, ReactionDef> = Object.fromEntries(
  REACTIONS.map((r) => [r.key, r])
) as Record<ReactionKey, ReactionDef>;

/** Per-button cooldown after a reaction is sent. */
export const REACTION_COOLDOWN_MS = 3_000;

/** How long a received reaction stays on screen as a toast. */
export const REACTION_TOAST_MS = 2_500;
