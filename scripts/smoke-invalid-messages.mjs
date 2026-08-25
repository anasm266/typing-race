import {
  assert,
  connectRoom,
  createRoom,
  requireWebSocket,
} from "./lib/room-client.mjs";

requireWebSocket();

async function testMalformedProgress() {
  const { roomId } = await createRoom({
    endMode: "finish",
    passageLength: "short",
    maxPlayers: 2,
  });
  const host = connectRoom(roomId);
  const hostWelcome = await host.waitFor(
    (msg) => msg.t === "welcome",
    "host welcome"
  );
  const guest = connectRoom(roomId);
  const guestWelcome = await guest.waitFor(
    (msg) => msg.t === "welcome",
    "guest welcome"
  );
  assert(hostWelcome.seat === 0, "expected host seat");
  assert(guestWelcome.seat === 1, "expected guest seat");

  guest.send({ t: "lock_in" });
  await host.waitFor(
    (msg) => msg.t === "state" && msg.room.status === "racing",
    "race start"
  );

  guest.send({
    t: "progress",
    pos: 1,
    correctCount: 1,
    accuracy: { malicious: true },
  });
  const close = await guest.waitForClose();
  assert(close.code === 1008, `expected close 1008, got ${close.code}`);

  await host.waitFor(
    (msg) =>
      msg.t === "state" &&
      msg.room.status === "racing" &&
      msg.room.players.some(
        (player) => player.seat === 1 && player.connected === false
      ),
    "malformed guest disconnect state"
  );

  const rejoined = connectRoom(roomId, guestWelcome.sessionToken);
  const rejoinWelcome = await rejoined.waitFor(
    (msg) => msg.t === "welcome",
    "guest reconnect"
  );
  assert(rejoinWelcome.seat === 1, "guest should retain its held seat");
  rejoined.send({ t: "progress", pos: 1, correctCount: 1, accuracy: 100 });

  host.close();
  rejoined.close();
  console.log("  malformed progress closes only the offender: ok");
}

async function testOversizedMessage() {
  const { roomId } = await createRoom({ maxPlayers: 2 });
  const client = connectRoom(roomId);
  await client.waitFor((msg) => msg.t === "welcome", "oversized test welcome");
  client.ws.send(
    JSON.stringify({ t: "hello", padding: "x".repeat(5 * 1024) })
  );
  const close = await client.waitForClose();
  assert(close.code === 1009, `expected close 1009, got ${close.code}`);
  console.log("  oversized message closes with 1009: ok");
}

async function testBinaryMessage() {
  const { roomId } = await createRoom({ maxPlayers: 2 });
  const client = connectRoom(roomId);
  await client.waitFor((msg) => msg.t === "welcome", "binary test welcome");
  client.ws.send(new Uint8Array([1, 2, 3]));
  const close = await client.waitForClose();
  assert(close.code === 1008, `expected close 1008, got ${close.code}`);
  console.log("  binary message closes with 1008: ok");
}

console.log("invalid WebSocket message smoke tests");
await testMalformedProgress();
await testOversizedMessage();
await testBinaryMessage();
console.log("invalid message smoke tests passed");
