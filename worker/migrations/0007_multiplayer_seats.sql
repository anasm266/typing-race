-- Rooms grew from a fixed host/guest pair to 2-4 seats.
-- The seat 0/1 columns on races stay populated so existing rows and the
-- two-player feed keep working; everything per-seat lives in race_players.

ALTER TABLE races ADD COLUMN player_count INTEGER NOT NULL DEFAULT 2;
ALTER TABLE races ADD COLUMN winner_seat INTEGER;

CREATE TABLE IF NOT EXISTS race_players (
  race_id       TEXT    NOT NULL,
  seat          INTEGER NOT NULL,
  place         INTEGER NOT NULL,
  wpm           INTEGER NOT NULL,
  accuracy      REAL    NOT NULL,
  elapsed_ms    INTEGER NOT NULL,
  correct_chars INTEGER NOT NULL,
  finished      INTEGER NOT NULL,
  dnf           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (race_id, seat)
);

CREATE INDEX IF NOT EXISTS idx_race_players_race_id
  ON race_players(race_id);

ALTER TABLE room_analytics
  ADD COLUMN config_max_players INTEGER NOT NULL DEFAULT 2;
ALTER TABLE room_analytics
  ADD COLUMN players_joined_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE active_rooms
  ADD COLUMN config_max_players INTEGER NOT NULL DEFAULT 2;
ALTER TABLE active_rooms
  ADD COLUMN connected_count INTEGER NOT NULL DEFAULT 0;

-- Backfill so historical races render through the same seat-based path.
UPDATE races
   SET winner_seat = CASE outcome
                       WHEN 'host_wins' THEN 0
                       WHEN 'guest_wins' THEN 1
                       ELSE NULL
                     END
 WHERE winner_seat IS NULL;

INSERT OR IGNORE INTO race_players (
  race_id, seat, place, wpm, accuracy, elapsed_ms, correct_chars, finished, dnf
)
SELECT id,
       0,
       CASE WHEN outcome = 'guest_wins' THEN 2 ELSE 1 END,
       host_wpm,
       host_accuracy,
       duration_ms,
       0,
       host_finished,
       0
  FROM races;

INSERT OR IGNORE INTO race_players (
  race_id, seat, place, wpm, accuracy, elapsed_ms, correct_chars, finished, dnf
)
SELECT id,
       1,
       CASE WHEN outcome = 'host_wins' THEN 2 ELSE 1 END,
       guest_wpm,
       guest_accuracy,
       duration_ms,
       0,
       guest_finished,
       0
  FROM races;
