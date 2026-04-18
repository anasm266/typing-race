/**
 * WebSocket load test for typing-race.
 *
 * Simulates N concurrent rooms each with a host+guest WebSocket, holding
 * a realistic progress broadcast rate for ~20s before disconnecting.
 *
 * Usage (local):
 *   k6 run load-tests/ws-rooms.js
 *
 * Usage (Docker, no local install needed):
 *   docker run --rm -i grafana/k6 run --vus 50 --duration 60s - < load-tests/ws-rooms.js
 *
 * Env vars:
 *   API_URL  HTTP origin of the Worker (default: deployed prod)
 *   WS_URL   WebSocket origin of the Worker (default: deployed prod)
 */

import http from "k6/http";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const API_URL =
  __ENV.API_URL || "https://typing-race-api.kingzcopz266.workers.dev";
const WS_URL =
  __ENV.WS_URL ||
  "wss://typing-race-api.kingzcopz266.workers.dev";

const roomsCreated = new Counter("rooms_created");
const wsOpened = new Counter("ws_opened");
const wsErrors = new Counter("ws_errors");
const messageRoundTripMs = new Trend("message_round_trip_ms");
const welcomeOk = new Rate("welcome_ok");

export const options = {
  scenarios: {
    ramp_concurrent_rooms: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 25 }, // ramp up
        { duration: "30s", target: 25 }, // hold
        { duration: "10s", target: 0 }, // ramp down
      ],
    },
  },
  thresholds: {
    "welcome_ok": ["rate>0.98"],
    "message_round_trip_ms": ["p(95)<300"],
    "http_req_failed": ["rate<0.02"],
  },
};

export default function () {
  // 1) Create a room via the HTTP API
  const createRes = http.post(
    `${API_URL}/room`,
    JSON.stringify({ config: { passageLength: "short" } }),
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

  // 2) Open host WebSocket and hold for ~20s exchanging progress messages.
  runSession(roomId, "host");

  // Slight stagger before guest joins so the countdown fires.
  sleep(0.2);
  runSession(roomId, "guest");
}

function runSession(roomId, label) {
  const url = `${WS_URL}/room/${roomId}/ws`;

  const res = ws.connect(url, null, (socket) => {
    let welcomed = false;
    let pendingSendAt = 0;

    socket.on("open", () => {
      wsOpened.add(1);
      socket.send(JSON.stringify({ t: "hello" }));

      // send periodic progress pings (simulates typing) + measure round-trip
      socket.setInterval(() => {
        pendingSendAt = Date.now();
        socket.send(JSON.stringify({ t: "ping" }));
      }, 1000);

      // Close the session after ~20s.
      socket.setTimeout(() => {
        socket.close();
      }, 20_000);
    });

    socket.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (msg.t === "welcome") {
        welcomed = true;
        welcomeOk.add(1);
      } else if (msg.t === "pong" && pendingSendAt > 0) {
        messageRoundTripMs.add(Date.now() - pendingSendAt);
        pendingSendAt = 0;
      }
    });

    socket.on("close", () => {
      if (!welcomed) welcomeOk.add(0);
    });

    socket.on("error", () => {
      wsErrors.add(1);
    });
  });

  check(res, {
    [`${label}: ws handshake 101`]: (r) => r && r.status === 101,
  });
}
