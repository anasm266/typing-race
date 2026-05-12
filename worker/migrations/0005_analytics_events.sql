CREATE TABLE IF NOT EXISTS analytics_events (
  id               TEXT PRIMARY KEY,
  event_at         INTEGER NOT NULL,
  received_at      INTEGER NOT NULL,
  event_name       TEXT NOT NULL,
  browser_id       TEXT,
  session_id       TEXT,
  room_id          TEXT,
  participant_kind TEXT,
  player_role      TEXT,
  path             TEXT,
  referrer_host    TEXT,
  utm_source       TEXT,
  utm_medium       TEXT,
  utm_campaign     TEXT,
  country          TEXT,
  region           TEXT,
  city             TEXT,
  timezone         TEXT,
  colo             TEXT,
  browser          TEXT,
  os               TEXT,
  device           TEXT,
  screen_width     INTEGER,
  screen_height    INTEGER,
  source           TEXT NOT NULL DEFAULT 'user',
  metadata_json    TEXT,
  ip_hash          TEXT
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_event_at
  ON analytics_events(event_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_source_event_at
  ON analytics_events(source, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_name_event_at
  ON analytics_events(event_name, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_browser_event_at
  ON analytics_events(browser_id, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_room_event_at
  ON analytics_events(room_id, event_at DESC);

CREATE TABLE IF NOT EXISTS analytics_housekeeping (
  key        TEXT PRIMARY KEY,
  value_ms   INTEGER NOT NULL
);
