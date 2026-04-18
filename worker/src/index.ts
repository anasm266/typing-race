import { Room } from "./room";
import { pickPassage } from "./passages";
import {
  DEFAULT_CONFIG,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type RoomConfig,
} from "./protocol";

export { Room };

interface Env {
  ROOM: DurableObjectNamespace<Room>;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        status: "ok",
        service: "typing-race-api",
        milestone: "M2",
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === "/room" && request.method === "POST") {
      return handleCreateRoom(request, env);
    }

    const wsMatch = url.pathname.match(/^\/room\/([a-zA-Z0-9-]+)\/ws$/);
    if (wsMatch) {
      return handleWsUpgrade(request, env, wsMatch[1]);
    }

    return json({ error: "not_found", path: url.pathname }, 404);
  },
} satisfies ExportedHandler<Env>;

async function handleCreateRoom(
  request: Request,
  env: Env
): Promise<Response> {
  let body: CreateRoomRequest = {};
  try {
    body = (await request.json()) as CreateRoomRequest;
  } catch {
    // empty body is fine — use defaults
  }

  const config = mergeConfig(body.config);
  const roomId = crypto.randomUUID();
  const passage = pickPassage(config.passageLength);

  const doId = env.ROOM.idFromName(roomId);
  const stub = env.ROOM.get(doId);

  const initResponse = await stub.fetch("https://do/__init", {
    method: "POST",
    body: JSON.stringify({ roomId, passage, config }),
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
