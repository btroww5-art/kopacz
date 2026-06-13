ALTER TABLE workers REPLICA IDENTITY FULL;

DROP POLICY IF EXISTS "workers_read_all" ON workers;
DROP POLICY IF EXISTS "workers_insert_all" ON workers;
DROP POLICY IF EXISTS "workers_update_all" ON workers;
DROP POLICY IF EXISTS "workers_delete_all" ON workers;
DROP POLICY IF EXISTS "workers_read_authenticated" ON workers;
DROP POLICY IF EXISTS "workers_read_admins" ON workers;

CREATE POLICY "workers_read_admins"
  ON workers
  FOR SELECT
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

REVOKE INSERT, UPDATE, DELETE ON workers FROM anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'workers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE workers;
  END IF;
END $$;
