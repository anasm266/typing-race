const API_URL = process.env.API_URL ?? "http://localhost:8787";
const WS_URL = process.env.WS_URL ?? API_URL.replace(/^http/, "ws");
const TIMEOUT_MS = 8000;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createRoom() {
  const res = await fetch(`${API_URL}/room`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      config: {
        endMode: "time",
        passageLength: "short",
        timeLimit: 30,
      },
    }),
  });
  assert(res.ok, `create room failed: ${res.status}`);
  return res.json();
}

function connectRoom(roomId, token) {
  const url = new URL(
    `${WS_URL}/room/${encodeURIComponent(roomId)}/ws`
  );
  if (token) url.searchParams.set("token", token);

  const ws = new WebSocket(url);
  const messages = [];
  const waiters = [];

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    messages.push(msg);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(msg)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(msg);
      }
    }
  });

  ws.addEventListener("close", (event) => {
    for (const waiter of [...waiters]) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.reject(
        new Error(`socket closed: ${event.code} ${event.reason}`)
      );
    }
  });

  function waitFor(predicate, label, timeoutMs = TIMEOUT_MS) {
    const found = messages.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = waiters.indexOf(waiter);
        if (idx !== -1) waiters.splice(idx, 1);
        reject(new Error(`timed out waiting for ${label}`));
      }, timeoutMs);
      const waiter = {
        predicate,
        resolve: (msg) => {
          clearTimeout(timeout);
          resolve(msg);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      };
      waiters.push(waiter);
    });
  }

  return {
    ws,
    messages,
    waitFor,
    send: (msg) => ws.send(JSON.stringify(msg)),
    close: () => ws.close(),
  };
}

async function main() {
  assert(
    typeof WebSocket === "function",
    "Node 22+ global WebSocket is required"
  );

  const { roomId } = await createRoom();
  const host = connectRoom(roomId);
  const hostWelcome = await host.waitFor(
    (msg) => msg.t === "welcome" && msg.role === "host",
    "host welcome"
  );

  const guest = connectRoom(roomId);
  const guestWelcome = await guest.waitFor(
    (msg) => msg.t === "welcome" && msg.role === "guest",
    "guest welcome"
  );

  assert(hostWelcome.sessionToken, "host token missing");
  assert(guestWelcome.sessionToken, "guest token missing");

  const spectator = connectRoom(roomId);
  await spectator.waitFor(
    (msg) => msg.t === "spectator_welcome",
    "spectator welcome"
  );
  const spectatorState = await spectator.waitFor(
    (msg) =>
      msg.t === "state" &&
      msg.room.playerCount === 2 &&
      msg.room.spectatorCount === 1,
    "spectator state"
  );
  assert(
    spectatorState.room.status === "ready_check",
    "room should be in ready check"
  );

  spectator.send({ t: "lock_in" });
  await wait(250);
  assert(
    !spectator.messages.some(
      (msg) => msg.t === "state" && msg.room.status === "starting"
    ),
    "spectator should not be able to start countdown"
  );

  const extraSpectators = [];
  for (let i = 0; i < 24; i += 1) {
    const extra = connectRoom(roomId);
    await extra.waitFor(
      (msg) => msg.t === "spectator_welcome",
      `extra spectator ${i + 2}`
    );
    extraSpectators.push(extra);
  }

  const overflow = connectRoom(roomId);
  await overflow.waitFor(
    (msg) => msg.t === "error" && msg.code === "spectator_full",
    "spectator full error"
  );
  overflow.close();

  guest.send({ t: "lock_in" });
  await spectator.waitFor(
    (msg) => msg.t === "state" && msg.room.status === "racing",
    "racing state"
  );

  host.send({
    t: "progress",
    pos: 5,
    correctCount: 5,
    wpm: 70,
    accuracy: 100,
  });
  guest.send({
    t: "progress",
    pos: 3,
    correctCount: 3,
    wpm: 48,
    accuracy: 96,
  });

  await spectator.waitFor(
    (msg) =>
      msg.t === "player_progress" &&
      msg.role === "host" &&
      msg.pos === 5,
    "host role-tagged progress"
  );
  await spectator.waitFor(
    (msg) =>
      msg.t === "player_progress" &&
      msg.role === "guest" &&
      msg.pos === 3,
    "guest role-tagged progress"
  );

  spectator.send({
    t: "progress",
    pos: 99,
    correctCount: 99,
    wpm: 999,
    accuracy: 100,
  });
  await wait(250);
  assert(
    !host.messages.some(
      (msg) => msg.t === "opponent_progress" && msg.pos === 99
    ),
    "spectator progress should not reach players"
  );

  host.close();
  guest.close();
  spectator.close();
  for (const extra of extraSpectators) extra.close();

  console.log(`spectator smoke passed for room ${roomId}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
