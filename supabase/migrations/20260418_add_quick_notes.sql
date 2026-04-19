CREATE TABLE IF NOT EXISTS quick_notes (
id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
customer_id BIGINT NOT NULL REFERENCES "Diamond crM"(id) ON DELETE CASCADE,
note_text TEXT NOT NULL CHECK (char_length(note_text) BETWEEN 1 AND 280),
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
created_by TEXT NOT NULL DEFAULT 'Admin'
);

CREATE INDEX IF NOT EXISTS idx_quick_notes_customer_id
ON quick_notes(customer_id);

CREATE INDEX IF NOT EXISTS idx_quick_notes_created_at
ON quick_notes(customer_id, created_at DESC);

ALTER TABLE quick_notes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'quick_notes'
      AND policyname = 'Allow all for anon'
  ) THEN
    CREATE POLICY "Allow all for anon" ON quick_notes
    FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END
$$;

ALTER TABLE quick_notes
ADD COLUMN IF NOT EXISTS vibe_summary TEXT DEFAULT NULL;

COMMENT ON COLUMN quick_notes.vibe_summary IS
'AI-generated 5-word vibe summary. NULL = not yet processed. Empty string not used.';
