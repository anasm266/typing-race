-- Completed race results for the public /recent leaderboard.
CREATE TABLE IF NOT EXISTS races (
  id             TEXT PRIMARY KEY,
  finished_at    INTEGER NOT NULL,
  end_reason     TEXT NOT NULL,
  outcome        TEXT NOT NULL,
  passage_id     TEXT NOT NULL,
  passage_length TEXT NOT NULL,
  passage_words  INTEGER NOT NULL,
  duration_ms    INTEGER NOT NULL,
  host_wpm       INTEGER NOT NULL,
  guest_wpm      INTEGER NOT NULL,
  host_accuracy  REAL    NOT NULL,
  guest_accuracy REAL    NOT NULL,
  host_finished  INTEGER NOT NULL,
  guest_finished INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_races_finished_at
  ON races(finished_at DESC);
