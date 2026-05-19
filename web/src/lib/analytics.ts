import { getLocalProfileId } from "./localHistory";

export type ClientAnalyticsEventName =
  | "page_view"
  | "create_room_clicked"
  | "practice_started"
  | "practice_completed"
  | "room_opened"
  | "room_result_viewed"
  | "invite_copied"
  | "invite_shared";

interface AnalyticsEvent {
  event: ClientAnalyticsEventName;
  createdAt: number;
  browserId: string;
  sessionId: string;
  path: string;
  roomId?: string;
  referrer?: string;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
  };
  screen?: {
    width: number;
    height: number;
  };
  metadata?: Record<string, string | number | boolean>;
}

const WORKER_URL =
  import.meta.env.VITE_WORKER_URL ?? "http://localhost:8787";
const SESSION_KEY = "typing-race.analytics-session.v1";
const FLUSH_DELAY_MS = 800;
const MAX_BATCH_SIZE = 10;

let memorySessionId: string | null = null;
let queue: AnalyticsEvent[] = [];
let flushTimer: number | null = null;
let listenersBound = false;

export function getAnalyticsIdentity(): {
  browserId: string;
  sessionId: string;
} {
  return {
    browserId: getLocalProfileId(),
    sessionId: getSessionId(),
  };
}

export function analyticsSearchParams(): URLSearchParams {
  const identity = getAnalyticsIdentity();
  return new URLSearchParams({
    bid: identity.browserId,
    sid: identity.sessionId,
  });
}

export function trackEvent(
  event: ClientAnalyticsEventName,
  options: {
    path?: string;
    roomId?: string;
    metadata?: Record<string, string | number | boolean>;
  } = {}
): void {
  if (typeof window === "undefined") return;
  bindLifecycleListeners();

  const identity = getAnalyticsIdentity();
  queue.push({
    event,
    createdAt: Date.now(),
    browserId: identity.browserId,
    sessionId: identity.sessionId,
    path: options.path ?? window.location.pathname,
    roomId: options.roomId,
    referrer: document.referrer || undefined,
    utm: currentUtm(),
    screen: {
      width: window.screen.width,
      height: window.screen.height,
    },
    metadata: options.metadata,
  });

  if (queue.length >= MAX_BATCH_SIZE) {
    flushEvents();
    return;
  }

  if (flushTimer === null) {
    flushTimer = window.setTimeout(() => flushEvents(), FLUSH_DELAY_MS);
  }
}

export function flushEvents(useBeacon = false): void {
  if (typeof window === "undefined" || queue.length === 0) return;
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }

  const events = queue.slice(0, MAX_BATCH_SIZE);
  queue = queue.slice(MAX_BATCH_SIZE);
  const body = JSON.stringify({ events });

  if (useBeacon && navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(`${WORKER_URL}/events`, blob);
  } else {
    fetch(`${WORKER_URL}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Analytics must never interrupt typing/racing UX.
    });
  }

  if (queue.length > 0) {
    flushTimer = window.setTimeout(() => flushEvents(), FLUSH_DELAY_MS);
  }
}

function getSessionId(): string {
  if (memorySessionId) return memorySessionId;

  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) {
      memorySessionId = existing;
      return existing;
    }
  } catch {
    // sessionStorage unavailable, fall back to memory.
  }

  const id = `session-${randomId()}`;
  memorySessionId = id;
  try {
    window.sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    // memory-only session id is enough when storage is blocked.
  }
  return id;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function currentUtm(): AnalyticsEvent["utm"] {
  const params = new URLSearchParams(window.location.search);
  const source = params.get("utm_source") ?? undefined;
  const medium = params.get("utm_medium") ?? undefined;
  const campaign = params.get("utm_campaign") ?? undefined;
  return source || medium || campaign
    ? { source, medium, campaign }
    : undefined;
}

function bindLifecycleListeners() {
  if (listenersBound || typeof window === "undefined") return;
  listenersBound = true;
  window.addEventListener("pagehide", () => flushEvents(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushEvents(true);
  });
}
