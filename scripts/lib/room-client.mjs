export const API_URL = process.env.API_URL ?? "http://localhost:8787";
export const WS_URL = process.env.WS_URL ?? API_URL.replace(/^http/, "ws");
export const TIMEOUT_MS = 8000;

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createRoom(config = {}) {
  const res = await fetch(`${API_URL}/room`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
  assert(res.ok, `create room failed: ${res.status}`);
  return res.json();
}

/**
 * Opens a room socket and records every message, so a test can wait for a
 * condition that may already have been satisfied before it started waiting.
 */
export function connectRoom(roomId, token) {
  const url = new URL(`${WS_URL}/room/${encodeURIComponent(roomId)}/ws`);
  if (token) url.searchParams.set("token", token);

  const ws = new WebSocket(url);
  const messages = [];
  const waiters = [];
  let closeEvent = null;
  const closeWaiters = [];

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
    closeEvent = event;
    for (const resolve of closeWaiters.splice(0)) resolve(event);
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
    latestState: () =>
      [...messages].reverse().find((msg) => msg.t === "state")?.room,
    send: (msg) => ws.send(JSON.stringify(msg)),
    waitForClose: (timeoutMs = TIMEOUT_MS) => {
      if (closeEvent) return Promise.resolve(closeEvent);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("timed out waiting for socket close")),
          timeoutMs
        );
        closeWaiters.push((event) => {
          clearTimeout(timeout);
          resolve(event);
        });
      });
    },
    close: () => ws.close(),
  };
}

export function requireWebSocket() {
  assert(
    typeof WebSocket === "function",
    "Node 22+ global WebSocket is required"
  );
}
