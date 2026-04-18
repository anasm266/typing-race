import { DurableObject } from "cloudflare:workers";
import type {
  ClientMsg,
  PassageInfo,
  PublicRoomState,
  RoomConfig,
  ServerMsg,
} from "./protocol";
import { START_BUFFER_MS } from "./protocol";

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
    await this.persistState();
    return Response.json({ ok: true });
  }

  private async handleUpgrade(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

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
    };

    if (newCount === 2 && this.roomState.status === "waiting") {
      const startAt = Date.now() + START_BUFFER_MS;
      this.roomState = {
        ...this.roomState,
        status: "starting",
        startAt,
      };
      await this.ctx.storage.setAlarm(startAt);
    }

    await this.persistState();

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

  /** Fires when the pre-race buffer elapses: transition to racing. */
  async alarm(): Promise<void> {
    if (!this.roomState) return;
    if (this.roomState.status !== "starting") return;

    this.roomState = { ...this.roomState, status: "racing" };
    await this.persistState();
    this.broadcast({ t: "state", room: this.roomState });
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

      case "progress":
        if (this.roomState?.status !== "racing") return;
        this.broadcastExcept(ws, {
          t: "opponent_progress",
          pos: msg.pos,
          correctCount: msg.correctCount,
          wpm: msg.wpm,
        });
        return;

      case "finished":
        if (this.roomState?.status !== "racing") return;
        this.broadcastExcept(ws, {
          t: "opponent_finished",
          wpm: msg.wpm,
          accuracy: msg.accuracy,
          elapsedMs: msg.elapsedMs,
        });
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
    const remaining = this.ctx
      .getWebSockets()
      .filter((s) => s !== closing).length;

    const nextStatus: PublicRoomState["status"] =
      remaining < 2 && this.roomState.status === "starting"
        ? "waiting"
        : this.roomState.status;

    this.roomState = {
      ...this.roomState,
      playerCount: remaining,
      status: nextStatus,
      startAt: nextStatus === "waiting" ? undefined : this.roomState.startAt,
    };
    await this.persistState();

    for (const other of this.ctx.getWebSockets()) {
      if (other === closing) continue;
      this.safeSend(other, {
        t: "peer_left",
        playerCount: remaining,
      });
      this.safeSend(other, { t: "state", room: this.roomState });
    }
  }

  private broadcast(msg: ServerMsg): void {
    for (const ws of this.ctx.getWebSockets()) {
      this.safeSend(ws, msg);
    }
  }

  private broadcastExcept(except: WebSocket, msg: ServerMsg): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      this.safeSend(ws, msg);
    }
  }

  private async persistState(): Promise<void> {
    if (!this.roomState) return;
    await this.ctx.storage.put("state", this.roomState);
  }

  private safeSend(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket closed or closing — ignore
    }
  }
}
