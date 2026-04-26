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
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function mergeConfig(partial?: Partial<RoomConfig>): RoomConfig {
  return { ...DEFAULT_CONFIG, ...partial };
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
}

interface AnalyticsDailyRow {
  day: string;
  rooms_created: number;
  rooms_joined: number;
  races_started: number;
  races_completed: number;
  pre_start_drops: number;
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
      return handleCreateRoom(request, env);
    }

    if (url.pathname === "/recent" && request.method === "GET") {
      return handleRecent(env);
    }

    if (url.pathname === "/analytics" && request.method === "GET") {
      return handleAnalytics(env);
    }

    const wsMatch = url.pathname.match(
      /^\/room\/([a-zA-Z0-9-]+)\/ws$/
    );
    if (wsMatch) {
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

    return json({ races: rs.results ?? [] });
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
         SUM(pre_start_drop_count) AS pre_start_drops
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
         SUM(pre_start_drop_count) AS pre_start_drops
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
      },
      daily: (daily.results ?? []).map((row) => ({
        day: row.day,
        roomsCreated: row.rooms_created ?? 0,
        roomsJoined: row.rooms_joined ?? 0,
        racesStarted: row.races_started ?? 0,
        racesCompleted: row.races_completed ?? 0,
        preStartDrops: row.pre_start_drops ?? 0,
      })),
    });
  } catch (err) {
    Sentry.captureException(err);
    return json({ error: "db_error" }, 500);
  }
}
