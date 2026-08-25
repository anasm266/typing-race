import { describe, expect, it } from "vitest";
import {
  decodeClientMessage,
  INVALID_MESSAGE_CODE,
  MAX_CLIENT_MESSAGE_BYTES,
  MESSAGE_TOO_BIG_CODE,
} from "./client-message";

const PASSAGE_LENGTH = 120;

describe("decodeClientMessage", () => {
  it.each([
    "hello",
    "ping",
    "lock_in",
    "start_race",
    "rematch_request",
    "rematch_cancel",
  ] as const)("accepts %s", (t) => {
    expect(decodeClientMessage(JSON.stringify({ t }), PASSAGE_LENGTH)).toEqual({
      ok: true,
      message: { t },
    });
  });

  it("projects progress and ignores legacy extra fields", () => {
    expect(
      decodeClientMessage(
        JSON.stringify({
          t: "progress",
          pos: 12,
          correctCount: 10,
          accuracy: 98.26,
          wpm: { deliberately: "invalid but ignored" },
        }),
        PASSAGE_LENGTH
      )
    ).toEqual({
      ok: true,
      message: {
        t: "progress",
        pos: 12,
        correctCount: 10,
        accuracy: 98.3,
      },
    });
  });

  it("projects finished and ignores legacy timing fields", () => {
    expect(
      decodeClientMessage(
        JSON.stringify({
          t: "finished",
          correctCount: 117,
          accuracy: 97,
          wpm: null,
          elapsedMs: { ignored: true },
        }),
        PASSAGE_LENGTH
      )
    ).toEqual({
      ok: true,
      message: { t: "finished", correctCount: 117, accuracy: 97 },
    });
  });

  it.each(["see_you", "take_time", "oof", "wait_up", "lets_go", "gg"])(
    "accepts reaction %s",
    (key) => {
      expect(
        decodeClientMessage(
          JSON.stringify({ t: "reaction", key }),
          PASSAGE_LENGTH
        ).ok
      ).toBe(true);
    }
  );

  it.each([
    "null",
    "[]",
    "{}",
    '{"t":"unknown"}',
    '{"t":"progress","pos":1,"correctCount":1,"accuracy":null}',
    '{"t":"progress","pos":1,"correctCount":1,"accuracy":{}}',
    '{"t":"progress","pos":1,"correctCount":"1","accuracy":99}',
    '{"t":"progress","pos":121,"correctCount":1,"accuracy":99}',
    '{"t":"progress","pos":1,"correctCount":121,"accuracy":99}',
    '{"t":"progress","pos":1,"correctCount":1,"accuracy":101}',
    '{"t":"progress","pos":1e309,"correctCount":1,"accuracy":99}',
    '{"t":"finished","correctCount":-1,"accuracy":99}',
    '{"t":"reaction","key":"not_allowed"}',
    "not-json",
  ])("rejects malformed payload %s", (raw) => {
    expect(decodeClientMessage(raw, PASSAGE_LENGTH)).toMatchObject({
      ok: false,
      code: INVALID_MESSAGE_CODE,
    });
  });

  it("rejects payloads over the application limit before parsing", () => {
    const raw = JSON.stringify({
      t: "hello",
      padding: "x".repeat(MAX_CLIENT_MESSAGE_BYTES),
    });
    expect(decodeClientMessage(raw, PASSAGE_LENGTH)).toEqual({
      ok: false,
      code: MESSAGE_TOO_BIG_CODE,
      reason: "message_too_big",
    });
  });
});
