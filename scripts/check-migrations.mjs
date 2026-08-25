import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const workerDir = join(root, "worker");
const persistTo = await mkdtemp(join(tmpdir(), "typing-race-migrations-"));
const wranglerBin = join(root, "node_modules", "wrangler", "bin", "wrangler.js");

function wrangler(args) {
  const result = spawnSync(process.execPath, [wranglerBin, ...args], {
    cwd: workerDir,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) process.stderr.write(`${String(result.error)}\n`);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

try {
  wrangler([
    "d1",
    "migrations",
    "apply",
    "typing-race-db",
    "--local",
    "--persist-to",
    persistTo,
  ]);

  const output = wrangler([
    "d1",
    "execute",
    "typing-race-db",
    "--local",
    "--persist-to",
    persistTo,
    "--json",
    "--command",
    `SELECT
       (SELECT COUNT(*) FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('races', 'race_players', 'room_analytics',
                        'analytics_events', 'active_rooms')) AS table_count,
       (SELECT COUNT(*) FROM pragma_table_info('races')
         WHERE name IN ('player_count', 'winner_seat')) AS races_columns,
       (SELECT COUNT(*) FROM pragma_table_info('room_analytics')
         WHERE name IN ('config_max_players', 'players_joined_count')) AS room_columns,
       (SELECT COUNT(*) FROM pragma_table_info('active_rooms')
         WHERE name IN ('config_max_players', 'connected_count')) AS active_columns;`,
  ]);

  const parsed = JSON.parse(output);
  const row = parsed?.[0]?.results?.[0];
  if (
    row?.table_count !== 5 ||
    row?.races_columns !== 2 ||
    row?.room_columns !== 2 ||
    row?.active_columns !== 2
  ) {
    throw new Error(`migration schema check failed: ${JSON.stringify(row)}`);
  }

  console.log("all D1 migrations apply cleanly to an empty database");
} finally {
  await rm(persistTo, { recursive: true, force: true });
}
