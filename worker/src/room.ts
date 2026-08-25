import { DurableObject } from "cloudflare:workers";
import type {
  ClientMsg,
  EndMode,
  EndReason,
  PassageInfo,
  PlayerResult,
  PlayerSlot,
  PublicRoomState,
  RaceResult,
  RoomConfig,
  RoomSource,
  Seat,
  ServerMsg,
} from "./protocol";
import {
  HOST_SEAT,
  MIN_PLAYERS,
  READY_CHECK_MS,
  ROOM_EXPIRY_MS,
  START_BUFFER_MS,
  finishGraceMs,
  normalizeMaxPlayers,
  raceCapMs,
} from "./protocol";
import { pickPassage } from "./passages";
import {
  analyticsContextFromRequest,
  safeInsertAnalyticsEvent,
  type AnalyticsContext,
} from "./analytics";
import {
  decodeClientMessage,
  INVALID_MESSAGE_CODE,
} from "./client-message";

interface Env {
  ROOM: DurableObjectNamespace<Room>;
  DB: D1Database;
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  ADMIN_ANALYTICS_TOKEN?: string;
  ANALYTICS_IP_HASH_SALT?: string;
  ROOM_CREATE_RATE_LIMITER: RateLimit;
  WS_JOIN_RATE_LIMITER: RateLimit;
  EVENT_RATE_LIMITER: RateLimit;
}

interface PlayerAttachment {
  kind: "player";
  seat: Seat;
  sessionToken: string;
  joinedAt: number;
  analytics?: AnalyticsContext;
}

interface SpectatorAttachment {
  kind: "spectator";
  spectatorId: string;
  joinedAt: number;
  analytics?: AnalyticsContext;
}

type Attachment = PlayerAttachment | SpectatorAttachment;

interface PlayerProgress {
  pos: number;
  correctCount: number;
  wpm: number;
  accuracy: number;
  at: number;
}

/** Server-side seat record. Never sent to clients as-is. */
interface PlayerInternal {
  seat: Seat;
  isHost: boolean;
  sessionToken: string;
  joinedAt: number;
  ready: boolean;
  /** Mid-race drop; the seat is held so they can reconnect and continue. */
  droppedAt?: number;
  progress: PlayerProgress;
  finishedAt?: number;
}

/**
 * Internal state persisted in DO storage.
 * Public fields are sent to clients; private (leading _) are server-only.
 * players/playerCount/connectedCount are derived from live sockets in
 * toPublic, so they are not stored.
 */
type StoredPublic = Omit<
  PublicRoomState,
  "players" | "playerCount" | "connectedCount"
>;

interface InternalState extends StoredPublic {
  _players: PlayerInternal[];
  _source: RoomSource;
  /** ms timestamp after which an empty room self-destroys. */
  _expiresAt?: number;
}

function zeroProgress(): PlayerProgress {
  return { pos: 0, correctCount: 0, wpm: 0, accuracy: 100, at: 0 };
}

function finiteNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function finiteInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  return Math.round(finiteNumber(value, fallback, min, max));
}

function sanitizeProgress(
  value: unknown,
  passageLength: number
): PlayerProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return zeroProgress();
  }
  const raw = value as Record<string, unknown>;
  return {
    pos: finiteInteger(raw.pos, 0, 0, passageLength),
    correctCount: finiteInteger(raw.correctCount, 0, 0, passageLength),
    wpm: finiteInteger(raw.wpm, 0, 0, 1_000_000),
    accuracy:
      Math.round(finiteNumber(raw.accuracy, 100, 0, 100) * 10) / 10,
    at: finiteInteger(raw.at, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

/** Close code used when the server deliberately replaces a WS for the same seat. */
const SUPERSEDE_CODE = 4001;
const ROOM_TERMINAL_CODE = 4004;
const MAX_SPECTATORS = 25;
const SPECTATOR_FULL_CODE = 4010;
const PROGRESS_PERSIST_INTERVAL_MS = 2_000;

/** Stable analytics label so existing host/guest queries keep working. */
function seatLabel(seat: Seat): string {
  if (seat === 0) return "host";
  if (seat === 1) return "guest";
  return `seat_${seat}`;
}

function normalizeAttachment(ws: WebSocket): Attachment | null {
  const raw = ws.deserializeAttachment() as
    | (Partial<Attachment> & {
        seat?: number;
        role?: string;
        sessionToken?: string;
        joinedAt?: number;
      })
    | null;
  if (!raw) return null;
  if (
    raw.kind === "spectator" &&
    typeof raw.spectatorId === "string" &&
    typeof raw.joinedAt === "number"
  ) {
    return {
      kind: "spectator",
      spectatorId: raw.spectatorId,
      joinedAt: raw.joinedAt,
      analytics:
        typeof raw.analytics === "object" && raw.analytics !== null
          ? (raw.analytics as AnalyticsContext)
          : undefined,
    };
  }
  // Sockets attached by a previous deploy carry role instead of seat.
  const seat =
    typeof raw.seat === "number"
      ? raw.seat
      : raw.role === "host"
        ? 0
        : raw.role === "guest"
          ? 1
          : undefined;
  if (
    seat !== undefined &&
    typeof raw.sessionToken === "string" &&
    typeof raw.joinedAt === "number"
  ) {
    return {
      kind: "player",
      seat,
      sessionToken: raw.sessionToken,
      joinedAt: raw.joinedAt,
      analytics:
        typeof raw.analytics === "object" && raw.analytics !== null
          ? (raw.analytics as AnalyticsContext)
          : undefined,
    };
  }
  return null;
}

/**
 * Rooms persisted by the two-player build store host/guest fields instead
 * of a seat list. Rooms are short-lived, but a deploy mid-race shouldn't
 * strand anyone, so fold the old shape into the new one.
 */
function migrateStoredState(raw: unknown): InternalState | null {
  if (!raw || typeof raw !== "object") return null;
  const state = raw as InternalState &
    Record<string, unknown> & { config?: Partial<RoomConfig> };

  if (!state.config) return null;
  state.config = {
    ...state.config,
    maxPlayers: normalizeMaxPlayers(state.config.maxPlayers),
  } as RoomConfig;

  const passageLength =
    typeof state.passage?.text === "string" ? state.passage.text.length : 0;

  if (Array.isArray(state._players)) {
    state._players = state._players
      .filter(
        (player): player is PlayerInternal =>
          Boolean(player) &&
          typeof player === "object" &&
          Number.isInteger(player.seat) &&
          player.seat >= 0 &&
          player.seat < state.config.maxPlayers &&
          typeof player.sessionToken === "string" &&
          player.sessionToken.length > 0
      )
      .map((player) => ({
        ...player,
        isHost: player.seat === HOST_SEAT,
        joinedAt: finiteInteger(
          player.joinedAt,
          state.createdAt ?? Date.now(),
          0,
          Number.MAX_SAFE_INTEGER
        ),
        ready: player.ready === true,
        droppedAt:
          player.droppedAt === undefined
            ? undefined
            : finiteInteger(
                player.droppedAt,
                state.createdAt ?? Date.now(),
                0,
                Number.MAX_SAFE_INTEGER
              ),
        progress: sanitizeProgress(player.progress, passageLength),
        finishedAt:
          player.finishedAt === undefined
            ? undefined
            : finiteInteger(
                player.finishedAt,
                state.createdAt ?? Date.now(),
                0,
                Number.MAX_SAFE_INTEGER
              ),
      }));
    return state as InternalState;
  }

  const legacy = raw as {
    _hostSessionToken?: string;
    _guestSessionToken?: string;
    _hostProgress?: PlayerProgress;
    _guestProgress?: PlayerProgress;
    _hostFinishedAt?: number;
    _guestFinishedAt?: number;
    createdAt?: number;
  };

  const players: PlayerInternal[] = [];
  if (legacy._hostSessionToken) {
    players.push({
      seat: 0,
      isHost: true,
      sessionToken: legacy._hostSessionToken,
      joinedAt: legacy.createdAt ?? Date.now(),
      ready: false,
      progress: sanitizeProgress(legacy._hostProgress, passageLength),
      finishedAt: legacy._hostFinishedAt,
    });
  }
  if (legacy._guestSessionToken) {
    players.push({
      seat: 1,
      isHost: false,
      sessionToken: legacy._guestSessionToken,
      joinedAt: legacy.createdAt ?? Date.now(),
      ready: false,
      progress: sanitizeProgress(legacy._guestProgress, passageLength),
      finishedAt: legacy._guestFinishedAt,
    });
  }

  state._players = players;
  delete (state as Record<string, unknown>).disconnected;
  delete (state as Record<string, unknown>).rematchReady;
  return state as InternalState;
}

export class Room extends DurableObject<Env> {
  private state: InternalState | null = null;
  private ready = false;
  private lastProgressPersistAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = migrateStoredState(await ctx.storage.get("state"));
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
      config: {
        ...body.config,
        maxPlayers: normalizeMaxPlayers(body.config.maxPlayers),
      },
      status: "waiting",
      spectatorCount: 0,
      createdAt: Date.now(),
      lobbyExpiresAt: Date.now() + ROOM_EXPIRY_MS,
      _players: [],
      _source: body.source,
    };
    const initializedState = this.state;
    await this.persistState();
    await this.trackRoomCreated(initializedState);
    await this.upsertActiveRoom("created");
    await this.rescheduleAlarm();
    return Response.json({ ok: true });
  }

  private async handleUpgrade(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const stateAtUpgrade = this.state;
    if (!stateAtUpgrade) return this.roomNotFoundUpgrade(server, client);

    const roomId = stateAtUpgrade.roomId;
    const roomSource = stateAtUpgrade._source;

    const url = new URL(request.url);
    const providedToken = url.searchParams.get("token");
    const analyticsContext = await analyticsContextFromRequest(this.env, request, {
      path: `/room/${roomId}`,
      source: roomSource,
    });

    // An alarm may expire an empty room while request analytics is awaiting
    // crypto. Re-check before resolving or attaching the socket.
    if (!this.state || this.state.roomId !== roomId) {
      return this.roomNotFoundUpgrade(server, client);
    }

    const resolved = this.resolveConnection(providedToken);

    if (resolved.kind === "spectator_full") {
      server.accept();
      this.safeSend(server, {
        t: "error",
        code: "spectator_full",
        message: "too many people are watching this race",
      });
      server.close(SPECTATOR_FULL_CODE, "spectator_full");
      return new Response(null, { status: 101, webSocket: client });
    }

    if (resolved.kind === "spectate") {
      const joinedAt = Date.now();
      server.serializeAttachment({
        kind: "spectator",
        spectatorId: crypto.randomUUID(),
        joinedAt,
        analytics: analyticsContext,
      } satisfies SpectatorAttachment);
      this.ctx.acceptWebSocket(server);

      this.state = {
        ...this.state,
        spectatorCount: this.countSpectatorSockets(),
        _expiresAt: undefined,
      };
      const joinedState = this.state;
      await this.persistState();
      await this.upsertActiveRoom("spectator_joined");
      await this.trackSpectatorJoin(
        roomId,
        joinedAt,
        joinedState.spectatorCount
      );
      await safeInsertAnalyticsEvent(this.env, analyticsContext, {
        eventName: "spectator_joined",
        roomId,
        participantKind: "spectator",
        metadata: {
          spectatorCount: joinedState.spectatorCount,
          status: joinedState.status,
        },
      });
      await this.rescheduleAlarm();

      if (!this.state || this.state.roomId !== roomId) {
        this.safeSend(server, {
          t: "error",
          code: "room_not_found",
          message: "room not found or expired",
        });
        server.close(ROOM_TERMINAL_CODE, "room_not_found");
        return new Response(null, { status: 101, webSocket: client });
      }

      this.safeSend(server, { t: "spectator_welcome" });
      this.safeSend(server, { t: "state", room: this.toPublic() });
      this.sendProgressSnapshot(server);
      this.broadcastExcept(server, { t: "state", room: this.toPublic() });

      return new Response(null, { status: 101, webSocket: client });
    }

    const { seat, sessionToken, supersedes, isNewSeat } = resolved;

    // A reconnect replacing a live socket for the same seat closes the old
    // one with the supersede code, so webSocketClose skips the drop flow.
    if (supersedes) {
      for (const existingWs of this.ctx.getWebSockets()) {
        const att = normalizeAttachment(existingWs);
        if (att?.kind === "player" && att.seat === seat) {
          try {
            existingWs.close(SUPERSEDE_CODE, "superseded");
          } catch {
            // already closed
          }
        }
      }
    }

    server.serializeAttachment({
      kind: "player",
      seat,
      sessionToken,
      joinedAt: Date.now(),
      analytics: analyticsContext,
    } satisfies PlayerAttachment);
    this.ctx.acceptWebSocket(server);

    const stateBeforeJoin = this.state;
    const isHost = isNewSeat
      ? stateBeforeJoin._players.length === 0
      : seat === HOST_SEAT;

    const players = isNewSeat
      ? [
          ...stateBeforeJoin._players,
          {
            seat,
            isHost,
            sessionToken,
            joinedAt: Date.now(),
            ready: false,
            progress: zeroProgress(),
          } satisfies PlayerInternal,
        ].sort((a, b) => a.seat - b.seat)
      : // Returning racer: clear the held-seat marker, keep their progress.
        stateBeforeJoin._players.map((p) =>
          p.seat === seat ? { ...p, droppedAt: undefined } : p
        );

    this.state = {
      ...stateBeforeJoin,
      _players: players,
      spectatorCount: this.countSpectatorSockets(),
      _expiresAt: undefined,
    };

    // Room just filled up while waiting: everyone gets a moment to brace,
    // then it auto-starts. The host can also force-start before this.
    const roomIsFull = players.length >= this.state.config.maxPlayers;
    const entersReadyCheck = roomIsFull && this.state.status === "waiting";
    if (entersReadyCheck) {
      this.state = {
        ...this.state,
        status: "ready_check",
        readyCheckUntil: Date.now() + READY_CHECK_MS,
        lobbyExpiresAt: undefined,
        // The host set the room up and shared the link, so they count as
        // ready; everyone who joined via that link locks in.
        _players: this.state._players.map((p) =>
          p.isHost ? { ...p, ready: true } : p
        ),
      };
    }
    const joinedState = this.state;

    await this.persistState();
    await this.upsertActiveRoom("player_joined");
    await this.trackSeatJoin(roomId, seat, isNewSeat);
    await safeInsertAnalyticsEvent(this.env, analyticsContext, {
      eventName: "player_joined",
      roomId,
      participantKind: "player",
      playerRole: seatLabel(seat),
      metadata: {
        firstJoinForSeat: isNewSeat,
        seat,
        playerCount: players.length,
        maxPlayers: joinedState.config.maxPlayers,
        status: joinedState.status,
      },
    });
    if (entersReadyCheck) {
      await this.trackReadyCheckStarted(roomId, Date.now());
    }
    await this.rescheduleAlarm();

    if (!this.state || this.state.roomId !== roomId) {
      this.safeSend(server, {
        t: "error",
        code: "room_not_found",
        message: "room not found or expired",
      });
      server.close(ROOM_TERMINAL_CODE, "room_not_found");
      return new Response(null, { status: 101, webSocket: client });
    }

    this.safeSend(server, { t: "welcome", seat, isHost, sessionToken });
    this.safeSend(server, { t: "state", room: this.toPublic() });
    // A racer rejoining mid-race needs everyone else's current positions.
    this.sendProgressSnapshot(server, seat);
    this.broadcastExcept(server, { t: "state", room: this.toPublic() });

    return new Response(null, { status: 101, webSocket: client });
  }

  private roomNotFoundUpgrade(
    server: WebSocket,
    client: WebSocket
  ): Response {
    server.accept();
    this.safeSend(server, {
      t: "error",
      code: "room_not_found",
      message: "room not found or expired",
    });
    server.close(ROOM_TERMINAL_CODE, "room_not_found");
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Decide whether a connection should race or watch. */
  private resolveConnection(
    providedToken: string | null
  ):
    | { kind: "spectator_full" }
    | { kind: "spectate" }
    | {
        kind: "join";
        seat: Seat;
        sessionToken: string;
        supersedes: boolean;
        isNewSeat: boolean;
      } {
    if (!this.state) return { kind: "spectator_full" };

    // Token match: reconnect into the existing seat, superseding any live ws.
    if (providedToken) {
      const existing = this.state._players.find(
        (p) => p.sessionToken === providedToken
      );
      if (existing) {
        return {
          kind: "join",
          seat: existing.seat,
          sessionToken: providedToken,
          supersedes: true,
          isNewSeat: false,
        };
      }
    }

    // Fresh joiner: take the lowest free seat if the room has room.
    if (this.state._players.length < this.state.config.maxPlayers) {
      const taken = new Set(this.state._players.map((p) => p.seat));
      let seat = 0;
      while (taken.has(seat)) seat += 1;
      return {
        kind: "join",
        seat,
        sessionToken: crypto.randomUUID(),
        supersedes: false,
        isNewSeat: true,
      };
    }

    if (this.countSpectatorSockets() >= MAX_SPECTATORS) {
      return { kind: "spectator_full" };
    }

    return { kind: "spectate" };
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    if (typeof message !== "string") {
      try {
        ws.close(INVALID_MESSAGE_CODE, "binary_messages_not_supported");
      } catch {
        // already closed
      }
      return;
    }

    const decoded = decodeClientMessage(
      message,
      this.state?.passage.text.length ?? 0
    );
    if (!decoded.ok) {
      try {
        ws.close(decoded.code, decoded.reason);
      } catch {
        // already closed
      }
      return;
    }
    const msg: ClientMsg = decoded.message;

    switch (msg.t) {
      case "ping":
        this.safeSend(ws, { t: "pong" });
        return;

      case "hello":
        if (this.state) {
          this.safeSend(ws, { t: "state", room: this.toPublic() });
        }
        return;

      case "lock_in": {
        if (this.state?.status !== "ready_check") return;
        const att = normalizeAttachment(ws);
        if (att?.kind !== "player") return;

        this.state = {
          ...this.state,
          _players: this.state._players.map((p) =>
            p.seat === att.seat ? { ...p, ready: true } : p
          ),
        };

        // Only wait on racers who are actually here. A held seat whose
        // owner is still reconnecting shouldn't stall everyone else.
        const connected = this.connectedSeats();
        const allReady = this.state._players
          .filter((p) => connected.has(p.seat))
          .every((p) => p.ready);

        if (allReady && connected.size >= MIN_PLAYERS) {
          await this.beginCountdown();
        } else {
          await this.persistState();
          this.broadcastCurrentState();
        }
        return;
      }

      case "start_race": {
        const status = this.state?.status;
        if (status !== "waiting" && status !== "ready_check") return;
        const att = normalizeAttachment(ws);
        if (att?.kind !== "player") return;
        const player = this.state?._players.find((p) => p.seat === att.seat);
        if (!player?.isHost) return;
        if (this.connectedSeats().size < MIN_PLAYERS) return;
        await this.beginCountdown();
        return;
      }

      case "progress": {
        if (this.state?.status !== "racing") return;
        const att = normalizeAttachment(ws);
        if (att?.kind !== "player") return;
        const at = Date.now();
        const passageLen = this.state.passage.text.length;
        const pos = Math.max(0, Math.min(passageLen, msg.pos));
        const correctCount = Math.max(
          0,
          Math.min(passageLen, msg.correctCount)
        );
        const wpm = calcOfficialWpm(
          correctCount,
          elapsedSinceStart(this.state, at)
        );
        const progress: PlayerProgress = {
          pos,
          correctCount,
          wpm,
          accuracy: msg.accuracy,
          at,
        };
        this.state = {
          ...this.state,
          _players: this.state._players.map((p) =>
            p.seat === att.seat ? { ...p, progress } : p
          ),
        };
        await this.maybePersistProgress(at);
        this.broadcastExcept(ws, {
          t: "player_progress",
          seat: att.seat,
          pos,
          correctCount,
          wpm,
          accuracy: msg.accuracy,
        });
        return;
      }

      case "finished": {
        if (this.state?.status !== "racing") return;
        const att = normalizeAttachment(ws);
        if (att?.kind !== "player") return;
        const self = this.state._players.find((p) => p.seat === att.seat);
        if (!self || self.finishedAt !== undefined) return;

        // Client reached the end of the passage. Typos are allowed — the
        // reported correctCount reflects actual accuracy, not a perfect run.
        const passageLen = this.state.passage.text.length;
        const correctCount = Math.max(
          0,
          Math.min(passageLen, msg.correctCount)
        );
        const finishedAt = Date.now();
        const elapsedMs = elapsedSinceStart(this.state, finishedAt);
        const wpm = calcOfficialWpm(correctCount, elapsedMs);

        this.state = {
          ...this.state,
          _players: this.state._players.map((p) =>
            p.seat === att.seat
              ? {
                  ...p,
                  finishedAt,
                  progress: {
                    pos: passageLen,
                    correctCount,
                    wpm,
                    accuracy: msg.accuracy,
                    at: finishedAt,
                  },
                }
              : p
          ),
        };

        this.broadcastExcept(ws, {
          t: "player_finished",
          seat: att.seat,
          wpm,
          accuracy: msg.accuracy,
          elapsedMs,
        });

        if (this.state.config.endMode === "finish") {
          const everyoneDone = this.state._players.every(
            (p) => p.finishedAt !== undefined
          );

          if (everyoneDone) {
            await this.endRace("finish");
          } else if (!this.state.finishGrace) {
            // First across the line starts the window everyone else has
            // to finish in. Wider fields get a longer window.
            const stillTyping = this.state._players.filter(
              (p) => p.finishedAt === undefined
            ).length;
            this.state = {
              ...this.state,
              finishGrace: {
                firstFinisherSeat: att.seat,
                at: finishedAt,
                graceUntil: finishedAt + finishGraceMs(stillTyping),
              },
            };
            await this.persistState();
            await this.upsertActiveRoom("finish_grace_started");
            await this.rescheduleAlarm();
            this.broadcastCurrentState();
          } else {
            await this.persistState();
            this.broadcastCurrentState();
          }
        } else {
          await this.persistState();
          this.broadcastCurrentState();
        }
        return;
      }

      case "rematch_request": {
        if (this.state?.status !== "ended") return;
        const att = normalizeAttachment(ws);
        if (att?.kind !== "player") return;

        this.state = {
          ...this.state,
          _players: this.state._players.map((p) =>
            p.seat === att.seat ? { ...p, ready: true } : p
          ),
        };

        // Everyone still in the room has to want it. Racers who left are
        // dropped from the count so they can't block the rest forever.
        const connected = this.connectedSeats();
        const readyHere = this.state._players.filter(
          (p) => connected.has(p.seat) && p.ready
        ).length;

        if (readyHere >= MIN_PLAYERS && readyHere === connected.size) {
          await this.startRematch();
        } else {
          await this.persistState();
          await this.upsertActiveRoom("rematch_requested");
          this.broadcastCurrentState();
        }
        return;
      }

      case "rematch_cancel": {
        if (this.state?.status !== "ended") return;
        const att = normalizeAttachment(ws);
        if (att?.kind !== "player") return;

        this.state = {
          ...this.state,
          _players: this.state._players.map((p) =>
            p.seat === att.seat ? { ...p, ready: false } : p
          ),
        };
        await this.persistState();
        await this.upsertActiveRoom("rematch_cancelled");
        this.broadcastCurrentState();
        return;
      }

      case "reaction": {
        // Only during the countdown and live race. ready_check is
        // reserved for its own UX (lock-in), ended has its own vibe
        // (win/lose banner), waiting has no opponent.
        const st = this.state?.status;
        if (st !== "starting" && st !== "racing") return;
        const att = normalizeAttachment(ws);
        if (att?.kind !== "player") return;
        this.broadcastExcept(ws, {
          t: "player_reaction",
          seat: att.seat,
          key: msg.key,
        });
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
    if (code === SUPERSEDE_CODE || code === ROOM_TERMINAL_CODE) {
      // Superseded sockets and server-expired/not-found rooms are terminal
      // server actions. Normal disconnect analytics would race room cleanup.
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
    const stateBeforeDisconnect = this.state;
    if (!stateBeforeDisconnect) return;

    const roomId = stateBeforeDisconnect.roomId;
    const statusBeforeDisconnect = stateBeforeDisconnect.status;
    const att = normalizeAttachment(closing);
    const remainingSeats = this.connectedSeats(closing);
    const remainingSpectators = this.countSpectatorSockets(closing);

    if (att?.kind === "spectator") {
      this.state = {
        ...stateBeforeDisconnect,
        spectatorCount: remainingSpectators,
        _expiresAt:
          remainingSeats.size + remainingSpectators === 0
            ? Date.now() + ROOM_EXPIRY_MS
            : undefined,
      };
      const nextState = this.state;
      await this.persistState();
      await this.upsertActiveRoom("spectator_left");
      await this.trackSpectatorLeave(roomId, att.joinedAt, Date.now());
      await safeInsertAnalyticsEvent(
        this.env,
        this.withRoomAnalyticsDefaults(att.analytics),
        {
          eventName: "spectator_left",
          roomId,
          participantKind: "spectator",
          metadata: {
            spectatorCount: nextState.spectatorCount,
            watchMs: Math.max(0, Date.now() - att.joinedAt),
          },
        }
      );
      await this.rescheduleAlarm();
      this.broadcastCurrentState(closing);
      return;
    }

    if (att?.kind !== "player") return;

    const raceInFlight =
      statusBeforeDisconnect === "racing" ||
      statusBeforeDisconnect === "ended";

    let players: PlayerInternal[];
    if (raceInFlight) {
      // Hold the seat: they keep their progress and can reconnect with the
      // same session token. Rematch readiness is cleared either way so a
      // racer who walked away can't hold the room hostage.
      players = stateBeforeDisconnect._players.map((p) =>
        p.seat === att.seat
          ? { ...p, droppedAt: p.droppedAt ?? Date.now(), ready: false }
          : p
      );
    } else {
      // Pre-race, the seat is freed so somebody else can take it.
      players = stateBeforeDisconnect._players.filter(
        (p) => p.seat !== att.seat
      );
    }

    // A lobby that fell back below the start threshold reopens for invites.
    let nextStatus = stateBeforeDisconnect.status;
    if (
      remainingSeats.size < MIN_PLAYERS &&
      (nextStatus === "starting" || nextStatus === "ready_check")
    ) {
      nextStatus = "waiting";
    }

    const backToWaiting = nextStatus === "waiting";

    this.state = {
      ...stateBeforeDisconnect,
      _players: backToWaiting
        ? players.map((p) => ({ ...p, ready: false }))
        : players,
      spectatorCount: remainingSpectators,
      status: nextStatus,
      startAt: backToWaiting ? undefined : stateBeforeDisconnect.startAt,
      readyCheckUntil: backToWaiting
        ? undefined
        : stateBeforeDisconnect.readyCheckUntil,
      lobbyExpiresAt:
        backToWaiting && remainingSeats.size > 0
          ? Date.now() + ROOM_EXPIRY_MS
          : undefined,
      _expiresAt:
        remainingSeats.size + remainingSpectators === 0
          ? Date.now() + ROOM_EXPIRY_MS
          : undefined,
    };
    await this.persistState();
    await this.upsertActiveRoom("player_left");
    if (
      statusBeforeDisconnect === "waiting" ||
      statusBeforeDisconnect === "ready_check" ||
      statusBeforeDisconnect === "starting"
    ) {
      await this.trackPreStartDrop(roomId, att.seat);
    }
    await safeInsertAnalyticsEvent(
      this.env,
      this.withRoomAnalyticsDefaults(att.analytics),
      {
        eventName: "player_left",
        roomId,
        participantKind: "player",
        playerRole: seatLabel(att.seat),
        metadata: {
          statusBeforeDisconnect,
          seat: att.seat,
          seatHeld: raceInFlight,
          connectedCount: remainingSeats.size,
        },
      }
    );

    // Everyone abandoned a live race — score it now so it still lands in
    // the results table instead of silently expiring.
    if (statusBeforeDisconnect === "racing" && remainingSeats.size === 0) {
      await this.endRace("disconnect", closing);
      return;
    }

    await this.rescheduleAlarm();
    this.broadcastCurrentState(closing);
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
    if (s.status === "racing" && s.finishGrace) {
      candidates.push(s.finishGrace.graceUntil);
    }
    if (s.status === "racing" && s.endAt) {
      candidates.push(s.endAt);
    }
    if (s.status === "racing" && s.hardEndAt) {
      candidates.push(s.hardEndAt);
    }
    if (s._expiresAt) {
      candidates.push(s._expiresAt);
    }
    if (s.status === "waiting" && s.lobbyExpiresAt) {
      candidates.push(s.lobbyExpiresAt);
    }

    if (candidates.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    await this.ctx.storage.setAlarm(Math.min(...candidates));
  }

  async alarm(): Promise<void> {
    if (!this.state) return;
    const now = Date.now();

    // Waiting lobby timed out while still open — close live connections.
    if (
      this.state.status === "waiting" &&
      this.state.lobbyExpiresAt !== undefined &&
      now >= this.state.lobbyExpiresAt
    ) {
      const roomId = this.state.roomId;
      for (const ws of this.ctx.getWebSockets()) {
        this.safeSend(ws, {
          t: "error",
          code: "room_not_found",
          message: "this room expired while waiting for racers",
        });
        try {
          ws.close(ROOM_TERMINAL_CODE, "room_expired");
        } catch {
          // already closed
        }
      }
      await this.deleteActiveRoom(roomId);
      this.state = null;
      await this.ctx.storage.delete("state");
      await this.ctx.storage.deleteAlarm();
      return;
    }

    // Room expiry takes precedence: if nobody's here and the expiry has
    // fired, wipe the room so future connections see "room_not_found".
    if (
      this.state._expiresAt !== undefined &&
      now >= this.state._expiresAt
    ) {
      const liveSeats = this.connectedSeats().size;
      const liveSpectators = this.countSpectatorSockets();

      if (liveSeats + liveSpectators === 0) {
        await this.deleteActiveRoom(this.state.roomId);
        this.state = null;
        await this.ctx.storage.delete("state");
        await this.ctx.storage.deleteAlarm();
        return;
      }

      this.state = {
        ...this.state,
        spectatorCount: liveSpectators,
        _expiresAt: undefined,
      };
      await this.persistState();
      await this.upsertActiveRoom("expiry_cancelled");
      await this.rescheduleAlarm();
      return;
    }

    // Ready-check deadline elapsed → start anyway, as long as enough
    // racers are still connected.
    if (
      this.state.status === "ready_check" &&
      this.state.readyCheckUntil &&
      now >= this.state.readyCheckUntil
    ) {
      if (this.connectedSeats().size >= MIN_PLAYERS) {
        await this.beginCountdown();
      } else {
        this.state = {
          ...this.state,
          status: "waiting",
          readyCheckUntil: undefined,
          lobbyExpiresAt: now + ROOM_EXPIRY_MS,
        };
        await this.persistState();
        await this.rescheduleAlarm();
        this.broadcastCurrentState();
      }
      return;
    }

    // Countdown elapsed → start the race.
    if (
      this.state.status === "starting" &&
      this.state.startAt &&
      now >= this.state.startAt
    ) {
      const startAt = this.state.startAt;
      const next: InternalState = {
        ...this.state,
        status: "racing",
        _players: this.state._players.map((p) => ({
          ...p,
          progress: zeroProgress(),
          finishedAt: undefined,
          ready: false,
        })),
        hardEndAt: startAt + raceCapMs(this.state.config, this.state.passage),
      };
      if (this.state.config.endMode === "time") {
        next.endAt = startAt + this.state.config.timeLimit * 1000;
      }
      this.state = next;
      const racingState = next;
      await this.persistState();
      await this.upsertActiveRoom("race_started");
      await this.trackRaceStarted(racingState.roomId, startAt);
      await safeInsertAnalyticsEvent(
        this.env,
        this.withRoomAnalyticsDefaults(),
        {
          eventName: "race_started",
          eventAt: startAt,
          roomId: racingState.roomId,
          metadata: {
            endMode: racingState.config.endMode,
            passageLength: racingState.config.passageLength,
            timeLimit: racingState.config.timeLimit,
            maxPlayers: racingState.config.maxPlayers,
            playerCount: racingState._players.length,
          },
        }
      );
      this.broadcastCurrentState();
      await this.rescheduleAlarm();
      return;
    }

    // Finish-mode grace elapsed → score everyone where they stand.
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

    // Backstop: nobody is going to finish, so stop waiting on them.
    if (
      this.state.status === "racing" &&
      this.state.hardEndAt &&
      now >= this.state.hardEndAt
    ) {
      await this.endRace("cap");
      return;
    }

    // Shouldn't normally get here, but reschedule just in case something
    // else is still pending.
    await this.rescheduleAlarm();
  }

  /* -------------------- race end & rematch -------------------- */

  private async endRace(
    reason: EndReason,
    excludeSocket?: WebSocket
  ): Promise<void> {
    if (!this.state) return;
    if (this.state.status === "ended") return;

    const connected = this.connectedSeats(excludeSocket);
    const result = normalizeRaceResult(
      computeResult(this.state, reason, connected),
      this.state.passage.text.length
    );
    const snapshotForDb = this.state;
    const endedAt = Date.now();
    this.state = {
      ...this.state,
      status: "ended",
      result,
      finishGrace: undefined,
      endAt: undefined,
      hardEndAt: undefined,
      _players: this.state._players.map((p) => ({ ...p, ready: false })),
    };
    await this.persistState();
    await this.upsertActiveRoom("race_ended");
    await this.recordRaceEnd(snapshotForDb, result, endedAt);
    await safeInsertAnalyticsEvent(
      this.env,
      this.withRoomAnalyticsDefaults(),
      {
        eventName: "race_ended",
        eventAt: endedAt,
        roomId: snapshotForDb.roomId,
        metadata: {
          endReason: result.endReason,
          outcome: outcomeLabel(result),
          endMode: snapshotForDb.config.endMode,
          passageLength: snapshotForDb.config.passageLength,
          playerCount: result.players.length,
          winnerWpm: result.players[0]?.wpm ?? 0,
        },
      }
    );
    await this.rescheduleAlarm();
    this.broadcastCurrentState(excludeSocket);
  }

  private async recordRaceEnd(
    stateAtEnd: InternalState,
    result: RaceResult,
    endedAt: number
  ): Promise<void> {
    const completedSuccessfully = result.endReason === "disconnect" ? 0 : 1;
    const outcome = outcomeLabel(result);
    const analytics = this.env.DB.prepare(
      `UPDATE room_analytics
          SET race_ended_at = COALESCE(race_ended_at, ?),
              race_end_reason = COALESCE(race_end_reason, ?),
              outcome = COALESCE(outcome, ?),
              completed_successfully = CASE
                WHEN completed_successfully = 1 THEN 1
                ELSE ?
              END
        WHERE room_id = ?`
    ).bind(
      endedAt,
      result.endReason,
      outcome,
      completedSuccessfully,
      stateAtEnd.roomId
    );

    if (stateAtEnd._source === "load_test") {
      await analytics.run();
      return;
    }

    const raceId = `${stateAtEnd.roomId}:${endedAt}`;
    const duration = result.players.reduce(
      (max, p) => Math.max(max, p.elapsedMs),
      0
    );
    const bySeat = new Map(result.players.map((p) => [p.seat, p]));
    const seatZero = bySeat.get(0);
    const seatOne = bySeat.get(1);

    // seats 0/1 stay in the races row so /recent keeps working for the
    // two-player case; everything else lives in race_players.
    const recent = this.env.DB.prepare(
      `INSERT OR REPLACE INTO races (
         id, finished_at, end_reason, outcome,
         passage_id, passage_length, passage_words,
         duration_ms,
         host_wpm, guest_wpm,
         host_accuracy, guest_accuracy,
         host_finished, guest_finished,
         player_count, winner_seat
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      raceId,
      endedAt,
      result.endReason,
      outcome,
      stateAtEnd.passage.id,
      stateAtEnd.config.passageLength,
      stateAtEnd.passage.wordCount,
      duration,
      seatZero?.wpm ?? 0,
      seatOne?.wpm ?? 0,
      seatZero?.accuracy ?? 0,
      seatOne?.accuracy ?? 0,
      seatZero?.finishedPassage ? 1 : 0,
      seatOne?.finishedPassage ? 1 : 0,
      result.players.length,
      result.winnerSeat
    );

    const perPlayer = result.players.map((p) =>
      this.env.DB.prepare(
        `INSERT OR REPLACE INTO race_players (
           race_id, seat, place, wpm, accuracy,
           elapsed_ms, correct_chars, finished, dnf
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        raceId,
        p.seat,
        p.place,
        p.wpm,
        p.accuracy,
        p.elapsedMs,
        p.correctCount,
        p.finishedPassage ? 1 : 0,
        p.dnf ? 1 : 0
      )
    );

    await this.env.DB.batch([analytics, recent, ...perPlayer]);
  }

  /** Transition into the 3-2-1 starting countdown. */
  private async beginCountdown(): Promise<void> {
    if (!this.state) return;
    if (this.state.status !== "ready_check" && this.state.status !== "waiting") {
      return;
    }
    this.state = {
      ...this.state,
      status: "starting",
      startAt: Date.now() + START_BUFFER_MS,
      readyCheckUntil: undefined,
      lobbyExpiresAt: undefined,
    };
    await this.persistState();
    await this.upsertActiveRoom("countdown_started");
    await this.rescheduleAlarm();
    this.broadcastCurrentState();
  }

  private async startRematch(): Promise<void> {
    if (!this.state) return;
    const newPassage = pickPassage(
      this.state.config.passageLength,
      this.state.passage.id
    );
    const startAt = Date.now() + START_BUFFER_MS;
    const connected = this.connectedSeats();

    this.state = {
      roomId: this.state.roomId,
      passage: newPassage,
      config: this.state.config,
      status: "starting",
      spectatorCount: this.state.spectatorCount,
      createdAt: this.state.createdAt,
      startAt,
      // Racers who left give up their seat at rematch time, which reopens
      // the room for someone new.
      _players: this.state._players
        .filter((p) => connected.has(p.seat))
        .map((p) => ({
          ...p,
          ready: false,
          droppedAt: undefined,
          progress: zeroProgress(),
          finishedAt: undefined,
        })),
      _source: this.state._source,
    };
    await this.persistState();
    await this.upsertActiveRoom("rematch_started");
    await this.rescheduleAlarm();
    this.broadcastCurrentState();
  }

  /* -------------------- state shaping -------------------- */

  private toPublic(except?: WebSocket): PublicRoomState {
    const s = this.state;
    if (!s) throw new Error("toPublic called without state");
    const connected = this.connectedSeats(except);

    const players: PlayerSlot[] = s._players
      .map((p) => ({
        seat: p.seat,
        isHost: p.isHost,
        connected: connected.has(p.seat),
        droppedAt: p.droppedAt,
        ready: p.ready,
        finished: p.finishedAt !== undefined,
      }))
      .sort((a, b) => a.seat - b.seat);

    const rematchReady =
      s.status === "ended"
        ? s._players.filter((p) => p.ready).map((p) => p.seat)
        : undefined;

    return {
      roomId: s.roomId,
      passage: s.passage,
      config: s.config,
      status: s.status,
      players,
      playerCount: players.length,
      connectedCount: connected.size,
      spectatorCount: s.spectatorCount,
      createdAt: s.createdAt,
      lobbyExpiresAt: s.lobbyExpiresAt,
      readyCheckUntil: s.readyCheckUntil,
      startAt: s.startAt,
      endAt: s.endAt,
      hardEndAt: s.hardEndAt,
      result: s.result,
      rematchReady:
        rematchReady && rematchReady.length > 0 ? rematchReady : undefined,
      finishGrace: s.finishGrace,
      serverNow: Date.now(),
    };
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

  private broadcastCurrentState(except?: WebSocket): void {
    if (!this.state) return;
    const msg: ServerMsg = { t: "state", room: this.toPublic(except) };
    if (except) {
      this.broadcastExcept(except, msg);
    } else {
      this.broadcast(msg);
    }
  }

  /** Seats with at least one live socket right now. */
  private connectedSeats(except?: WebSocket): Set<Seat> {
    const seats = new Set<Seat>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const att = normalizeAttachment(ws);
      if (att?.kind === "player") seats.add(att.seat);
    }
    return seats;
  }

  private countSpectatorSockets(except?: WebSocket): number {
    let count = 0;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const att = normalizeAttachment(ws);
      if (att?.kind === "spectator") count += 1;
    }
    return count;
  }

  /** Catch a joining or rejoining connection up on where everyone is. */
  private sendProgressSnapshot(ws: WebSocket, exceptSeat?: Seat): void {
    if (!this.state) return;
    for (const p of this.state._players) {
      if (p.seat === exceptSeat) continue;
      if (p.progress.at === 0 && p.finishedAt === undefined) continue;
      this.safeSend(ws, {
        t: "player_progress",
        seat: p.seat,
        pos: p.progress.pos,
        correctCount: p.progress.correctCount,
        wpm: p.progress.wpm,
        accuracy: p.progress.accuracy,
      });
      if (p.finishedAt !== undefined) {
        this.safeSend(ws, {
          t: "player_finished",
          seat: p.seat,
          wpm: p.progress.wpm,
          accuracy: p.progress.accuracy,
          elapsedMs: Math.max(0, p.finishedAt - (this.state.startAt ?? p.finishedAt)),
        });
      }
    }
  }

  private async persistState(): Promise<void> {
    if (!this.state) return;
    await this.ctx.storage.put("state", this.state);
  }

  private async maybePersistProgress(now: number): Promise<void> {
    if (!this.state) return;
    if (now - this.lastProgressPersistAt < PROGRESS_PERSIST_INTERVAL_MS) return;

    this.lastProgressPersistAt = now;
    const snapshot = this.state;
    try {
      await this.ctx.storage.put("state", snapshot);
    } catch (error) {
      console.warn(
        `[room ${snapshot.roomId}] progress snapshot persist failed: ${String(error)}`
      );
    }
  }

  private safeSend(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket closed or closing — ignore
    }
  }

  private withRoomAnalyticsDefaults(
    context?: AnalyticsContext
  ): AnalyticsContext {
    return {
      ...context,
      path: context?.path ?? `/room/${this.state?.roomId ?? ""}`,
      source: this.state?._source ?? context?.source ?? "user",
    };
  }

  private async trackRoomCreated(state: InternalState): Promise<void> {
    await this.env.DB.prepare(
      `INSERT OR IGNORE INTO room_analytics (
         room_id,
         created_at,
         source,
         config_end_mode,
         config_passage_length,
         config_time_limit,
         config_max_players
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        state.roomId,
        state.createdAt,
        state._source,
        state.config.endMode,
        state.config.passageLength,
        state.config.timeLimit,
        state.config.maxPlayers
      )
      .run();
  }

  private async upsertActiveRoom(lastEvent: string): Promise<void> {
    if (!this.state) return;
    const state = this.state;
    const connected = this.connectedSeats();
    await this.env.DB.prepare(
      `INSERT OR REPLACE INTO active_rooms (
         room_id,
         created_at,
         updated_at,
         status,
         source,
         config_end_mode,
         config_passage_length,
         config_time_limit,
         config_max_players,
         passage_id,
         passage_words,
         player_count,
         connected_count,
         spectator_count,
         host_connected,
         guest_connected,
         race_started_at,
         race_ended_at,
         last_event,
         expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        state.roomId,
        state.createdAt,
        Date.now(),
        state.status,
        state._source,
        state.config.endMode,
        state.config.passageLength,
        state.config.timeLimit,
        state.config.maxPlayers,
        state.passage.id,
        state.passage.wordCount,
        state._players.length,
        connected.size,
        state.spectatorCount,
        connected.has(0) ? 1 : 0,
        connected.has(1) ? 1 : 0,
        state.startAt ?? null,
        state.result ? Date.now() : null,
        lastEvent,
        state._expiresAt ?? null
      )
      .run();
  }

  private async deleteActiveRoom(roomId: string): Promise<void> {
    await this.env.DB.prepare(`DELETE FROM active_rooms WHERE room_id = ?`)
      .bind(roomId)
      .run();
  }

  private async trackSeatJoin(
    roomId: string,
    seat: Seat,
    firstJoinForSeat: boolean
  ): Promise<void> {
    if (!firstJoinForSeat) return;
    const timestampColumn =
      seat === 0 ? "host_joined_at" : seat === 1 ? "guest_joined_at" : null;
    const sql = timestampColumn
      ? `UPDATE room_analytics
            SET players_joined_count = players_joined_count + 1,
                ${timestampColumn} = COALESCE(${timestampColumn}, ?)
          WHERE room_id = ?`
      : `UPDATE room_analytics
            SET players_joined_count = players_joined_count + 1
          WHERE room_id = ?`;
    const statement = this.env.DB.prepare(sql);
    await (timestampColumn
      ? statement.bind(Date.now(), roomId)
      : statement.bind(roomId)
    ).run();
  }

  private async trackSpectatorJoin(
    roomId: string,
    joinedAt: number,
    concurrentSpectators: number
  ): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE room_analytics
          SET spectator_join_count = spectator_join_count + 1,
              first_spectator_joined_at = COALESCE(first_spectator_joined_at, ?),
              spectator_max_concurrent = MAX(spectator_max_concurrent, ?)
        WHERE room_id = ?`
    )
      .bind(joinedAt, concurrentSpectators, roomId)
      .run();
  }

  private async trackSpectatorLeave(
    roomId: string,
    joinedAt: number,
    leftAt: number
  ): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE room_analytics
          SET spectator_leave_count = spectator_leave_count + 1,
              last_spectator_left_at = ?,
              spectator_watch_ms_total = spectator_watch_ms_total + ?
        WHERE room_id = ?`
    )
      .bind(leftAt, Math.max(0, leftAt - joinedAt), roomId)
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

  private async trackPreStartDrop(roomId: string, seat: Seat): Promise<void> {
    const seatColumn =
      seat === 0
        ? "host_pre_start_drop_count"
        : seat === 1
          ? "guest_pre_start_drop_count"
          : null;
    const sql = seatColumn
      ? `UPDATE room_analytics
            SET pre_start_drop_count = pre_start_drop_count + 1,
                ${seatColumn} = ${seatColumn} + 1
          WHERE room_id = ?`
      : `UPDATE room_analytics
            SET pre_start_drop_count = pre_start_drop_count + 1
          WHERE room_id = ?`;
    await this.env.DB.prepare(sql).bind(roomId).run();
  }
}

/* -------------------- scoring -------------------- */

function outcomeLabel(result: RaceResult): string {
  if (result.winnerSeat === null) return "tie";
  // Two-player rooms keep the historical labels so existing analytics and
  // the /recent feed don't need to special-case old rows.
  if (result.players.length === 2) {
    return result.winnerSeat === 0 ? "host_wins" : "guest_wins";
  }
  return `seat_${result.winnerSeat}`;
}

function computeResult(
  s: InternalState,
  endReason: EndReason,
  connected: Set<Seat>
): RaceResult {
  const startAt = s.startAt ?? Date.now();
  const now = Date.now();

  const scored = s._players.map((p) => {
    const finished = p.finishedAt !== undefined;
    const elapsedMs = finished
      ? Math.max(0, (p.finishedAt as number) - startAt)
      : Math.max(0, now - startAt);
    // Left mid-race and never came back.
    const dnf = !finished && p.droppedAt !== undefined && !connected.has(p.seat);

    return {
      seat: p.seat,
      wpm: calcOfficialWpm(p.progress.correctCount, elapsedMs),
      accuracy: p.progress.accuracy,
      elapsedMs,
      pos: p.progress.pos,
      correctCount: p.progress.correctCount,
      finishedPassage: finished,
      dnf,
      finishedAt: p.finishedAt,
    };
  });

  type Scored = (typeof scored)[number];
  const compare = (a: Scored, b: Scored): number =>
    comparePlayers(a, b, s.config.endMode);

  scored.sort(compare);

  const players: PlayerResult[] = [];
  let place = 0;
  scored.forEach((entry, index) => {
    const previous = scored[index - 1];
    // Tied entries share the place; the next distinct entry skips ahead.
    if (index === 0 || compare(previous, entry) !== 0) {
      place = index + 1;
    }
    players.push({
      seat: entry.seat,
      wpm: entry.wpm,
      accuracy: entry.accuracy,
      elapsedMs: entry.elapsedMs,
      pos: entry.pos,
      correctCount: entry.correctCount,
      finishedPassage: entry.finishedPassage,
      place,
      dnf: entry.dnf,
    });
  });

  const sharedTop = players.length > 1 && players[1].place === players[0].place;
  const winnerSeat =
    players.length === 0 || sharedTop || players[0].dnf
      ? null
      : players[0].seat;

  return { endReason, players, winnerSeat };
}

function normalizeRaceResult(
  result: RaceResult,
  passageLength: number
): RaceResult {
  const players = result.players.map((player, index) => ({
    seat: finiteInteger(player.seat, index, 0, 3),
    wpm: finiteInteger(player.wpm, 0, 0, 1_000_000),
    accuracy:
      Math.round(finiteNumber(player.accuracy, 0, 0, 100) * 10) / 10,
    elapsedMs: finiteInteger(
      player.elapsedMs,
      0,
      0,
      Number.MAX_SAFE_INTEGER
    ),
    pos: finiteInteger(player.pos, 0, 0, passageLength),
    correctCount: finiteInteger(
      player.correctCount,
      0,
      0,
      passageLength
    ),
    finishedPassage: player.finishedPassage === true,
    place: finiteInteger(player.place, index + 1, 1, 4),
    dnf: player.dnf === true,
  }));
  const winnerSeat =
    typeof result.winnerSeat === "number" &&
    Number.isInteger(result.winnerSeat) &&
    players.some((player) => player.seat === result.winnerSeat)
      ? result.winnerSeat
      : null;

  return { endReason: result.endReason, players, winnerSeat };
}

interface ComparablePlayer {
  wpm: number;
  accuracy: number;
  elapsedMs: number;
  correctCount: number;
  finishedPassage: boolean;
  dnf: boolean;
  finishedAt?: number;
}

/** Negative when `a` ranks ahead of `b`; zero when they are truly tied. */
function comparePlayers(
  a: ComparablePlayer,
  b: ComparablePlayer,
  endMode: EndMode
): number {
  if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;

  if (endMode === "finish") {
    const scoreDelta = finishModeScore(b) - finishModeScore(a);
    if (Math.abs(scoreDelta) > 0.01) return scoreDelta;
  } else {
    if (a.wpm !== b.wpm) return b.wpm - a.wpm;
  }

  if (a.finishedPassage !== b.finishedPassage) {
    return a.finishedPassage ? -1 : 1;
  }
  if (a.correctCount !== b.correctCount) {
    return b.correctCount - a.correctCount;
  }

  const aFinishedAt = a.finishedAt ?? Number.POSITIVE_INFINITY;
  const bFinishedAt = b.finishedAt ?? Number.POSITIVE_INFINITY;
  if (aFinishedAt !== bFinishedAt) return aFinishedAt - bFinishedAt;

  if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;

  return 0;
}

function finishModeScore(result: {
  wpm: number;
  accuracy: number;
}): number {
  const accuracyWeight = result.accuracy / 100;
  return result.wpm * accuracyWeight * accuracyWeight;
}

function elapsedSinceStart(state: InternalState, at: number): number {
  return Math.max(0, at - (state.startAt ?? at));
}

function calcOfficialWpm(correctChars: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return Math.round(correctChars / 5 / (elapsedMs / 60_000));
}
