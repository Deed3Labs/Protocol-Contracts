import { createHash, randomBytes } from 'node:crypto';
import type { Queryable } from '../../db/db.js';

/*
 * Files people add to the Command Center: documents, their versions, photos from the field.
 *
 * Kept in Postgres (command.files) for now, behind this one interface, so a bucket can replace it
 * without touching the routes: put, get, and nothing that hands out the bytes without a check.
 */

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** What can be added: documents, spreadsheets and photos. Anything else is refused. */
export const FILE_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

export interface StoredFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
}

export interface FileStore {
  put(db: Queryable, f: { name: string; mime: string; bytes: Buffer; by: string }): Promise<StoredFile>;
  get(db: Queryable, id: string): Promise<(StoredFile & { bytes: Buffer }) | null>;
}

/** A name that's safe in a Content-Disposition header and a file system. */
export const cleanName = (name: string, mime: string) => {
  const base = name.replace(/[\\/\0\r\n"]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || 'file';
  const ext = FILE_TYPES[mime];
  return ext && !base.toLowerCase().endsWith('.' + ext) ? `${base}.${ext}` : base;
};

export const postgresFiles: FileStore = {
  async put(db, f) {
    const sha256 = createHash('sha256').update(f.bytes).digest('hex');
    const { rows } = await db.query<StoredFile>(
      'INSERT INTO command.files (name, mime, size, sha256, bytes, added_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, mime, size, sha256',
      [cleanName(f.name, f.mime), f.mime, f.bytes.length, sha256, f.bytes, f.by],
    );
    return rows[0];
  },
  async get(db, id) {
    const { rows } = await db.query<StoredFile & { bytes: Buffer }>('SELECT id, name, mime, size, sha256, bytes FROM command.files WHERE id = $1', [id]);
    return rows[0] ?? null;
  },
};

// ── view-only links ─────────────────────────────────────────────────────────

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** A new link's token (shown once) and its hash (the only thing kept). */
export function newShareToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hash(token) };
}

/** The document a live, unexpired link points at, counting the open. */
export async function openShare(db: Queryable, token: string, now: Date) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { rows } = await db.query<{ id: string; document_id: string; for_whom: string; file_id: string | null; title: string }>(
    `UPDATE command.share_links s SET opens = opens + 1 FROM command.documents d
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND d.id = s.document_id
     RETURNING s.id, s.document_id, s.for_whom, d.file_id, d.title`,
    [hash(token), now],
  );
  return rows[0] ?? null;
}
