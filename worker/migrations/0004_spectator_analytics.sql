ALTER TABLE room_analytics
  ADD COLUMN spectator_join_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE room_analytics
  ADD COLUMN spectator_leave_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE room_analytics
  ADD COLUMN spectator_max_concurrent INTEGER NOT NULL DEFAULT 0;

ALTER TABLE room_analytics
  ADD COLUMN first_spectator_joined_at INTEGER;

ALTER TABLE room_analytics
  ADD COLUMN last_spectator_left_at INTEGER;

ALTER TABLE room_analytics
  ADD COLUMN spectator_watch_ms_total INTEGER NOT NULL DEFAULT 0;
