interface SentryEnv {
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
}

function isLoopbackUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

/**
 * Sentry is intentionally production-only. In particular, a repository clone
 * running `wrangler dev` must not be able to report into the production
 * project merely by executing the checked-in configuration.
 */
export function sentryOptions(env: SentryEnv): CloudflareOptions {
  const environment = env.SENTRY_ENVIRONMENT ?? "development";
  const enabled = environment === "production" && Boolean(env.SENTRY_DSN);

  return {
    dsn: enabled ? env.SENTRY_DSN : undefined,
    enabled,
    environment,
    tracesSampleRate: enabled ? 0.1 : 0,
    sendDefaultPii: false,
    beforeSend(event) {
      return isLoopbackUrl(event.request?.url) ? null : event;
    },
  };
}
import type { CloudflareOptions } from "@sentry/cloudflare";
