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
  RoomSource,
  ServerMsg,
} from "./protocol";
import {
  DISCONNECT_GRACE_MS,
  FINISH_GRACE_MS,
  READY_CHECK_MS,
  ROOM_EXPIRY_MS,
  START_BUFFER_MS,
} from "./protocol";
import { pickPassage } from "./passages";

interface Env {
  ROOM: DurableObjectNamespace<Room>;
  DB: D1Database;
  SENTRY_DSN: string;
}

interface Attachment {
  role: PlayerRole;
  sessionToken: string;
  joinedAt: number;
}

interface PlayerProgress {
  pos: number;
  correctCount: number;
  wpm: number;
  accuracy: number;
  at: number;
}

/**
 * Internal state persisted in DO storage.
 * Public fields are sent to clients; private (leading _) are server-only.
 */
interface InternalState extends PublicRoomState {
  _hostProgress?: PlayerProgress;
  _guestProgress?: PlayerProgress;
  _hostFinishedAt?: number;
  _guestFinishedAt?: number;
  _hostSessionToken?: string;
  _guestSessionToken?: string;
  _source: RoomSource;
  /** ms timestamp after which an empty room self-destroys. */
  _expiresAt?: number;
}

function toPublic(s: InternalState): PublicRoomState {
  const {
    _hostProgress,
    _guestProgress,
    _hostFinishedAt,
    _guestFinishedAt,
    _hostSessionToken,
    _guestSessionToken,
    _source,
    _expiresAt,
    ...pub
  } = s;
  return pub;
}

function zeroProgress(): PlayerProgress {
  return { pos: 0, correctCount: 0, wpm: 0, accuracy: 100, at: 0 };
}

/** Close code used when the server deliberately replaces a WS for the same role. */
const SUPERSEDE_CODE = 4001;

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
      source: RoomSource;
    }>();

    this.state = {
      roomId: body.roomId,
      passage: body.passage,
      config: body.config,
      status: "waiting",
      playerCount: 0,
      createdAt: Date.now(),
      _source: body.source,
    };
    await this.persistState();
    await this.trackRoomCreated(this.state);
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

    const url = new URL(request.url);
    const providedToken = url.searchParams.get("token");

    const resolved = this.resolveRole(providedToken);

    if (resolved.kind === "full") {
      server.accept();
      this.safeSend(server, {
        t: "error",
        code: "room_full",
        message: "race already in progress",
      });
      server.close(4009, "room_full");
      return new Response(null, { status: 101, webSocket: client });
    }

    const { role, sessionToken, supersedes } = resolved;

    // If this reconnect is replacing an existing socket for the same role,
    // close the old one with the supersede code so webSocketClose knows to
    // skip the disconnect-grace flow.
    if (supersedes) {
      for (const existingWs of this.ctx.getWebSockets()) {
        const att = existingWs.deserializeAttachment() as
          | Attachment
          | null;
        if (att?.role === role) {
          try {
            existingWs.close(SUPERSEDE_CODE, "superseded");
          } catch {
            // already closed
          }
        }
      }
    }

    server.serializeAttachment({
      role,
      sessionToken,
      joinedAt: Date.now(),
    } satisfies Attachment);
    this.ctx.acceptWebSocket(server);

    const firstJoinForRole =
      role === "host"
        ? !this.state._hostSessionToken
        : !this.state._guestSessionToken;
    const entersReadyCheck =
      this.state.playerCount === 1 && this.state.status === "waiting";

    // Update state: set token for the role, bump count, clear any
    // pending disconnect for this role, clear pending expiry.
    this.state = {
      ...this.state,
      playerCount: this.ctx.getWebSockets().length,
      _hostSessionToken:
        role === "host"
          ? sessionToken
          : this.state._hostSessionToken,
      _guestSessionToken:
        role === "guest"
          ? sessionToken
          : this.state._guestSessionToken,
      disconnected:
        this.state.disconnected?.role === role
          ? undefined
          : this.state.disconnected,
      _expiresAt: undefined,
    };

    // If this is the second player joining a waiting room, enter
    // ready_check: host is considered ready (they shared the link);
    // guest must click lock-in or the race auto-starts after
    // READY_CHECK_MS. Keeps the "sharing IS the race" pitch while
    // still giving the joiner a moment to brace.
    if (
      this.state.playerCount === 2 &&
      this.state.status === "waiting"
    ) {
      this.state = {
        ...this.state,
        status: "ready_check",
        readyCheckUntil: Date.now() + READY_CHECK_MS,
      };
    }

    await this.persistState();
    await this.trackRoleJoin(this.state.roomId, role, firstJoinForRole);
    if (entersReadyCheck) {
      await this.trackReadyCheckStarted(
        this.state.roomId,
        this.state.readyCheckUntil
          ? this.state.readyCheckUntil - READY_CHECK_MS
          : Date.now()
      );
    }
    await this.rescheduleAlarm();

    this.safeSend(server, { t: "welcome", role, sessionToken });
    this.safeSend(server, { t: "state", room: toPublic(this.state) });

    // Notify others of new/returning peer.
    for (const other of this.ctx.getWebSockets()) {
      if (other === server) continue;
      this.safeSend(other, {
        t: "peer_joined",
        playerCount: this.state.playerCount,
      });
      this.safeSend(other, { t: "state", room: toPublic(this.state) });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Decide which role a connection should take, based on its session token. */
  private resolveRole(
    providedToken: string | null
  ):
    | { kind: "full" }
    | {
        kind: "join";
        role: PlayerRole;
        sessionToken: string;
        supersedes: boolean;
      } {
    if (!this.state) return { kind: "full" };

    // Token match: reconnect into existing slot (superseding any live ws).
    if (providedToken) {
      if (this.state._hostSessionToken === providedToken) {
        return {
          kind: "join",
          role: "host",
          sessionToken: providedToken,
          supersedes: true,
        };
      }
      if (this.state._guestSessionToken === providedToken) {
        return {
          kind: "join",
          role: "guest",
          sessionToken: providedToken,
          supersedes: true,
        };
      }
    }

    // Fresh joiner: find an empty slot.
    if (!this.state._hostSessionToken) {
      return {
        kind: "join",
        role: "host",
        sessionToken: crypto.randomUUID(),
        supersedes: false,
      };
    }
    if (!this.state._guestSessionToken) {
      return {
        kind: "join",
        role: "guest",
        sessionToken: crypto.randomUUID(),
        supersedes: false,
      };
    }

    return { kind: "full" };
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

      case "lock_in": {
        // Only the guest needs to lock in (host is pre-ready). Accept
        // the signal from either role though — if the host somehow
        // clicks it (shouldn't happen, UI only shows for guest), we
        // still let it advance the state.
        if (this.state?.status !== "ready_check") return;
        await this.beginCountdown();
        return;
      }

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

        // Client reached the end of the passage. Typos are allowed — the
        // reported correctCount reflects actual accuracy, not a perfect run.
        const passageLen = this.state.passage.text.length;
        const correctCount = Math.max(
          0,
          Math.min(passageLen, msg.correctCount)
        );
        const finalProgress: PlayerProgress = {
          pos: passageLen,
          correctCount,
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

        if (this.state.config.endMode === "finish") {
          const hostDone = this.state._hostFinishedAt !== undefined;
          const guestDone = this.state._guestFinishedAt !== undefined;

          if (hostDone && guestDone) {
            // Both players crossed the line — end race now.
            await this.endRace("finish");
          } else if (!this.state.finishGrace) {
            // First finisher: broadcast a grace timer so the second can
            // complete and see their own stats. Auto-ends if they don't.
            this.state = {
              ...this.state,
              finishGrace: {
                firstFinisher: att.role,
                at: Date.now(),
                graceUntil: Date.now() + FINISH_GRACE_MS,
              },
            };
            await this.persistState();
            await this.rescheduleAlarm();
            this.broadcast({ t: "state", room: toPublic(this.state) });
          } else {
            // finishGrace already set — just broadcast updated state
            // (with this player's finishedAt now populated).
            this.broadcast({ t: "state", room: toPublic(this.state) });
          }
        }
        return;
      }

      case "rematch_request": {
        if (this.state?.status !== "ended") return;
        const att = ws.deserializeAttachment() as Attachment | null;
        if (!att) return;

        const ready = {
          ...(this.state.rematchReady ?? {
            host: false,
            guest: false,
          }),
        };
        ready[att.role] = true;

        if (ready.host && ready.guest) {
          await this.startRematch();
        } else {
          this.state = { ...this.state, rematchReady: ready };
          await this.persistState();
          this.broadcast({ t: "state", room: toPublic(this.state) });
        }
        return;
      }

      case "reaction": {
        // Only during the countdown and live race. ready_check is
        // reserved for its own UX (lock-in), ended has its own vibe
        // (win/lose banner), waiting has no opponent.
        const st = this.state?.status;
        if (st !== "starting" && st !== "racing") return;
        const att = ws.deserializeAttachment() as Attachment | null;
        if (!att) return;
        this.broadcastExcept(ws, {
          t: "opponent_reaction",
          key: msg.key,
          from: att.role,
        });
        return;
      }

      case "rematch_cancel": {
        if (this.state?.status !== "ended") return;
        const att = ws.deserializeAttachment() as Attachment | null;
        if (!att) return;

        const ready = {
          ...(this.state.rematchReady ?? {
            host: false,
            guest: false,
          }),
        };
        ready[att.role] = false;
        const allFalse = !ready.host && !ready.guest;

        this.state = {
          ...this.state,
          rematchReady: allFalse ? undefined : ready,
        };
        await this.persistState();
        this.broadcast({ t: "state", room: toPublic(this.state) });
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
    if (code === SUPERSEDE_CODE) {
      // This ws was replaced by a fresh connection for the same role
      // (reconnect). Skip the disconnect-grace flow.
      return;
    }
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

    const statusBeforeDisconnect = this.state.status;
    const att = closing.deserializeAttachment() as Attachment | null;
    const remaining = this.ctx
      .getWebSockets()
      .filter((s) => s !== closing).length;

    // Rollback a pre-race lobby to waiting.
    let nextStatus: PublicRoomState["status"] = this.state.status;
    if (
      remaining < 2 &&
      (this.state.status === "starting" ||
        this.state.status === "ready_check")
    ) {
      nextStatus = "waiting";
    }

    // Mid-race disconnect → start grace countdown on the dropped role.
    let disconnected = this.state.disconnected;
    if (this.state.status === "racing" && att && remaining < 2) {
      disconnected = {
        role: att.role,
        at: Date.now(),
        graceUntil: Date.now() + DISCONNECT_GRACE_MS,
      };
    }

    // Clear rematch readiness for the leaving role.
    let rematchReady = this.state.rematchReady;
    if (this.state.status === "ended" && rematchReady && att) {
      const next = { ...rematchReady };
      next[att.role] = false;
      rematchReady = next.host || next.guest ? next : undefined;
    }

    // Schedule room expiry if nobody is connected anymore.
    const expiresAt =
      remaining === 0
        ? Date.now() + ROOM_EXPIRY_MS
        : undefined;

    this.state = {
      ...this.state,
      playerCount: remaining,
      status: nextStatus,
      startAt:
        nextStatus === "waiting" ? undefined : this.state.startAt,
      readyCheckUntil:
        nextStatus === "waiting"
          ? undefined
          : this.state.readyCheckUntil,
      rematchReady,
      disconnected,
      _expiresAt: expiresAt,
    };
    await this.persistState();
    if (
      att &&
      (statusBeforeDisconnect === "waiting" ||
        statusBeforeDisconnect === "ready_check" ||
        statusBeforeDisconnect === "starting")
    ) {
      await this.trackPreStartDrop(this.state.roomId, att.role);
    }
    await this.rescheduleAlarm();

    for (const other of this.ctx.getWebSockets()) {
      if (other === closing) continue;
      this.safeSend(other, {
        t: "peer_left",
        playerCount: remaining,
      });
      this.safeSend(other, { t: "state", room: toPublic(this.state) });
    }
  }

  /* -------------------- alarm orchestration -------------------- */

  /**
   * Compute the next instant at which we need to run code, then schedule
   * a single DO alarm. Replaces all ad-hoc setAlarm calls elsewhere.
   */
  private async rescheduleAlarm(): Promise<void> {
    if (!this.state) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const s = this.state;
    const candidates: number[] = [];

    if (s.status === "ready_check" && s.readyCheckUntil) {
      candidates.push(s.readyCheckUntil);
    }
    if (s.status === "starting" && s.startAt) {
      candidates.push(s.startAt);
    }
    if (s.status === "racing" && s.disconnected) {
      candidates.push(s.disconnected.graceUntil);
    }
    if (s.status === "racing" && s.finishGrace) {
      candidates.push(s.finishGrace.graceUntil);
    }
    if (s.status === "racing" && s.endAt) {
      candidates.push(s.endAt);
    }
    if (s._expiresAt) {
      candidates.push(s._expiresAt);
    }

    if (candidates.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const next = Math.min(...candidates);
    await this.ctx.storage.setAlarm(next);
  }

  async alarm(): Promise<void> {
    if (!this.state) return;
    const now = Date.now();

    // Room expiry takes precedence: if nobody's here and the expiry has
    // fired, wipe the room so future connections see "room_not_found".
    if (
      this.state._expiresAt !== undefined &&
      now >= this.state._expiresAt &&
      this.state.playerCount === 0
    ) {
      this.state = null;
      await this.ctx.storage.deleteAll();
      return;
    }

    // Ready-check deadline elapsed → start the countdown anyway.
    if (
      this.state.status === "ready_check" &&
      this.state.readyCheckUntil &&
      now >= this.state.readyCheckUntil
    ) {
      await this.beginCountdown();
      return;
    }

    // Countdown elapsed → start the race.
    if (
      this.state.status === "starting" &&
      this.state.startAt &&
      now >= this.state.startAt
    ) {
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
          (this.state.startAt ?? now) +
          this.state.config.timeLimit * 1000;
      }
      this.state = next;
      await this.persistState();
      await this.trackRaceStarted(this.state.roomId, this.state.startAt ?? now);
      this.broadcast({ t: "state", room: toPublic(this.state) });
      await this.rescheduleAlarm();
      return;
    }

    // Grace expired → forfeit disconnected player.
    if (
      this.state.status === "racing" &&
      this.state.disconnected &&
      now >= this.state.disconnected.graceUntil
    ) {
      await this.endRace("disconnect");
      return;
    }

    // Finish-mode second-finisher grace elapsed → end race with first
    // finisher as winner.
    if (
      this.state.status === "racing" &&
      this.state.finishGrace &&
      now >= this.state.finishGrace.graceUntil
    ) {
      await this.endRace("finish");
      return;
    }

    // Time-mode timer elapsed → end race.
    if (
      this.state.status === "racing" &&
      this.state.endAt &&
      now >= this.state.endAt
    ) {
      await this.endRace("time_up");
      return;
    }

    // Shouldn't normally get here, but reschedule just in case something
    // else is still pending.
    await this.rescheduleAlarm();
  }

  /* -------------------- race end & rematch -------------------- */

  private async endRace(reason: EndReason): Promise<void> {
    if (!this.state) return;
    if (this.state.status === "ended") return;

    const result = computeResult(this.state, reason);
    const snapshotForDb = this.state;
    this.state = {
      ...this.state,
      status: "ended",
      result,
      disconnected: undefined,
      finishGrace: undefined,
    };
    await this.persistState();
    await this.trackRaceEnded(snapshotForDb.roomId, result);
    await this.rescheduleAlarm();
    this.broadcast({ t: "state", room: toPublic(this.state) });

    // Write to the leaderboard DB; failures here must not affect the race.
    if (snapshotForDb._source !== "load_test") {
      this.ctx.waitUntil(
        this.recordRace(snapshotForDb, result).catch(() => {
          // swallow — captured in Sentry by withSentry wrapper if it re-throws
        })
      );
    }
  }

  private async recordRace(
    stateAtEnd: InternalState,
    result: RaceResult
  ): Promise<void> {
    const duration =
      result.host.elapsedMs > result.guest.elapsedMs
        ? result.host.elapsedMs
        : result.guest.elapsedMs;

    await this.env.DB.prepare(
      `INSERT INTO races (
         id, finished_at, end_reason, outcome,
         passage_id, passage_length, passage_words,
         duration_ms,
         host_wpm, guest_wpm,
         host_accuracy, guest_accuracy,
         host_finished, guest_finished
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        stateAtEnd.roomId,
        Date.now(),
        result.endReason,
        result.outcome,
        stateAtEnd.passage.id,
        stateAtEnd.config.passageLength,
        stateAtEnd.passage.wordCount,
        duration,
        result.host.wpm,
        result.guest.wpm,
        result.host.accuracy,
        result.guest.accuracy,
        result.host.finishedPassage ? 1 : 0,
        result.guest.finishedPassage ? 1 : 0
      )
      .run();
  }

  /** Transition from ready_check into the 3-2-1 starting countdown. */
  private async beginCountdown(): Promise<void> {
    if (!this.state) return;
    if (this.state.status !== "ready_check") return;
    this.state = {
      ...this.state,
      status: "starting",
      startAt: Date.now() + START_BUFFER_MS,
      readyCheckUntil: undefined,
    };
    await this.persistState();
    await this.rescheduleAlarm();
    this.broadcast({ t: "state", room: toPublic(this.state) });
  }

  private async startRematch(): Promise<void> {
    if (!this.state) return;
    const newPassage = pickPassage(
      this.state.config.passageLength,
      this.state.passage.id
    );
    const startAt = Date.now() + START_BUFFER_MS;

    this.state = {
      roomId: this.state.roomId,
      passage: newPassage,
      config: this.state.config,
      status: "starting",
      playerCount: this.state.playerCount,
      createdAt: this.state.createdAt,
      startAt,
      _hostSessionToken: this.state._hostSessionToken,
      _guestSessionToken: this.state._guestSessionToken,
      _source: this.state._source,
    };
    await this.persistState();
    await this.rescheduleAlarm();
    this.broadcast({ t: "state", room: toPublic(this.state) });
  }

  /* -------------------- broadcast helpers -------------------- */

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

  private async trackRoomCreated(state: InternalState): Promise<void> {
    await this.env.DB.prepare(
      `INSERT OR IGNORE INTO room_analytics (
         room_id,
         created_at,
         source,
         config_end_mode,
         config_passage_length,
         config_time_limit
       ) VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        state.roomId,
        state.createdAt,
        state._source,
        state.config.endMode,
        state.config.passageLength,
        state.config.timeLimit
      )
      .run();
  }

  private async trackRoleJoin(
    roomId: string,
    role: PlayerRole,
    firstJoinForRole: boolean
  ): Promise<void> {
    if (!firstJoinForRole) return;
    const column = role === "host" ? "host_joined_at" : "guest_joined_at";
    await this.env.DB.prepare(
      `UPDATE room_analytics
          SET ${column} = COALESCE(${column}, ?)
        WHERE room_id = ?`
    )
      .bind(Date.now(), roomId)
      .run();
  }

  private async trackReadyCheckStarted(
    roomId: string,
    at: number
  ): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE room_analytics
          SET ready_check_started_at = COALESCE(ready_check_started_at, ?)
        WHERE room_id = ?`
    )
      .bind(at, roomId)
      .run();
  }

  private async trackRaceStarted(roomId: string, at: number): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE room_analytics
          SET race_started_at = COALESCE(race_started_at, ?)
        WHERE room_id = ?`
    )
      .bind(at, roomId)
      .run();
  }

  private async trackPreStartDrop(
    roomId: string,
    role: PlayerRole
  ): Promise<void> {
    const roleColumn =
      role === "host"
        ? "host_pre_start_drop_count"
        : "guest_pre_start_drop_count";
    await this.env.DB.prepare(
      `UPDATE room_analytics
          SET pre_start_drop_count = pre_start_drop_count + 1,
              ${roleColumn} = ${roleColumn} + 1
        WHERE room_id = ?`
    )
      .bind(roomId)
      .run();
  }

  private async trackRaceEnded(
    roomId: string,
    result: RaceResult
  ): Promise<void> {
    const completedSuccessfully = result.endReason === "disconnect" ? 0 : 1;
    await this.env.DB.prepare(
      `UPDATE room_analytics
          SET race_ended_at = COALESCE(race_ended_at, ?),
              race_end_reason = COALESCE(race_end_reason, ?),
              outcome = COALESCE(outcome, ?),
              completed_successfully = CASE
                WHEN completed_successfully = 1 THEN 1
                ELSE ?
              END
        WHERE room_id = ?`
    )
      .bind(
        Date.now(),
        result.endReason,
        result.outcome,
        completedSuccessfully,
        roomId
      )
      .run();
  }
}

function computeResult(
  s: InternalState,
  endReason: EndReason
): RaceResult {
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
    outcome = compareFinishMode(s, hostResult, guestResult);
  } else if (endReason === "disconnect") {
    // The player who disconnected forfeits; the other wins.
    if (s.disconnected?.role === "host") outcome = "guest_wins";
    else if (s.disconnected?.role === "guest") outcome = "host_wins";
    else {
      // Shouldn't happen — fall back to whoever typed more.
      outcome =
        hostResult.wpm >= guestResult.wpm ? "host_wins" : "guest_wins";
    }
  } else {
    // time_up
    if (hostResult.wpm > guestResult.wpm) outcome = "host_wins";
    else if (guestResult.wpm > hostResult.wpm) outcome = "guest_wins";
    else if (hostFinished && !guestFinished) outcome = "host_wins";
    else if (guestFinished && !hostFinished) outcome = "guest_wins";
    else outcome = "tie";
  }

  return { outcome, endReason, host: hostResult, guest: guestResult };
}

function compareFinishMode(
  s: InternalState,
  host: PlayerResult,
  guest: PlayerResult
): RaceOutcome {
  const hostScore = finishModeScore(host);
  const guestScore = finishModeScore(guest);
  const scoreDelta = hostScore - guestScore;

  if (Math.abs(scoreDelta) > 0.01) {
    return scoreDelta > 0 ? "host_wins" : "guest_wins";
  }

  if (host.finishedPassage !== guest.finishedPassage) {
    return host.finishedPassage ? "host_wins" : "guest_wins";
  }

  if (host.correctCount !== guest.correctCount) {
    return host.correctCount > guest.correctCount
      ? "host_wins"
      : "guest_wins";
  }

  const hostFinishedAt = s._hostFinishedAt ?? Number.POSITIVE_INFINITY;
  const guestFinishedAt = s._guestFinishedAt ?? Number.POSITIVE_INFINITY;
  if (hostFinishedAt !== guestFinishedAt) {
    return hostFinishedAt < guestFinishedAt ? "host_wins" : "guest_wins";
  }

  if (host.elapsedMs !== guest.elapsedMs) {
    return host.elapsedMs < guest.elapsedMs ? "host_wins" : "guest_wins";
  }

  return "tie";
}

function finishModeScore(result: PlayerResult): number {
  const accuracyWeight = result.accuracy / 100;
  return result.wpm * accuracyWeight * accuracyWeight;
}
