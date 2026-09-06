-- 0005_create_note_signatures.sql was edited in place after publication (S08-15, commit
-- 2262717) to rename the `revisao` column and `revisao_not_negative` constraint to `revision`
-- / `revision_not_negative`. MigrationRunner has no applied-migrations table and reruns every
-- *.sql file, in order, on every boot -- a database where the original, published 0005 already
-- ran sees the edited CREATE TABLE IF NOT EXISTS as a no-op and never picks up the rename. This
-- migration is the only path that base has left to reach `revision`, the name
-- NoteSignatureStore and the note_signatures schema now agree on.
--
-- Two independent guards, not one: Postgres has no RENAME COLUMN/CONSTRAINT IF EXISTS, and a
-- column rename succeeding does not imply the constraint rename already happened too (someone
-- could have run half of this by hand). Each guard makes its own step a no-op on a base that
-- already has it, which is what a release_command re-running this file on every deploy needs.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'note_signatures' AND column_name = 'revisao'
    ) THEN
        ALTER TABLE note_signatures RENAME COLUMN revisao TO revision;
    END IF;

    IF to_regclass('note_signatures') IS NOT NULL AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass('note_signatures') AND conname = 'revisao_not_negative'
    ) THEN
        ALTER TABLE note_signatures RENAME CONSTRAINT revisao_not_negative TO revision_not_negative;
    END IF;
END $$;
