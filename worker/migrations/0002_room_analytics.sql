CREATE TABLE IF NOT EXISTS room_analytics (
  room_id                     TEXT PRIMARY KEY,
  created_at                  INTEGER NOT NULL,
  config_end_mode             TEXT NOT NULL,
  config_passage_length       TEXT NOT NULL,
  config_time_limit           INTEGER NOT NULL,
  host_joined_at              INTEGER,
  guest_joined_at             INTEGER,
  ready_check_started_at      INTEGER,
  race_started_at             INTEGER,
  race_ended_at               INTEGER,
  race_end_reason             TEXT,
  outcome                     TEXT,
  completed_successfully      INTEGER NOT NULL DEFAULT 0,
  pre_start_drop_count        INTEGER NOT NULL DEFAULT 0,
  host_pre_start_drop_count   INTEGER NOT NULL DEFAULT 0,
  guest_pre_start_drop_count  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_room_analytics_created_at
  ON room_analytics(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_analytics_race_started_at
  ON room_analytics(race_started_at DESC);
