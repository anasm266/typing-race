CREATE TABLE IF NOT EXISTS active_rooms (
  room_id                 TEXT PRIMARY KEY,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL,
  status                  TEXT NOT NULL,
  source                  TEXT NOT NULL DEFAULT 'user',
  config_end_mode         TEXT NOT NULL,
  config_passage_length   TEXT NOT NULL,
  config_time_limit       INTEGER NOT NULL,
  passage_id              TEXT NOT NULL,
  passage_words           INTEGER NOT NULL,
  player_count            INTEGER NOT NULL DEFAULT 0,
  spectator_count         INTEGER NOT NULL DEFAULT 0,
  host_connected          INTEGER NOT NULL DEFAULT 0,
  guest_connected         INTEGER NOT NULL DEFAULT 0,
  race_started_at         INTEGER,
  race_ended_at           INTEGER,
  last_event              TEXT,
  expires_at              INTEGER
);

CREATE INDEX IF NOT EXISTS idx_active_rooms_source_updated_at
  ON active_rooms(source, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_active_rooms_source_status
  ON active_rooms(source, status, updated_at DESC);
