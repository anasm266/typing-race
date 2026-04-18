import { DurableObject } from "cloudflare:workers";
import type {
  ClientMsg,
  PassageInfo,
  PublicRoomState,
  RoomConfig,
  ServerMsg,
} from "./protocol";

interface Env {
  ROOM: DurableObjectNamespace<Room>;
}

interface Attachment {
  role: "host" | "guest";
  joinedAt: number;
}

export class Room extends DurableObject<Env> {
  private roomState: PublicRoomState | null = null;
  private ready = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.roomState =
        (await ctx.storage.get<PublicRoomState>("state")) ?? null;
      this.ready = true;
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.ready) {
      await this.ctx.blockConcurrencyWhile(async () => {});
    }

    const url = new URL(request.url);

    if (url.pathname === "/__init" && request.method === "POST") {
      return this.handleInit(request);
    }

    if (url.pathname === "/__ws") {
      return this.handleUpgrade(request);
    }

    return new Response("not found", { status: 404 });
  }

  private async handleInit(request: Request): Promise<Response> {
    if (this.roomState) {
      return new Response("already initialized", { status: 409 });
    }
    const body = await request.json<{
      roomId: string;
      passage: PassageInfo;
      config: RoomConfig;
    }>();

    this.roomState = {
      roomId: body.roomId,
      passage: body.passage,
      config: body.config,
      status: "waiting",
      playerCount: 0,
      createdAt: Date.now(),
    };
    await this.ctx.storage.put("state", this.roomState);
    return Response.json({ ok: true });
  }

  private async handleUpgrade(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Always upgrade first so the client can distinguish specific errors
    // via the in-band {t:"error"} message + close code, rather than getting
    // a generic 1006 on a failed HTTP upgrade.
    if (!this.roomState) {
      server.accept();
      this.safeSend(server, {
        t: "error",
        code: "room_not_found",
        message: "room not found or expired",
      });
      server.close(4004, "room_not_found");
      return new Response(null, { status: 101, webSocket: client });
    }

    const existing = this.ctx.getWebSockets();
    console.log(
      `[room ${this.roomState.roomId}] upgrade: existing=${existing.length}`
    );

    if (existing.length >= 2) {
      server.accept();
      this.safeSend(server, {
        t: "error",
        code: "room_full",
        message: "race already in progress",
      });
      server.close(4009, "room_full");
      return new Response(null, { status: 101, webSocket: client });
    }

    const role: Attachment["role"] =
      existing.length === 0 ? "host" : "guest";
    server.serializeAttachment({
      role,
      joinedAt: Date.now(),
    } satisfies Attachment);

    this.ctx.acceptWebSocket(server);

    const newCount = existing.length + 1;
    this.roomState = {
      ...this.roomState,
      playerCount: newCount,
      status: newCount === 2 ? "ready" : "waiting",
    };
    await this.ctx.storage.put("state", this.roomState);

    this.safeSend(server, { t: "state", room: this.roomState });

    for (const other of existing) {
      this.safeSend(other, {
        t: "peer_joined",
        playerCount: newCount,
      });
      this.safeSend(other, { t: "state", room: this.roomState });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    if (typeof message !== "string") return;

    let msg: ClientMsg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    switch (msg.t) {
      case "ping":
        this.safeSend(ws, { t: "pong" });
        return;
      case "hello":
        if (this.roomState) {
          this.safeSend(ws, { t: "state", room: this.roomState });
        }
        return;
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): Promise<void> {
    console.log(
      `[room ${this.roomState?.roomId}] close: code=${code} reason=${reason} clean=${wasClean}`
    );
    try {
      ws.close();
    } catch {
      // already closed
    }
    await this.handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.log(
      `[room ${this.roomState?.roomId}] ws error: ${String(error)}`
    );
    await this.handleDisconnect(ws);
  }

  private async handleDisconnect(closing: WebSocket): Promise<void> {
    if (!this.roomState) return;
    const all = this.ctx.getWebSockets();
    const remaining = all.filter((s) => s !== closing).length;
    console.log(
      `[room ${this.roomState.roomId}] disconnect: all=${all.length} remaining=${remaining}`
    );
    this.roomState = {
      ...this.roomState,
      playerCount: remaining,
      status: remaining < 2 ? "waiting" : this.roomState.status,
    };
    await this.ctx.storage.put("state", this.roomState);

    for (const other of all) {
      if (other === closing) continue;
      this.safeSend(other, {
        t: "peer_left",
        playerCount: remaining,
      });
      this.safeSend(other, { t: "state", room: this.roomState });
    }
  }

  private safeSend(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket closed or closing — ignore
    }
  }
}
