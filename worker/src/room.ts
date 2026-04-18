import { DurableObject } from "cloudflare:workers";
import type {
  ClientMsg,
  EndReason,
  PassageInfo,
  PlayerResult,
  PlayerRole,
  PublicRoomState,
  RaceOutcome,
  RaceResult,
  RoomConfig,
  ServerMsg,
} from "./protocol";
import { START_BUFFER_MS } from "./protocol";

interface Env {
  ROOM: DurableObjectNamespace<Room>;
}

interface Attachment {
  role: PlayerRole;
  joinedAt: number;
}

interface PlayerProgress {
  pos: number;
  correctCount: number;
  wpm: number;
  accuracy: number;
  /** ms timestamp of last update (server clock). */
  at: number;
}

/**
 * Internal state persisted in DO storage.
 * Public fields are sent to clients; private (leading _) are server-only.
 */
interface InternalState extends PublicRoomState {
  _hostProgress?: PlayerProgress;
  _guestProgress?: PlayerProgress;
  /** ms timestamp the host sent their "finished" msg (whole passage typed). */
  _hostFinishedAt?: number;
  _guestFinishedAt?: number;
}

function toPublic(s: InternalState): PublicRoomState {
  const {
    _hostProgress,
    _guestProgress,
    _hostFinishedAt,
    _guestFinishedAt,
    ...pub
  } = s;
  return pub;
}

function zeroProgress(): PlayerProgress {
  return { pos: 0, correctCount: 0, wpm: 0, accuracy: 100, at: 0 };
}

export class Room extends DurableObject<Env> {
  private state: InternalState | null = null;
  private ready = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state =
        (await ctx.storage.get<InternalState>("state")) ?? null;
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
    if (this.state) {
      return new Response("already initialized", { status: 409 });
    }
    const body = await request.json<{
      roomId: string;
      passage: PassageInfo;
      config: RoomConfig;
    }>();

    this.state = {
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

    if (!this.state) {
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

    const role: PlayerRole =
      existing.length === 0 ? "host" : "guest";
    server.serializeAttachment({
      role,
      joinedAt: Date.now(),
    } satisfies Attachment);

    this.ctx.acceptWebSocket(server);

    const newCount = existing.length + 1;
    this.state = { ...this.state, playerCount: newCount };

    if (newCount === 2 && this.state.status === "waiting") {
      const startAt = Date.now() + START_BUFFER_MS;
      this.state = {
        ...this.state,
        status: "starting",
        startAt,
      };
      await this.ctx.storage.setAlarm(startAt);
    }

    await this.persistState();

    this.safeSend(server, { t: "welcome", role });
    this.safeSend(server, { t: "state", room: toPublic(this.state) });

    for (const other of existing) {
      this.safeSend(other, {
        t: "peer_joined",
        playerCount: newCount,
      });
      this.safeSend(other, { t: "state", room: toPublic(this.state) });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Alarm handler: either transition starting→racing, or end a time-mode race. */
  async alarm(): Promise<void> {
    if (!this.state) return;

    if (this.state.status === "starting") {
      // Pre-race buffer elapsed — start the race.
      const next: InternalState = {
        ...this.state,
        status: "racing",
        _hostProgress: undefined,
        _guestProgress: undefined,
        _hostFinishedAt: undefined,
        _guestFinishedAt: undefined,
      };
      if (this.state.config.endMode === "time") {
        next.endAt =
          (this.state.startAt ?? Date.now()) +
          this.state.config.timeLimit * 1000;
        await this.ctx.storage.setAlarm(next.endAt);
      }
      this.state = next;
      await this.persistState();
      this.broadcast({ t: "state", room: toPublic(this.state) });
      return;
    }

    if (
      this.state.status === "racing" &&
      this.state.config.endMode === "time"
    ) {
      await this.endRace("time_up");
      return;
    }
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
        if (this.state) {
          this.safeSend(ws, { t: "state", room: toPublic(this.state) });
        }
        return;

      case "progress": {
        if (this.state?.status !== "racing") return;
        const att = ws.deserializeAttachment() as Attachment | null;
        if (!att) return;
        const progress: PlayerProgress = {
          pos: msg.pos,
          correctCount: msg.correctCount,
          wpm: msg.wpm,
          accuracy: msg.accuracy,
          at: Date.now(),
        };
        if (att.role === "host") {
          this.state = { ...this.state, _hostProgress: progress };
        } else {
          this.state = { ...this.state, _guestProgress: progress };
        }
        await this.persistState();

        this.broadcastExcept(ws, {
          t: "opponent_progress",
          pos: msg.pos,
          correctCount: msg.correctCount,
          wpm: msg.wpm,
          accuracy: msg.accuracy,
        });
        return;
      }

      case "finished": {
        if (this.state?.status !== "racing") return;
        const att = ws.deserializeAttachment() as Attachment | null;
        if (!att) return;

        // Upsert final stats into progress (most accurate snapshot).
        const finalProgress: PlayerProgress = {
          pos: this.state.passage.text.length,
          correctCount: this.state.passage.text.length,
          wpm: msg.wpm,
          accuracy: msg.accuracy,
          at: Date.now(),
        };
        if (att.role === "host") {
          this.state = {
            ...this.state,
            _hostProgress: finalProgress,
            _hostFinishedAt: Date.now(),
          };
        } else {
          this.state = {
            ...this.state,
            _guestProgress: finalProgress,
            _guestFinishedAt: Date.now(),
          };
        }
        await this.persistState();

        this.broadcastExcept(ws, {
          t: "opponent_finished",
          wpm: msg.wpm,
          accuracy: msg.accuracy,
          elapsedMs: msg.elapsedMs,
        });

        // In finish-mode, first finisher wins and race ends immediately.
        if (this.state.config.endMode === "finish") {
          await this.endRace("finish");
        }
        return;
      }
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): Promise<void> {
    console.log(
      `[room ${this.state?.roomId}] close: code=${code} reason=${reason} clean=${wasClean}`
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
      `[room ${this.state?.roomId}] ws error: ${String(error)}`
    );
    await this.handleDisconnect(ws);
  }

  private async handleDisconnect(closing: WebSocket): Promise<void> {
    if (!this.state) return;
    const remaining = this.ctx
      .getWebSockets()
      .filter((s) => s !== closing).length;

    const nextStatus: PublicRoomState["status"] =
      remaining < 2 && this.state.status === "starting"
        ? "waiting"
        : this.state.status;

    this.state = {
      ...this.state,
      playerCount: remaining,
      status: nextStatus,
      startAt:
        nextStatus === "waiting" ? undefined : this.state.startAt,
    };
    // If we rolled back to waiting, cancel the countdown alarm.
    if (nextStatus === "waiting") {
      await this.ctx.storage.deleteAlarm();
    }
    await this.persistState();

    for (const other of this.ctx.getWebSockets()) {
      if (other === closing) continue;
      this.safeSend(other, {
        t: "peer_left",
        playerCount: remaining,
      });
      this.safeSend(other, { t: "state", room: toPublic(this.state) });
    }
  }

  private async endRace(reason: EndReason): Promise<void> {
    if (!this.state) return;
    if (this.state.status === "ended") return;

    const result = computeResult(this.state, reason);
    this.state = { ...this.state, status: "ended", result };
    await this.ctx.storage.deleteAlarm();
    await this.persistState();

    this.broadcast({ t: "state", room: toPublic(this.state) });
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
    if (!this.state) return;
    await this.ctx.storage.put("state", this.state);
  }

  private safeSend(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket closed or closing — ignore
    }
  }
}

function computeResult(s: InternalState, endReason: EndReason): RaceResult {
  const host = s._hostProgress ?? zeroProgress();
  const guest = s._guestProgress ?? zeroProgress();
  const startAt = s.startAt ?? Date.now();

  const hostFinished = s._hostFinishedAt !== undefined;
  const guestFinished = s._guestFinishedAt !== undefined;

  const hostElapsed = s._hostFinishedAt
    ? s._hostFinishedAt - startAt
    : Math.max(0, Date.now() - startAt);
  const guestElapsed = s._guestFinishedAt
    ? s._guestFinishedAt - startAt
    : Math.max(0, Date.now() - startAt);

  const hostResult: PlayerResult = {
    role: "host",
    wpm: host.wpm,
    accuracy: host.accuracy,
    elapsedMs: hostElapsed,
    pos: host.pos,
    correctCount: host.correctCount,
    finishedPassage: hostFinished,
  };
  const guestResult: PlayerResult = {
    role: "guest",
    wpm: guest.wpm,
    accuracy: guest.accuracy,
    elapsedMs: guestElapsed,
    pos: guest.pos,
    correctCount: guest.correctCount,
    finishedPassage: guestFinished,
  };

  let outcome: RaceOutcome;
  if (endReason === "finish") {
    if (hostFinished && !guestFinished) outcome = "host_wins";
    else if (guestFinished && !hostFinished) outcome = "guest_wins";
    else if (hostFinished && guestFinished) {
      outcome =
        (s._hostFinishedAt ?? 0) <= (s._guestFinishedAt ?? 0)
          ? "host_wins"
          : "guest_wins";
    } else {
      // Neither finished — shouldn't happen in finish mode
      outcome = "tie";
    }
  } else {
    // time_up — higher WPM wins, finisher breaks ties
    if (hostResult.wpm > guestResult.wpm) outcome = "host_wins";
    else if (guestResult.wpm > hostResult.wpm) outcome = "guest_wins";
    else if (hostFinished && !guestFinished) outcome = "host_wins";
    else if (guestFinished && !hostFinished) outcome = "guest_wins";
    else outcome = "tie";
  }

  return { outcome, endReason, host: hostResult, guest: guestResult };
}
