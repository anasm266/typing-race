import type { ParticipantKind, RoomSource } from "./protocol";

export interface AnalyticsEnv {
  DB: D1Database;
  ANALYTICS_IP_HASH_SALT?: string;
}

export type AnalyticsEventName =
  | "page_view"
  | "create_room_clicked"
  | "practice_started"
  | "practice_completed"
  | "room_opened"
  | "room_result_viewed"
  | "invite_copied"
  | "invite_shared"
  | "room_created"
  | "player_joined"
  | "spectator_joined"
  | "player_left"
  | "spectator_left"
  | "race_started"
  | "race_ended";

export interface AnalyticsContext {
  browserId?: string | null;
  sessionId?: string | null;
  path?: string | null;
  referrerHost?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  timezone?: string | null;
  colo?: string | null;
  browser?: string | null;
  os?: string | null;
  device?: string | null;
  screenWidth?: number | null;
  screenHeight?: number | null;
  ipHash?: string | null;
  source?: RoomSource | null;
}

export interface AnalyticsEventInput {
  eventName: AnalyticsEventName;
  eventAt?: number;
  roomId?: string | null;
  participantKind?: ParticipantKind | null;
  /** Seat label: "host" (seat 0), "guest" (seat 1), or "seat_N". */
  playerRole?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AnalyticsStoredEvent {
  id: string;
  event_at: number;
  event_name: string;
  browser_id: string | null;
  session_id: string | null;
  room_id: string | null;
  participant_kind: string | null;
  player_role: string | null;
  path: string | null;
  referrer_host: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  source: string;
  metadata_json: string | null;
}

const CLIENT_EVENT_NAMES = new Set<AnalyticsEventName>([
  "page_view",
  "create_room_clicked",
  "practice_started",
  "practice_completed",
  "room_opened",
  "room_result_viewed",
  "invite_copied",
  "invite_shared",
]);

const METADATA_MAX_BYTES = 1200;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function isClientAnalyticsEventName(
  value: unknown
): value is AnalyticsEventName {
  return typeof value === "string" && CLIENT_EVENT_NAMES.has(value as AnalyticsEventName);
}

export async function analyticsContextFromRequest(
  env: AnalyticsEnv,
  request: Request,
  overrides: Partial<AnalyticsContext> = {}
): Promise<AnalyticsContext> {
  const url = new URL(request.url);
  const userAgent = request.headers.get("user-agent") ?? "";
  const parsedUa = parseUserAgent(userAgent);
  const cf = request.cf;
  const referrer =
    overrides.referrerHost ??
    referrerHostFromValue(request.headers.get("referer"));

  return {
    browserId: cleanId(overrides.browserId ?? url.searchParams.get("bid")),
    sessionId: cleanId(overrides.sessionId ?? url.searchParams.get("sid")),
    path: cleanPath(overrides.path ?? url.pathname),
    referrerHost: cleanText(referrer, 120),
    utmSource: cleanText(overrides.utmSource ?? url.searchParams.get("utm_source"), 80),
    utmMedium: cleanText(overrides.utmMedium ?? url.searchParams.get("utm_medium"), 80),
    utmCampaign: cleanText(
      overrides.utmCampaign ?? url.searchParams.get("utm_campaign"),
      120
    ),
    country: cleanText(overrides.country ?? cfString(cf?.country), 8),
    region: cleanText(overrides.region ?? cfString(cf?.region), 120),
    city: cleanText(overrides.city ?? cfString(cf?.city), 120),
    timezone: cleanText(overrides.timezone ?? cfString(cf?.timezone), 120),
    colo: cleanText(overrides.colo ?? cfString(cf?.colo), 16),
    browser: cleanText(overrides.browser ?? parsedUa.browser, 40),
    os: cleanText(overrides.os ?? parsedUa.os, 40),
    device: cleanText(overrides.device ?? parsedUa.device, 20),
    screenWidth: cleanInt(overrides.screenWidth, 10_000),
    screenHeight: cleanInt(overrides.screenHeight, 10_000),
    ipHash: cleanText(
      overrides.ipHash ?? (await ipHashFromRequest(env, request)),
      96
    ),
    source: overrides.source === "load_test" ? "load_test" : "user",
  };
}

export async function insertAnalyticsEvent(
  env: AnalyticsEnv,
  context: AnalyticsContext,
  event: AnalyticsEventInput
): Promise<void> {
  const eventAt = cleanTimestamp(event.eventAt) ?? Date.now();
  const metadataJson = cleanMetadata(event.metadata);

  await env.DB.prepare(
    `INSERT INTO analytics_events (
       id, event_at, received_at, event_name,
       browser_id, session_id, room_id,
       participant_kind, player_role,
       path, referrer_host,
       utm_source, utm_medium, utm_campaign,
       country, region, city, timezone, colo,
       browser, os, device,
       screen_width, screen_height,
       source, metadata_json, ip_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      eventAt,
      Date.now(),
      event.eventName,
      cleanId(context.browserId),
      cleanId(context.sessionId),
      cleanText(event.roomId, 80),
      cleanParticipantKind(event.participantKind),
      cleanPlayerRole(event.playerRole),
      cleanPath(context.path),
      cleanText(context.referrerHost, 120),
      cleanText(context.utmSource, 80),
      cleanText(context.utmMedium, 80),
      cleanText(context.utmCampaign, 120),
      cleanText(context.country, 8),
      cleanText(context.region, 120),
      cleanText(context.city, 120),
      cleanText(context.timezone, 120),
      cleanText(context.colo, 16),
      cleanText(context.browser, 40),
      cleanText(context.os, 40),
      cleanText(context.device, 20),
      cleanInt(context.screenWidth, 10_000),
      cleanInt(context.screenHeight, 10_000),
      context.source === "load_test" ? "load_test" : "user",
      metadataJson,
      cleanText(context.ipHash, 96)
    )
    .run();
}

export async function safeInsertAnalyticsEvent(
  env: AnalyticsEnv,
  context: AnalyticsContext,
  event: AnalyticsEventInput
): Promise<void> {
  try {
    await insertAnalyticsEvent(env, context, event);
  } catch (error) {
    console.warn(`analytics insert failed: ${String(error)}`);
  }
}

export async function maybeCleanupAnalyticsEvents(
  env: AnalyticsEnv
): Promise<void> {
  try {
    const now = Date.now();
    const marker = await env.DB.prepare(
      `SELECT value_ms FROM analytics_housekeeping WHERE key = 'last_cleanup'`
    ).first<{ value_ms: number }>();

    if (marker && now - marker.value_ms < CLEANUP_INTERVAL_MS) return;

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM analytics_events WHERE event_at < ?`).bind(
        now - RETENTION_MS
      ),
      env.DB.prepare(
        `INSERT OR REPLACE INTO analytics_housekeeping (key, value_ms)
         VALUES ('last_cleanup', ?)`
      ).bind(now),
    ]);
  } catch (error) {
    console.warn(`analytics cleanup failed: ${String(error)}`);
  }
}

export function referrerHostFromValue(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host.slice(0, 120);
  } catch {
    return null;
  }
}

export function cleanAnalyticsMetadata(
  value: unknown
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    const cleanKey = cleanText(key, 40);
    if (!cleanKey) continue;
    if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean"
    ) {
      result[cleanKey] = raw;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function cleanMetadata(value: Record<string, unknown> | null | undefined): string | null {
  if (!value) return null;
  const json = JSON.stringify(cleanAnalyticsMetadata(value));
  if (json === "null" || json.length > METADATA_MAX_BYTES) return null;
  return json;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function cleanPath(value: unknown): string | null {
  const text = cleanText(value, 220);
  if (!text) return null;
  return text.startsWith("/") ? text : `/${text}`;
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(trimmed)) return null;
  return trimmed;
}

function cleanInt(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const int = Math.round(value);
  if (int < 0 || int > max) return null;
  return int;
}

function cleanTimestamp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const now = Date.now();
  if (value < now - 24 * 60 * 60 * 1000) return null;
  if (value > now + 5 * 60 * 1000) return null;
  return Math.round(value);
}

function cleanParticipantKind(value: unknown): ParticipantKind | null {
  return value === "player" || value === "spectator" ? value : null;
}

function cleanPlayerRole(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^(host|guest|seat_\d{1,2})$/.test(value) ? value : null;
}

function cfString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function ipHashFromRequest(
  env: AnalyticsEnv,
  request: Request
): Promise<string | null> {
  if (!env.ANALYTICS_IP_HASH_SALT) return null;
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!ip) return null;

  const encoded = new TextEncoder().encode(
    `${env.ANALYTICS_IP_HASH_SALT}:${ip}`
  );
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseUserAgent(userAgent: string): {
  browser: string;
  os: string;
  device: string;
} {
  const ua = userAgent.toLowerCase();
  const browser = ua.includes("edg/")
    ? "Edge"
    : ua.includes("opr/") || ua.includes("opera")
      ? "Opera"
      : ua.includes("firefox/")
        ? "Firefox"
        : ua.includes("chrome/") || ua.includes("crios/")
          ? "Chrome"
          : ua.includes("safari/")
            ? "Safari"
            : "Other";

  const os = ua.includes("windows")
    ? "Windows"
    : ua.includes("android")
      ? "Android"
      : ua.includes("iphone") || ua.includes("ipad")
        ? "iOS"
        : ua.includes("mac os") || ua.includes("macintosh")
          ? "macOS"
          : ua.includes("linux")
            ? "Linux"
            : "Other";

  const device = ua.includes("ipad") || ua.includes("tablet")
    ? "tablet"
    : ua.includes("mobi") || ua.includes("iphone") || ua.includes("android")
      ? "mobile"
      : "desktop";

  return { browser, os, device };
}
