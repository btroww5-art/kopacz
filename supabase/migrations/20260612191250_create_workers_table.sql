CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  monero_address TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  hostname TEXT DEFAULT 'unknown',
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  online BOOLEAN DEFAULT true,
  is_local BOOLEAN DEFAULT false,
  stats JSONB DEFAULT '{}',
  history JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workers_monero ON workers(monero_address);
CREATE INDEX idx_workers_online ON workers(online);
CREATE INDEX idx_workers_last_seen ON workers(last_seen);

ALTER TABLE workers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workers_read_admins"
  ON workers
  FOR SELECT
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
