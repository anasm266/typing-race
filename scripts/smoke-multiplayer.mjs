/**
 * End-to-end checks for 3-4 seat rooms:
 *   1. a full four-seat room auto-starts and produces ranked standings
 *   2. the host can start early with fewer than every seat filled
 *   3. a racer who drops mid-race keeps their seat and can rejoin
 */
import {
  assert,
  connectRoom,
  createRoom,
  requireWebSocket,
  wait,
} from "./lib/room-client.mjs";

const RACE_CONFIG = {
  endMode: "finish",
  passageLength: "short",
  maxPlayers: 4,
};

async function joinSeats(roomId, count) {
  const players = [];
  for (let i = 0; i < count; i += 1) {
    const player = connectRoom(roomId);
    const welcome = await player.waitFor(
      (msg) => msg.t === "welcome",
      `seat ${i} welcome`
    );
    assert(
      welcome.seat === i,
      `expected seat ${i}, got ${welcome.seat}`
    );
    assert(
      welcome.isHost === (i === 0),
      `seat ${i} host flag wrong`
    );
    player.seat = welcome.seat;
    player.sessionToken = welcome.sessionToken;
    players.push(player);
  }
  return players;
}

async function testFullRoomRace() {
  const { roomId } = await createRoom(RACE_CONFIG);
  const players = await joinSeats(roomId, 4);
  const [host, ...others] = players;

  const readyState = await host.waitFor(
    (msg) => msg.t === "state" && msg.room.status === "ready_check",
    "ready check once the room fills"
  );
  assert(
    readyState.room.players.length === 4,
    "expected four seats in the roster"
  );
  assert(
    readyState.room.players[0].ready === true,
    "host should be pre-marked ready"
  );

  for (const player of others) player.send({ t: "lock_in" });

  const racing = await host.waitFor(
    (msg) => msg.t === "state" && msg.room.status === "racing",
    "racing state"
  );
  const passage = racing.room.passage.text;

  // Everyone reports progress; seat 0 finishes first, so places should
  // follow the order they cross.
  for (const player of players) {
    player.send({
      t: "progress",
      pos: 4,
      correctCount: 4,
      wpm: 60,
      accuracy: 100,
    });
  }
  await host.waitFor(
    (msg) => msg.t === "player_progress" && msg.seat === 3,
    "seat 3 progress reaches seat 0"
  );

  for (const [index, player] of players.entries()) {
    player.send({
      t: "finished",
      wpm: 90 - index * 10,
      accuracy: 100 - index,
      elapsedMs: 4000 + index * 500,
      correctCount: passage.length - index,
    });
    await wait(60);
  }

  const ended = await host.waitFor(
    (msg) => msg.t === "state" && msg.room.status === "ended",
    "race ends once everyone finishes"
  );

  const result = ended.room.result;
  assert(result, "result missing");
  assert(
    result.players.length === 4,
    `expected four results, got ${result.players.length}`
  );
  assert(
    result.endReason === "finish",
    `expected finish, got ${result.endReason}`
  );
  assert(result.winnerSeat === 0, `expected seat 0 to win, got ${result.winnerSeat}`);

  const places = result.players.map((player) => player.place);
  assert(
    places.join(",") === "1,2,3,4",
    `expected distinct places, got ${places.join(",")}`
  );
  assert(
    result.players.every((player) => !player.dnf),
    "nobody should be marked dnf"
  );

  for (const player of players) player.close();
  console.log("  full four-seat race: ok");
}

async function testHostStartsEarly() {
  const { roomId } = await createRoom(RACE_CONFIG);
  const [host, second] = await joinSeats(roomId, 2);

  await wait(150);
  assert(
    host.latestState()?.status === "waiting",
    "a partly filled room should stay in waiting"
  );

  // Non-hosts can't start the race.
  second.send({ t: "start_race" });
  await wait(250);
  assert(
    host.latestState()?.status === "waiting",
    "non-host should not be able to start"
  );

  host.send({ t: "start_race" });
  const starting = await host.waitFor(
    (msg) => msg.t === "state" && msg.room.status === "starting",
    "host force-start"
  );
  assert(
    starting.room.players.length === 2,
    "should start with the two seats present"
  );

  host.close();
  second.close();
  console.log("  host force-start: ok");
}

async function testRejoinKeepsSeat() {
  const { roomId } = await createRoom({ ...RACE_CONFIG, maxPlayers: 3 });
  const players = await joinSeats(roomId, 3);
  const [host, , third] = players;

  for (const player of players.slice(1)) player.send({ t: "lock_in" });
  await host.waitFor(
    (msg) => msg.t === "state" && msg.room.status === "racing",
    "racing state"
  );

  host.send({
    t: "progress",
    pos: 5,
    correctCount: 5,
    wpm: 62,
    accuracy: 100,
  });
  third.send({
    t: "progress",
    pos: 7,
    correctCount: 7,
    wpm: 55,
    accuracy: 98,
  });
  await host.waitFor(
    (msg) => msg.t === "player_progress" && msg.seat === 2,
    "seat 2 progress"
  );

  third.close();
  const afterDrop = await host.waitFor(
    (msg) =>
      msg.t === "state" &&
      msg.room.players.some(
        (player) => player.seat === 2 && !player.connected
      ),
    "seat 2 marked disconnected"
  );
  assert(
    afterDrop.room.status === "racing",
    "race should keep running after a drop"
  );
  assert(
    afterDrop.room.players.length === 3,
    "the dropped racer's seat should be held"
  );

  const rejoined = connectRoom(roomId, third.sessionToken);
  const welcome = await rejoined.waitFor(
    (msg) => msg.t === "welcome",
    "rejoin welcome"
  );
  assert(welcome.seat === 2, `rejoin took seat ${welcome.seat}, expected 2`);

  // The server replays where the rest of the field stands so the
  // reconnecting racer isn't blind until the next keystroke.
  const snapshot = await rejoined.waitFor(
    (msg) => msg.t === "player_progress" && msg.seat === 0,
    "progress snapshot on rejoin"
  );
  assert(snapshot.pos === 5, `stale snapshot position ${snapshot.pos}`);

  const resumed = await rejoined.waitFor(
    (msg) =>
      msg.t === "state" &&
      msg.room.players.every((player) => player.connected),
    "seat 2 reconnected"
  );
  assert(
    resumed.room.status === "racing",
    "the race should still be running after a rejoin"
  );

  for (const player of players) player.close();
  rejoined.close();
  console.log("  mid-race rejoin: ok");
}

/** The original head-to-head flow, now just the N=2 case. */
async function testTwoPlayerRegression() {
  const { roomId } = await createRoom({
    endMode: "finish",
    passageLength: "short",
    maxPlayers: 2,
  });
  const [host, guest] = await joinSeats(roomId, 2);

  const readyState = await host.waitFor(
    (msg) => msg.t === "state" && msg.room.status === "ready_check",
    "two-seat room enters ready check when full"
  );
  assert(
    readyState.room.players.length === 2,
    "expected two seats in the roster"
  );

  // The host is pre-marked ready, so one lock-in should start the race.
  guest.send({ t: "lock_in" });
  const racing = await host.waitFor(
    (msg) => msg.t === "state" && msg.room.status === "racing",
    "racing after the guest locks in"
  );
  const passage = racing.room.passage.text;

  guest.send({
    t: "finished",
    wpm: 95,
    accuracy: 100,
    elapsedMs: 3800,
    correctCount: passage.length,
  });
  host.send({
    t: "finished",
    wpm: 70,
    accuracy: 97,
    elapsedMs: 4600,
    correctCount: passage.length - 3,
  });

  const ended = await host.waitFor(
    (msg) => msg.t === "state" && msg.room.status === "ended",
    "two-player race ends"
  );
  const result = ended.room.result;
  assert(result.players.length === 2, "expected two results");
  assert(
    result.winnerSeat === 1,
    `expected seat 1 to win, got ${result.winnerSeat}`
  );
  assert(
    result.players[0].place === 1 && result.players[1].place === 2,
    "expected 1st and 2nd places"
  );

  host.close();
  guest.close();
  console.log("  two-player regression: ok");
}

async function main() {
  requireWebSocket();
  await testTwoPlayerRegression();
  await testFullRoomRace();
  await testHostStartsEarly();
  await testRejoinKeepsSeat();
  console.log("multiplayer smoke passed");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
