import type { ClientMsg, ReactionKey } from "./protocol";

export const MAX_CLIENT_MESSAGE_BYTES = 4 * 1024;
export const INVALID_MESSAGE_CODE = 1008;
export const MESSAGE_TOO_BIG_CODE = 1009;

export type DecodeClientMessageResult =
  | { ok: true; message: ClientMsg }
  | { ok: false; code: 1008 | 1009; reason: string };

const REACTION_KEYS = new Set<ReactionKey>([
  "see_you",
  "take_time",
  "oof",
  "wait_up",
  "lets_go",
  "gg",
]);

function invalid(reason = "invalid_message"): DecodeClientMessageResult {
  return { ok: false, code: INVALID_MESSAGE_CODE, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidPosition(value: unknown, passageLength: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= passageLength
  );
}

function normalizedAccuracy(value: unknown): number | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    return null;
  }
  return Math.round(value * 10) / 10;
}

/** Decode and project untrusted JSON onto the small accepted wire protocol. */
export function decodeClientMessage(
  raw: string,
  passageLength: number
): DecodeClientMessageResult {
  if (new TextEncoder().encode(raw).byteLength > MAX_CLIENT_MESSAGE_BYTES) {
    return { ok: false, code: MESSAGE_TOO_BIG_CODE, reason: "message_too_big" };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return invalid("invalid_json");
  }

  if (!isRecord(value) || typeof value.t !== "string") return invalid();

  switch (value.t) {
    case "hello":
    case "ping":
    case "lock_in":
    case "start_race":
    case "rematch_request":
    case "rematch_cancel":
      return { ok: true, message: { t: value.t } };

    case "progress": {
      const accuracy = normalizedAccuracy(value.accuracy);
      if (
        !isValidPosition(value.pos, passageLength) ||
        !isValidPosition(value.correctCount, passageLength) ||
        accuracy === null
      ) {
        return invalid();
      }
      return {
        ok: true,
        message: {
          t: "progress",
          pos: value.pos,
          correctCount: value.correctCount,
          accuracy,
        },
      };
    }

    case "finished": {
      const accuracy = normalizedAccuracy(value.accuracy);
      if (
        !isValidPosition(value.correctCount, passageLength) ||
        accuracy === null
      ) {
        return invalid();
      }
      return {
        ok: true,
        message: {
          t: "finished",
          correctCount: value.correctCount,
          accuracy,
        },
      };
    }

    case "reaction":
      return typeof value.key === "string" &&
        REACTION_KEYS.has(value.key as ReactionKey)
        ? {
            ok: true,
            message: { t: "reaction", key: value.key as ReactionKey },
          }
        : invalid();

    default:
      return invalid("unknown_message");
  }
}
