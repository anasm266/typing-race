ALTER TABLE room_analytics
  ADD COLUMN source TEXT NOT NULL DEFAULT 'user';

CREATE INDEX IF NOT EXISTS idx_room_analytics_source_created_at
  ON room_analytics(source, created_at DESC);
