import * as Sentry from "@sentry/cloudflare";
import { Room as RoomClass } from "./room";
import { pickPassage } from "./passages";
import {
  DEFAULT_CONFIG,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type RoomSource,
  type RoomConfig,
} from "./protocol";
import {
  analyticsContextFromRequest,
  cleanAnalyticsMetadata,
  insertAnalyticsEvent,
  isClientAnalyticsEventName,
  maybeCleanupAnalyticsEvents,
  referrerHostFromValue,
  safeInsertAnalyticsEvent,
  type AnalyticsStoredEvent,
} from "./analytics";

export const Room = Sentry.instrumentDurableObjectWithSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    environment: "production",
  }),
  RoomClass
);

export interface Env {
  ROOM: DurableObjectNamespace<RoomClass>;
  DB: D1Database;
  SENTRY_DSN: string;
  ADMIN_ANALYTICS_TOKEN?: string;
  ANALYTICS_IP_HASH_SALT?: string;
  ROOM_CREATE_RATE_LIMITER: RateLimit;
  WS_JOIN_RATE_LIMITER: RateLimit;
  EVENT_RATE_LIMITER: RateLimit;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
} as const;

function json(
  data: unknown,
  status = 200,
  headers: HeadersInit = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...headers,
    },
  });
}

function mergeConfig(partial?: Partial<RoomConfig>): RoomConfig {
  const passageLength =
    partial?.passageLength === "word" ||
    partial?.passageLength === "short" ||
    partial?.passageLength === "medium" ||
    partial?.passageLength === "long"
      ? partial.passageLength
      : DEFAULT_CONFIG.passageLength;
  const endMode =
    passageLength === "word"
      ? "finish"
      : partial?.endMode === "time" || partial?.endMode === "finish"
        ? partial.endMode
        : DEFAULT_CONFIG.endMode;
  const timeLimit =
    partial?.timeLimit === 30 ||
    partial?.timeLimit === 60 ||
    partial?.timeLimit === 90
      ? partial.timeLimit
      : DEFAULT_CONFIG.timeLimit;

  return { endMode, passageLength, timeLimit };
}

function normalizeSource(source: unknown): RoomSource {
  return source === "load_test" ? "load_test" : "user";
}

interface RecentRaceRow {
  id: string;
  finished_at: number;
  end_reason: string;
  outcome: string;
  passage_id: string;
  passage_length: string;
  passage_words: number;
  duration_ms: number;
  host_wpm: number;
  guest_wpm: number;
  host_accuracy: number;
  guest_accuracy: number;
  host_finished: number;
  guest_finished: number;
}

interface AnalyticsSummaryRow {
  rooms_created: number;
  rooms_joined: number;
  races_started: number;
  races_completed: number;
  races_disconnected: number;
  pre_start_drops: number;
  spectator_join_count: number;
  spectator_leave_count: number;
  spectator_max_concurrent: number;
  rooms_watched: number;
  spectator_watch_ms_total: number;
}

function clientKey(request: Request, scope: string): string {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return `${scope}:${ip}`;
}

function tooManyRequests(scope: string): Response {
  return json(
    {
      error: "rate_limited",
      message:
        scope === "room"
          ? "too many rooms created from this connection"
          : scope === "events"
            ? "too many analytics events from this connection"
            : "too many room connections from this connection",
    },
    429
  );
}

async function isLimited(
  limiter: RateLimit,
  request: Request,
  scope: string
): Promise<boolean> {
  const { success } = await limiter.limit({
    key: clientKey(request, scope),
  });
  return !success;
}

interface AnalyticsDailyRow {
  day: string;
  rooms_created: number;
  rooms_joined: number;
  races_started: number;
  races_completed: number;
  pre_start_drops: number;
  spectator_join_count: number;
  spectator_leave_count: number;
  spectator_max_concurrent: number;
  rooms_watched: number;
  spectator_watch_ms_total: number;
}

interface ClientAnalyticsEvent {
  event?: unknown;
  createdAt?: unknown;
  browserId?: unknown;
  sessionId?: unknown;
  path?: unknown;
  roomId?: unknown;
  referrer?: unknown;
  utm?: {
    source?: unknown;
    medium?: unknown;
    campaign?: unknown;
  };
  screen?: {
    width?: unknown;
    height?: unknown;
  };
  metadata?: unknown;
}

interface AdminSummaryRow {
  visitors: number;
  sessions: number;
  page_views: number;
  rooms_created: number;
  players_joined: number;
  spectators_joined: number;
  races_started: number;
  races_completed: number;
}

interface AdminSeriesRow {
  bucket: string;
  events: number;
  visitors: number;
  page_views: number;
  rooms_created: number;
  races_started: number;
  races_completed: number;
}

interface AdminGroupRow {
  label: string | null;
  count: number;
}

const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        status: "ok",
        service: "typing-race-api",
        milestone: "M7",
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === "/room" && request.method === "POST") {
      if (
        await isLimited(env.ROOM_CREATE_RATE_LIMITER, request, "room")
      ) {
        return tooManyRequests("room");
      }
      return handleCreateRoom(request, env);
    }

    if (url.pathname === "/events" && request.method === "POST") {
      if (await isLimited(env.EVENT_RATE_LIMITER, request, "events")) {
        return tooManyRequests("events");
      }
      return handleClientEvents(request, env);
    }

    if (url.pathname === "/recent" && request.method === "GET") {
      return handleRecent(env);
    }

    if (url.pathname === "/analytics" && request.method === "GET") {
      return handleAnalytics(env);
    }

    if (url.pathname === "/admin/analytics" && request.method === "GET") {
      return handleAdminAnalytics(request, env);
    }

    const wsMatch = url.pathname.match(
      /^\/room\/([a-zA-Z0-9-]+)\/ws$/
    );
    if (wsMatch) {
      if (await isLimited(env.WS_JOIN_RATE_LIMITER, request, "ws")) {
        return tooManyRequests("ws");
      }
      return handleWsUpgrade(request, env, wsMatch[1]);
    }

    return json({ error: "not_found", path: url.pathname }, 404);
  },
} satisfies ExportedHandler<Env>;

export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    environment: "production",
  }),
  handler
);

async function handleCreateRoom(
  request: Request,
  env: Env
): Promise<Response> {
  let body: CreateRoomRequest = {};
  try {
    body = (await request.json()) as CreateRoomRequest;
  } catch {
    // empty body OK
  }

  const config = mergeConfig(body.config);
  const source = normalizeSource(body.source);
  const roomId = crypto.randomUUID();
  const passage = pickPassage(config.passageLength);

  const doId = env.ROOM.idFromName(roomId);
  const stub = env.ROOM.get(doId);

  const initResponse = await stub.fetch("https://do/__init", {
    method: "POST",
    body: JSON.stringify({ roomId, passage, config, source }),
    headers: { "Content-Type": "application/json" },
  });

  if (!initResponse.ok) {
    return json(
      { error: "init_failed", status: initResponse.status },
      500
    );
  }

  const analyticsContext = await analyticsContextFromRequest(env, request, {
    browserId: body.analytics?.browserId,
    sessionId: body.analytics?.sessionId,
    path: "/room",
    source,
  });
  await safeInsertAnalyticsEvent(env, analyticsContext, {
    eventName: "room_created",
    roomId,
    metadata: {
      endMode: config.endMode,
      passageLength: config.passageLength,
      timeLimit: config.timeLimit,
    },
  });

  const response: CreateRoomResponse = { roomId };
  return json(response);
}

async function handleWsUpgrade(
  request: Request,
  env: Env,
  roomId: string
): Promise<Response> {
  const doId = env.ROOM.idFromName(roomId);
  const stub = env.ROOM.get(doId);

  const internalUrl = new URL(request.url);
  internalUrl.pathname = "/__ws";

  return stub.fetch(new Request(internalUrl, request));
}

async function handleClientEvents(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    await maybeCleanupAnalyticsEvents(env);

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 20_000) {
      return json({ error: "payload_too_large" }, 413);
    }

    const text = await request.text();
    if (text.length > 20_000) {
      return json({ error: "payload_too_large" }, 413);
    }

    const payload = JSON.parse(text) as { events?: ClientAnalyticsEvent[] };
    if (!Array.isArray(payload.events)) {
      return json({ error: "invalid_events" }, 400);
    }
    if (payload.events.length > 10) {
      return json({ error: "too_many_events" }, 413);
    }

    let accepted = 0;
    let ignored = 0;
    for (const event of payload.events) {
      if (!isClientAnalyticsEventName(event.event)) {
        ignored += 1;
        continue;
      }

      const context = await analyticsContextFromRequest(env, request, {
        browserId: stringValue(event.browserId),
        sessionId: stringValue(event.sessionId),
        path: stringValue(event.path),
        referrerHost: referrerHostFromValue(
          stringValue(event.referrer) ?? null
        ),
        utmSource: stringValue(event.utm?.source),
        utmMedium: stringValue(event.utm?.medium),
        utmCampaign: stringValue(event.utm?.campaign),
        screenWidth: numberValue(event.screen?.width),
        screenHeight: numberValue(event.screen?.height),
        source: "user",
      });

      await insertAnalyticsEvent(env, context, {
        eventName: event.event,
        eventAt: numberValue(event.createdAt),
        roomId: stringValue(event.roomId),
        metadata: cleanAnalyticsMetadata(event.metadata),
      });
      accepted += 1;
    }

    return json({ ok: true, accepted, ignored });
  } catch (err) {
    Sentry.captureException(err);
    return json({ error: "invalid_events" }, 400);
  }
}

async function handleRecent(env: Env): Promise<Response> {
  try {
    const rs = await env.DB.prepare(
      `SELECT id, finished_at, end_reason, outcome,
              passage_id, passage_length, passage_words,
              duration_ms,
              host_wpm, guest_wpm,
              host_accuracy, guest_accuracy,
              host_finished, guest_finished
         FROM races
        ORDER BY finished_at DESC
        LIMIT 20`
    ).all<RecentRaceRow>();

    return json(
      { races: rs.results ?? [] },
      200,
      { "Cache-Control": "no-store" }
    );
  } catch (err) {
    Sentry.captureException(err);
    return json({ error: "db_error" }, 500);
  }
}

async function handleAdminAnalytics(
  request: Request,
  env: Env
): Promise<Response> {
  if (!env.ADMIN_ANALYTICS_TOKEN) {
    return json({ error: "admin_not_configured" }, 503);
  }

  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${env.ADMIN_ANALYTICS_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    await maybeCleanupAnalyticsEvents(env);

    const url = new URL(request.url);
    const range = normalizeRange(url.searchParams.get("range"));
    const cutoff = Date.now() - rangeToMs(range);
    const bucketExpr =
      range === "24h"
        ? "strftime('%Y-%m-%dT%H:00:00Z', event_at / 1000, 'unixepoch')"
        : "date(event_at / 1000, 'unixepoch')";

    const summary = await env.DB.prepare(
      `SELECT
         COUNT(DISTINCT browser_id) AS visitors,
         COUNT(DISTINCT session_id) AS sessions,
         COUNT(CASE WHEN event_name = 'page_view' THEN 1 END) AS page_views,
         COUNT(CASE WHEN event_name = 'room_created' THEN 1 END) AS rooms_created,
         COUNT(CASE WHEN event_name = 'player_joined' THEN 1 END) AS players_joined,
         COUNT(CASE WHEN event_name = 'spectator_joined' THEN 1 END) AS spectators_joined,
         COUNT(CASE WHEN event_name = 'race_started' THEN 1 END) AS races_started,
         COUNT(CASE WHEN event_name = 'race_ended' THEN 1 END) AS races_completed
       FROM analytics_events
       WHERE source = 'user' AND event_at >= ?`
    )
      .bind(cutoff)
      .first<AdminSummaryRow>();

    const series = await env.DB.prepare(
      `SELECT
         ${bucketExpr} AS bucket,
         COUNT(*) AS events,
         COUNT(DISTINCT browser_id) AS visitors,
         COUNT(CASE WHEN event_name = 'page_view' THEN 1 END) AS page_views,
         COUNT(CASE WHEN event_name = 'room_created' THEN 1 END) AS rooms_created,
         COUNT(CASE WHEN event_name = 'race_started' THEN 1 END) AS races_started,
         COUNT(CASE WHEN event_name = 'race_ended' THEN 1 END) AS races_completed
       FROM analytics_events
       WHERE source = 'user' AND event_at >= ?
       GROUP BY bucket
       ORDER BY bucket ASC`
    )
      .bind(cutoff)
      .all<AdminSeriesRow>();

    const [
      topReferrers,
      topCountries,
      topPages,
      devices,
      browsers,
      recentEvents,
    ] = await Promise.all([
      topGroups(env, "referrer_host", cutoff, "direct"),
      topGroups(env, "country", cutoff, "unknown"),
      topGroups(env, "path", cutoff, "unknown"),
      topGroups(env, "device", cutoff, "unknown"),
      topGroups(env, "browser", cutoff, "unknown"),
      env.DB.prepare(
        `SELECT id, event_at, event_name, browser_id, session_id, room_id,
                participant_kind, player_role, path, referrer_host,
                country, region, city, browser, os, device, source,
                metadata_json
           FROM analytics_events
          WHERE source = 'user' AND event_at >= ?
          ORDER BY event_at DESC
          LIMIT 50`
      )
        .bind(cutoff)
        .all<AnalyticsStoredEvent>(),
    ]);

    const safeSummary = {
      visitors: summary?.visitors ?? 0,
      sessions: summary?.sessions ?? 0,
      pageViews: summary?.page_views ?? 0,
      roomsCreated: summary?.rooms_created ?? 0,
      playersJoined: summary?.players_joined ?? 0,
      spectatorsJoined: summary?.spectators_joined ?? 0,
      racesStarted: summary?.races_started ?? 0,
      racesCompleted: summary?.races_completed ?? 0,
    };

    return json(
      {
        range,
        summary: {
          ...safeSummary,
          completionRate: percentage(
            safeSummary.racesCompleted,
            safeSummary.racesStarted
          ),
        },
        funnel: {
          pageViews: safeSummary.pageViews,
          roomsCreated: safeSummary.roomsCreated,
          playersJoined: safeSummary.playersJoined,
          racesStarted: safeSummary.racesStarted,
          racesCompleted: safeSummary.racesCompleted,
          visitToCreateRate: percentage(
            safeSummary.roomsCreated,
            safeSummary.pageViews
          ),
          playerJoinRate: percentage(
            safeSummary.playersJoined,
            safeSummary.roomsCreated
          ),
          startRate: percentage(
            safeSummary.racesStarted,
            safeSummary.roomsCreated
          ),
          completionRate: percentage(
            safeSummary.racesCompleted,
            safeSummary.racesStarted
          ),
        },
        series: (series.results ?? []).map((row) => ({
          bucket: row.bucket,
          events: row.events ?? 0,
          visitors: row.visitors ?? 0,
          pageViews: row.page_views ?? 0,
          roomsCreated: row.rooms_created ?? 0,
          racesStarted: row.races_started ?? 0,
          racesCompleted: row.races_completed ?? 0,
        })),
        topReferrers,
        topCountries,
        topPages,
        devices,
        browsers,
        recentEvents: (recentEvents.results ?? []).map((event) => ({
          id: event.id,
          eventAt: event.event_at,
          eventName: event.event_name,
          browserId: event.browser_id,
          sessionId: event.session_id,
          roomId: event.room_id,
          participantKind: event.participant_kind,
          playerRole: event.player_role,
          path: event.path,
          referrerHost: event.referrer_host,
          country: event.country,
          region: event.region,
          city: event.city,
          browser: event.browser,
          os: event.os,
          device: event.device,
          source: event.source,
          metadata: parseMetadata(event.metadata_json),
        })),
      },
      200,
      { "Cache-Control": "no-store" }
    );
  } catch (err) {
    Sentry.captureException(err);
    return json({ error: "db_error" }, 500);
  }
}

async function handleAnalytics(env: Env): Promise<Response> {
  try {
    const summary = await env.DB.prepare(
      `SELECT
         COUNT(*) AS rooms_created,
         SUM(CASE WHEN guest_joined_at IS NOT NULL THEN 1 ELSE 0 END) AS rooms_joined,
         SUM(CASE WHEN race_started_at IS NOT NULL THEN 1 ELSE 0 END) AS races_started,
         SUM(CASE WHEN completed_successfully = 1 THEN 1 ELSE 0 END) AS races_completed,
         SUM(CASE WHEN race_end_reason = 'disconnect' THEN 1 ELSE 0 END) AS races_disconnected,
         SUM(pre_start_drop_count) AS pre_start_drops,
         SUM(spectator_join_count) AS spectator_join_count,
         SUM(spectator_leave_count) AS spectator_leave_count,
         MAX(spectator_max_concurrent) AS spectator_max_concurrent,
         SUM(CASE WHEN spectator_join_count > 0 THEN 1 ELSE 0 END) AS rooms_watched,
         SUM(spectator_watch_ms_total) AS spectator_watch_ms_total
       FROM room_analytics
       WHERE source = 'user'`
    ).first<AnalyticsSummaryRow>();

    const daily = await env.DB.prepare(
      `SELECT
         date(created_at / 1000, 'unixepoch') AS day,
         COUNT(*) AS rooms_created,
         SUM(CASE WHEN guest_joined_at IS NOT NULL THEN 1 ELSE 0 END) AS rooms_joined,
         SUM(CASE WHEN race_started_at IS NOT NULL THEN 1 ELSE 0 END) AS races_started,
         SUM(CASE WHEN completed_successfully = 1 THEN 1 ELSE 0 END) AS races_completed,
         SUM(pre_start_drop_count) AS pre_start_drops,
         SUM(spectator_join_count) AS spectator_join_count,
         SUM(spectator_leave_count) AS spectator_leave_count,
         MAX(spectator_max_concurrent) AS spectator_max_concurrent,
         SUM(CASE WHEN spectator_join_count > 0 THEN 1 ELSE 0 END) AS rooms_watched,
         SUM(spectator_watch_ms_total) AS spectator_watch_ms_total
       FROM room_analytics
       WHERE source = 'user' AND created_at >= ?
       GROUP BY date(created_at / 1000, 'unixepoch')
       ORDER BY day DESC
       LIMIT 14`
    )
      .bind(Date.now() - 14 * 24 * 60 * 60 * 1000)
      .all<AnalyticsDailyRow>();

    return json({
      summary: {
        roomsCreated: summary?.rooms_created ?? 0,
        roomsJoined: summary?.rooms_joined ?? 0,
        racesStarted: summary?.races_started ?? 0,
        racesCompleted: summary?.races_completed ?? 0,
        racesDisconnected: summary?.races_disconnected ?? 0,
        preStartDrops: summary?.pre_start_drops ?? 0,
        spectatorJoins: summary?.spectator_join_count ?? 0,
        spectatorLeaves: summary?.spectator_leave_count ?? 0,
        spectatorMaxConcurrent: summary?.spectator_max_concurrent ?? 0,
        roomsWatched: summary?.rooms_watched ?? 0,
        spectatorWatchMsTotal: summary?.spectator_watch_ms_total ?? 0,
      },
      daily: (daily.results ?? []).map((row) => ({
        day: row.day,
        roomsCreated: row.rooms_created ?? 0,
        roomsJoined: row.rooms_joined ?? 0,
        racesStarted: row.races_started ?? 0,
        racesCompleted: row.races_completed ?? 0,
        preStartDrops: row.pre_start_drops ?? 0,
        spectatorJoins: row.spectator_join_count ?? 0,
        spectatorLeaves: row.spectator_leave_count ?? 0,
        spectatorMaxConcurrent: row.spectator_max_concurrent ?? 0,
        roomsWatched: row.rooms_watched ?? 0,
        spectatorWatchMsTotal: row.spectator_watch_ms_total ?? 0,
      })),
    });
  } catch (err) {
    Sentry.captureException(err);
    return json({ error: "db_error" }, 500);
  }
}

async function topGroups(
  env: Env,
  column:
    | "referrer_host"
    | "country"
    | "path"
    | "device"
    | "browser",
  cutoff: number,
  fallback: string
): Promise<Array<{ label: string; count: number }>> {
  const rs = await env.DB.prepare(
    `SELECT COALESCE(${column}, ?) AS label, COUNT(*) AS count
       FROM analytics_events
      WHERE source = 'user' AND event_at >= ?
      GROUP BY label
      ORDER BY count DESC
      LIMIT 10`
  )
    .bind(fallback, cutoff)
    .all<AdminGroupRow>();

  return (rs.results ?? []).map((row) => ({
    label: row.label ?? fallback,
    count: row.count ?? 0,
  }));
}

function normalizeRange(value: string | null): "24h" | "7d" | "30d" {
  if (value === "24h" || value === "30d") return value;
  return "7d";
}

function rangeToMs(range: "24h" | "7d" | "30d"): number {
  switch (range) {
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "30d":
      return 30 * 24 * 60 * 60 * 1000;
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
  }
}

function percentage(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
