import {
  assert,
  connectRoom,
  createRoom,
  requireWebSocket,
  wait,
} from "./lib/room-client.mjs";

async function main() {
  requireWebSocket();

  const { roomId } = await createRoom({
    endMode: "time",
    passageLength: "short",
    timeLimit: 30,
    maxPlayers: 2,
  });
  const host = connectRoom(roomId);
  const hostWelcome = await host.waitFor(
    (msg) => msg.t === "welcome" && msg.seat === 0 && msg.isHost,
    "host welcome"
  );

  const guest = connectRoom(roomId);
  const guestWelcome = await guest.waitFor(
    (msg) => msg.t === "welcome" && msg.seat === 1,
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
      msg.t === "player_progress" && msg.seat === 0 && msg.pos === 5,
    "seat 0 progress"
  );
  await spectator.waitFor(
    (msg) =>
      msg.t === "player_progress" && msg.seat === 1 && msg.pos === 3,
    "seat 1 progress"
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
      (msg) => msg.t === "player_progress" && msg.pos === 99
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
