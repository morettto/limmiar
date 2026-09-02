-- Hash-chained audit trail: one row per recorded event, each row's entry_hash covering its
-- own fields plus the previous row's entry_hash, so altering any past entry is detectable
-- from that point on (see Api.Audit.AuditChain and docs/adr/ADR-S10-01-campos-do-hash-da-trilha.md
-- for exactly which fields feed the hash and why). Two tables: audit_entries, the chain
-- itself, and audit_anchors, the periodic witness of the chain head that detects a full-chain
-- rewrite (criterion 3).

CREATE TABLE IF NOT EXISTS audit_entries (
    tenant_id      uuid NOT NULL,
    sequence       bigint NOT NULL,
    action         smallint NOT NULL,     -- ordinal of Api.Audit.AuditAction, kept in sync by the CHECK below
    device_id      uuid NOT NULL,
    -- No DEFAULT now(): the exact instant hashed into entry_hash and the instant stored here
    -- must be the same value, and the application is what computes the hash, so the
    -- application (not Postgres) has to be the one supplying this value.
    recorded_at    timestamptz NOT NULL,
    previous_hash  bytea NOT NULL,        -- 32 bytes; genesis = 32 zero bytes, never NULL (see below)
    entry_hash     bytea NOT NULL,        -- 32 bytes; SHA-256 of the 82-byte preamble

    -- Identifies one entry within its tenant's chain; also the "which row" that
    -- AuditVerification.FirstBrokenSequence reports.
    PRIMARY KEY (tenant_id, sequence),

    -- The concurrency invariant this whole design leans on: two writers reading the same
    -- chain head H and both trying previous_hash = H race on this constraint, and Postgres
    -- -- not application code remembering to lock or retry correctly -- lets exactly one
    -- through. This is stronger than UNIQUE(tenant_id, sequence): it does not just resolve
    -- the race, it makes "two entries pointing at the same previous entry" structurally
    -- impossible, so the chain can never fork into a tree, even under a future bug.
    -- Genesis uses 32 zero bytes and not NULL specifically because NULL != NULL in a unique
    -- index -- two concurrent genesis inserts would otherwise both pass.
    CONSTRAINT audit_entries_previous_hash_uq UNIQUE (tenant_id, previous_hash),

    -- ponytail: closed range 0..5, not a foreign key to a lookup table -- the six actions
    -- are Api.Audit.AuditAction, a compile-time enum with no runtime-editable member list
    -- (unlike, say, a set of clinic-configurable statuses). Api.Tests.Audit's
    -- AuditActionRangeMatchesEnum inserts every Enum.GetValues<AuditAction>() value and one
    -- past it, so this bound and the enum cannot silently drift apart. Ceiling: if a future
    -- action needs to be user-configurable rather than a fixed enum, this becomes a real
    -- lookup table with a foreign key -- not expected for an audit trail's own event kinds.
    CONSTRAINT audit_action_range CHECK (action BETWEEN 0 AND 5),

    -- AuditChain.ComputeHash does previousHash.CopyTo(preamble[..32]) -- a shorter byte[]
    -- does not throw, it just leaves the rest of that 32-byte slice as zeros, silently
    -- corrupting the preamble instead of failing loudly. These CHECKs turn a short hash into
    -- an insert-time error instead of a silently wrong hash, in a security-relevant feature.
    CONSTRAINT audit_entries_previous_hash_length CHECK (octet_length(previous_hash) = 32),
    CONSTRAINT audit_entries_entry_hash_length CHECK (octet_length(entry_hash) = 32)
);

ALTER TABLE audit_entries ENABLE ROW LEVEL SECURITY;

-- FORCE is required, not just ENABLE: without it, the table owner (and any superuser)
-- bypasses the policy below entirely -- same reasoning as note_signatures (0005) and
-- patient_record_entries (0002). This is also exactly the gap the "Âncora" decision in the
-- ticket names: FORCE closes app_role, never a superuser with a direct admin connection.
ALTER TABLE audit_entries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON audit_entries;

-- NULLIF guards against a real Postgres GUC-reset quirk -- see 0002_create_patient_record_entries.sql.
CREATE POLICY tenant_isolation ON audit_entries
    USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- app_role and its password are already created by 0002_create_patient_record_entries.sql --
-- only the grants for this new table are needed here.
GRANT SELECT, INSERT ON audit_entries TO app_role;
REVOKE UPDATE, DELETE ON audit_entries FROM app_role;

-- ponytail: no BEFORE UPDATE OR DELETE immutability trigger -- same call as note_signatures
-- (0005) and patient_record_entries (0002). The GRANT/REVOKE pair above already closes every
-- write path app_role has, and app_role is the only role the running API ever connects as; a
-- trigger would be a second enforcement layer for a threat model (a second, non-app_role
-- writer role) that does not exist yet. Upgrade path if that threat model ever does exist:
-- add the trigger then, it does not need to pre-exist for this ticket's criteria.


-- A witness of one tenant's chain head at one instant, written by
-- Api.Audit.AuditEntryStore.CaptureAnchorAsync (the only producer -- no timer, no
-- IHostedService yet). AuditChain.Verify recomputes the entry at anchored_sequence and
-- compares it to anchored_hash: a rewrite that recomputes every entry_hash walks the chain
-- intact and is caught only here.
CREATE TABLE IF NOT EXISTS audit_anchors (
    tenant_id         uuid NOT NULL,
    anchored_sequence bigint NOT NULL,       -- the audit_entries.sequence being witnessed
    anchored_hash     bytea NOT NULL,        -- 32 bytes; that entry's entry_hash as it stood
    -- Supplied by the application, like audit_entries.recorded_at -- one clock decides when
    -- events happened and when they were witnessed, so the two are comparable.
    anchored_at       timestamptz NOT NULL,

    -- Identity of a witness is "this tenant's chain, as of this instant": capturing twice at
    -- the same instant would record the same claim twice and has nothing to add. Deliberately
    -- not UNIQUE (tenant_id, anchored_sequence) -- re-anchoring an unchanged head later is a
    -- fresh, useful witness (it narrows when a rewrite could have happened), not a duplicate.
    PRIMARY KEY (tenant_id, anchored_at),

    -- Same integrity guard as audit_entries.previous_hash/entry_hash -- see the comment there.
    CONSTRAINT audit_anchors_anchored_hash_length CHECK (octet_length(anchored_hash) = 32)
);

ALTER TABLE audit_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_anchors FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON audit_anchors;

CREATE POLICY tenant_isolation ON audit_anchors
    USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON audit_anchors TO app_role;
REVOKE UPDATE, DELETE ON audit_anchors FROM app_role;

-- ponytail: audit_anchors lives in the same Postgres database as audit_entries, so what the
-- anchor proves has a hard ceiling. Criterion 3 is proved against an attacker who rewrites the
-- ENTRIES but not the anchors (a careless DBA, a malicious migration, a doctored backup): the
-- rewritten chain walks intact and the surviving witness still contradicts it. It is NOT
-- proved against a superuser who rewrites both tables in the same transaction -- REVOKE closes
-- app_role, never a superuser, and FORCE ROW LEVEL SECURITY holds the table owner, not
-- someone with BYPASSRLS. Upgrade path: an external witness the database cannot reach --
-- S3 Object Lock, an RFC-3161 timestamp authority, or mailing the anchor to the professional
-- themselves. The seam for it is already in place: CaptureAnchorAsync is the single producer
-- of anchors, so the external write has exactly one place to hook into.
