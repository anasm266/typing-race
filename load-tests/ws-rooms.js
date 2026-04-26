/**
 * WebSocket load test for typing-race.
 *
 * Simulates N concurrent rooms with a real host+guest pair, drives each room
 * through ready-check into a time-mode race, then keeps both sockets active
 * until the server ends the room.
 *
 * Usage (local):
 *   k6 run load-tests/ws-rooms.js
 *
 * Usage (Docker, no local install needed):
 *   docker run --rm -i grafana/k6 run --vus 50 --duration 60s - < load-tests/ws-rooms.js
 *
 * Env vars:
 *   API_URL  HTTP origin of the Worker (default: local worker)
 *   WS_URL   WebSocket origin of the Worker (default: local worker)
 *
 * CI must set both URLs explicitly and must not target production.
 */

import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { WebSocket } from "k6/websockets";

const API_URL = __ENV.API_URL || "http://localhost:8787";
const WS_URL = __ENV.WS_URL || "ws://localhost:8787";

const TIME_LIMIT_S = 30;
const ROOM_TIMEOUT_MS = 45_000;
const CLOSE_AFTER_END_MS = 250;
const PING_INTERVAL_MS = 1_000;
const PROGRESS_INTERVAL_MS = 1_000;

const roomsCreated = new Counter("rooms_created");
const wsOpened = new Counter("ws_opened");
const wsErrors = new Counter("ws_errors");
const unexpectedSocketCloses = new Counter("unexpected_socket_closes");
const messageRoundTripMs = new Trend("message_round_trip_ms");
const welcomeOk = new Rate("welcome_ok");
const bothWelcomedOk = new Rate("both_welcomed_ok");
const raceStartedOk = new Rate("race_started_ok");
const raceEndedOk = new Rate("race_ended_ok");

export const options = {
  scenarios: {
    ramp_concurrent_rooms: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 25 },
        { duration: "30s", target: 25 },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "45s",
    },
  },
  thresholds: {
    welcome_ok: ["rate>0.98"],
    both_welcomed_ok: ["rate>0.98"],
    race_started_ok: ["rate>0.95"],
    race_ended_ok: ["rate>0.95"],
    message_round_trip_ms: ["p(95)<300"],
    http_req_failed: ["rate<0.02"],
  },
};

export default function () {
  const createRes = http.post(
    `${API_URL}/room`,
    JSON.stringify({
      source: "load_test",
      config: {
        endMode: "time",
        timeLimit: TIME_LIMIT_S,
        passageLength: "short",
      },
    }),
    { headers: { "Content-Type": "application/json" } }
  );

  const ok = check(createRes, {
    "room created (200)": (r) => r.status === 200,
    "returns roomId": (r) => {
      try {
        return typeof r.json("roomId") === "string";
      } catch {
        return false;
      }
    },
  });
  if (!ok) return;

  roomsCreated.add(1);
  const roomId = createRes.json("roomId");
  startRoomSession(roomId);
}

function startRoomSession(roomId) {
  const session = {
    finalized: false,
    timedOut: false,
    roomEnded: false,
    guestLockedIn: false,
    closedPlayers: 0,
    bothWelcomedRecorded: false,
    raceStartedRecorded: false,
    raceEndedRecorded: false,
    timeoutId: null,
    host: createPlayer(roomId, "host", 72, 98, 6),
    guest: createPlayer(roomId, "guest", 66, 96, 5),
  };

  attachPlayer(session, session.host);
  attachPlayer(session, session.guest);

  session.timeoutId = setTimeout(() => {
    session.timedOut = true;
    finalizeSession(session);
    closePlayer(session.host, true);
    closePlayer(session.guest, true);
  }, ROOM_TIMEOUT_MS);
}

function createPlayer(roomId, label, wpm, accuracy, progressStep) {
  return {
    label,
    welcomed: false,
    closing: false,
    closed: false,
    pingIntervalId: null,
    progressIntervalId: null,
    pendingPingAt: 0,
    progressPos: 0,
    progressStep,
    wpm,
    accuracy,
    ws: new WebSocket(`${WS_URL}/room/${roomId}/ws`),
  };
}

function attachPlayer(session, player) {
  player.ws.addEventListener("open", () => {
    wsOpened.add(1);
    sendJson(player, { t: "hello" });
    player.pingIntervalId = setInterval(() => {
      player.pendingPingAt = Date.now();
      sendJson(player, { t: "ping" });
    }, PING_INTERVAL_MS);
  });

  player.ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.t === "welcome") {
      if (!player.welcomed) {
        player.welcomed = true;
        welcomeOk.add(1);
      }
      maybeLockIn(session);
      return;
    }

    if (msg.t === "state") {
      handleRoomState(session, msg.room);
      maybeLockIn(session);
      return;
    }

    if (msg.t === "pong" && player.pendingPingAt > 0) {
      messageRoundTripMs.add(Date.now() - player.pendingPingAt);
      player.pendingPingAt = 0;
    }
  });

  player.ws.addEventListener("close", () => {
    if (!player.welcomed) {
      welcomeOk.add(0);
    }

    stopPlayerTimers(player);

    if (!session.roomEnded && !session.timedOut && !player.closing) {
      unexpectedSocketCloses.add(1);
    }

    if (!player.closed) {
      player.closed = true;
      session.closedPlayers += 1;
    }

    if (session.closedPlayers >= 2) {
      finalizeSession(session);
    }
  });

  player.ws.addEventListener("error", () => {
    wsErrors.add(1);
  });
}

function maybeLockIn(session) {
  if (session.guestLockedIn) return;
  if (!session.host.welcomed || !session.guest.welcomed) return;

  session.guestLockedIn = true;
  recordBothWelcomed(session, true);
  sendJson(session.guest, { t: "lock_in" });
}

function handleRoomState(session, room) {
  if (room.status === "racing") {
    recordRaceStarted(session, true);
    startProgress(session.host);
    startProgress(session.guest);
    return;
  }

  if (room.status === "ended") {
    session.roomEnded = true;
    recordRaceEnded(session, true);
    setTimeout(() => {
      closePlayer(session.host, true);
      closePlayer(session.guest, true);
    }, CLOSE_AFTER_END_MS);
  }
}

function startProgress(player) {
  if (player.progressIntervalId !== null) return;

  sendProgress(player);
  player.progressIntervalId = setInterval(() => {
    sendProgress(player);
  }, PROGRESS_INTERVAL_MS);
}

function sendProgress(player) {
  player.progressPos += player.progressStep;
  sendJson(player, {
    t: "progress",
    pos: player.progressPos,
    correctCount: player.progressPos,
    wpm: player.wpm,
    accuracy: player.accuracy,
  });
}

function sendJson(player, payload) {
  try {
    player.ws.send(JSON.stringify(payload));
  } catch {
    // socket already closed
  }
}

function closePlayer(player, expected) {
  if (player.closed || player.closing) return;
  player.closing = expected;
  stopPlayerTimers(player);
  try {
    player.ws.close();
  } catch {
    player.closed = true;
  }
}

function stopPlayerTimers(player) {
  if (player.pingIntervalId !== null) {
    clearInterval(player.pingIntervalId);
    player.pingIntervalId = null;
  }
  if (player.progressIntervalId !== null) {
    clearInterval(player.progressIntervalId);
    player.progressIntervalId = null;
  }
}

function finalizeSession(session) {
  if (session.finalized) return;
  session.finalized = true;

  if (session.timeoutId !== null) {
    clearTimeout(session.timeoutId);
    session.timeoutId = null;
  }

  recordBothWelcomed(session, false);
  recordRaceStarted(session, false);
  recordRaceEnded(session, false);
}

function recordBothWelcomed(session, ok) {
  if (session.bothWelcomedRecorded) return;
  session.bothWelcomedRecorded = true;
  bothWelcomedOk.add(ok ? 1 : 0);
}

function recordRaceStarted(session, ok) {
  if (session.raceStartedRecorded) return;
  session.raceStartedRecorded = true;
  raceStartedOk.add(ok ? 1 : 0);
}

function recordRaceEnded(session, ok) {
  if (session.raceEndedRecorded) return;
  session.raceEndedRecorded = true;
  raceEndedOk.add(ok ? 1 : 0);
}
