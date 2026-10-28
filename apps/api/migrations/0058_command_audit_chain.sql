-- Command Center, the redesign (docs/ui-redesign-plan.md, Security): the audit log is chained.
-- Each entry carries the hash of the one before it and its own hash over both, so changing, removing
-- or reordering any entry (which the append-only trigger already refuses) would show as a break that
-- command.audit_verify() finds. A mistake is never edited: a correction is a new entry pointing back
-- at the one it corrects.
--
-- The chain follows the order entries were written in (seq), not their ids: an id is taken when a
-- row is built, so two transactions can commit out of id order. The trigger takes a lock that's held
-- until its transaction ends, so each entry is chained to the last one actually committed.

ALTER TABLE command.audit_log
  ADD COLUMN seq       BIGINT UNIQUE,
  ADD COLUMN prev_hash TEXT,
  ADD COLUMN hash      TEXT,
  ADD COLUMN corrects  BIGINT REFERENCES command.audit_log (id);

/** One entry's hash: the previous hash, then every field of the entry, in a fixed form. */
CREATE FUNCTION command.audit_hash(prev TEXT, r command.audit_log) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws(E'\x1f',
    coalesce(prev, ''),
    r.seq::text,
    r.id::text,
    to_char(r.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    coalesce(r.person_id::text, ''),
    r.who,
    r.area,
    r.action,
    r.detail,
    r.from_where,
    coalesce(r.before::text, ''),
    coalesce(r.after::text, ''),
    r.result,
    coalesce(r.approver::text, ''),
    coalesce(r.corrects::text, '')
  ), 'UTF8')), 'hex')
$$;

CREATE FUNCTION command.audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  last RECORD;
BEGIN
  -- one writer at a time, until it commits
  PERFORM pg_advisory_xact_lock(hashtext('command.audit_log'));
  SELECT seq, hash INTO last FROM command.audit_log WHERE seq IS NOT NULL ORDER BY seq DESC LIMIT 1;
  NEW.seq := coalesce(last.seq, 0) + 1;
  NEW.prev_hash := last.hash;
  NEW.hash := command.audit_hash(NEW.prev_hash, NEW);
  RETURN NEW;
END;
$$;

-- the entries written before the chain: chained now, in the order they were written (their ids)
ALTER TABLE command.audit_log DISABLE TRIGGER audit_log_append_only;
DO $$
DECLARE
  r command.audit_log;
  prev TEXT := NULL;
  n BIGINT := 0;
BEGIN
  FOR r IN SELECT * FROM command.audit_log ORDER BY id LOOP
    n := n + 1;
    r.seq := n;
    r.prev_hash := prev;
    r.hash := command.audit_hash(prev, r);
    UPDATE command.audit_log SET seq = r.seq, prev_hash = r.prev_hash, hash = r.hash WHERE id = r.id;
    prev := r.hash;
  END LOOP;
END;
$$;
ALTER TABLE command.audit_log ENABLE TRIGGER audit_log_append_only;

ALTER TABLE command.audit_log ALTER COLUMN seq SET NOT NULL, ALTER COLUMN hash SET NOT NULL;

CREATE TRIGGER audit_log_chain BEFORE INSERT ON command.audit_log
  FOR EACH ROW EXECUTE FUNCTION command.audit_chain();

/**
 * Walks the chain from the first entry: the seq of the first entry that doesn't follow from the one
 * before it (a gap, a wrong previous hash or a hash that doesn't match its fields), or NULL if the
 * whole chain holds.
 */
CREATE FUNCTION command.audit_verify() RETURNS BIGINT LANGUAGE plpgsql STABLE AS $$
DECLARE
  r command.audit_log;
  prev TEXT := NULL;
  n BIGINT := 0;
BEGIN
  FOR r IN SELECT * FROM command.audit_log ORDER BY seq LOOP
    n := n + 1;
    IF r.seq <> n OR r.prev_hash IS DISTINCT FROM prev OR r.hash <> command.audit_hash(prev, r) THEN
      RETURN r.seq;
    END IF;
    prev := r.hash;
  END LOOP;
  RETURN NULL;
END;
$$;
