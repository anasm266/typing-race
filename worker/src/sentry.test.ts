import { describe, expect, it } from "vitest";
import type { ErrorEvent, EventHint } from "@sentry/cloudflare";
import { sentryOptions } from "./sentry";

describe("sentryOptions", () => {
  it("is disabled when a repository clone has no DSN", () => {
    const options = sentryOptions({ SENTRY_ENVIRONMENT: "production" });
    expect(options.enabled).toBe(false);
    expect(options.dsn).toBeUndefined();
  });

  it("is disabled outside production even if a DSN is supplied", () => {
    const options = sentryOptions({
      SENTRY_DSN: "https://public@example.invalid/1",
      SENTRY_ENVIRONMENT: "k6",
    });
    expect(options.enabled).toBe(false);
    expect(options.dsn).toBeUndefined();
  });

  it("enables the deployed production configuration", () => {
    const options = sentryOptions({
      SENTRY_DSN: "https://public@example.invalid/1",
      SENTRY_ENVIRONMENT: "production",
    });
    expect(options.enabled).toBe(true);
    expect(options.environment).toBe("production");
  });

  it("drops loopback events as defense in depth", async () => {
    const options = sentryOptions({
      SENTRY_DSN: "https://public@example.invalid/1",
      SENTRY_ENVIRONMENT: "production",
    });
    const event = {
      request: { url: "http://127.0.0.1:8787/recent" },
    } as ErrorEvent;
    expect(
      await options.beforeSend?.(event, {} as EventHint)
    ).toBeNull();
  });
});
