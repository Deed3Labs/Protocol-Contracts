/*
 * Governance → Legal (brief update 2, section 3): the agreements in the private Deed3Labs/clear-agreements
 * and counsel's questions on them, read with a read-only token: COMMAND_AGREEMENTS_TOKEN when it's set,
 * else the GitHub poller's GITHUB_TOKEN, once that token's repository access includes clear-agreements
 * (Contents: read). COMMAND_AGREEMENTS_REPO for another repo. A token that can't see the repo (GitHub
 * answers 401, 403 or 404) turns Legal off with the reason, rather than an error. This repository is
 * public: nothing read here is written anywhere, only answered to an admin who asks.
 *
 * - The register is the README's Status table; the signing order its "Signing order" list.
 * - Counsel's counts and the questions that could force a redesign are the counsel packet's four part
 *   files (docs/counsel-packet/part-*.md): one table per agreement, a row per note with its gate,
 *   severity, specialty, question and status.
 * - Research memos are docs/research/, specs are specs/, each named by its first heading; recent changes
 *   are main's merge commits ("Title (#37)"), so the token needs Contents and nothing else.
 *
 * Read again only when main moves (checked at most once a minute). Everyone but Admin gets the totals:
 * ids and counts, never a title, a file name, a question or a change.
 */

type Env = Record<string, string | undefined>;

export type LegalStatus = 'fd' | 'wk' | 'drop';
/** id, title, file, status, counsel-notes file, notes, open, open S1, answered pending counsel, gates with open notes. */
export type LegalRow = [string, string | null, string | null, LegalStatus, string | null, number, number, number, number, string[]];
export interface Legal {
  repo: string;
  sha: string;
  readAt: number;
  /** Whether titles, files and questions are in it (Admin only). */
  full: boolean;
  REG: LegalRow[];
  COUNSEL: { triaged: number; open: number; confirm: number; answered: number; decided: number; resolved: number; s1: number };
  /** gate, what it is, open notes by severity [S1, S2, S3]. */
  GATES: [string, string, [number, number, number]][];
  /** open notes by specialty, most first. */
  SPEC: [string, number][];
  /** the open S1 notes: agreement, note, gate, specialty, question. */
  S1: [string, number, string, string, string | null][];
  /** the Formation signing order: agreement, step, note. */
  ORDER: [string, string | null, string | null][];
  RESEARCH: [string, string | null, string | null][];
  SPECS: [string | null, string | null, string | null][];
  /** recent changes: pull request, day (ms), title. */
  PRS: [number, number, string | null][];
}

const GATE_NAMES: Record<string, string> = {
  G0: 'Formation and banking',
  G1: 'Soft launch',
  G2: 'Credit launch',
  G3: 'Capital raising',
  G4: 'Housing and property',
  G5: 'Later or optional',
};
const PARTS = ['part-A', 'part-B', 'part-C', 'part-D'];
const CHECK_MS = 60_000;

/** "F-06/07" and "F-06-07" are the same agreement. */
const idKey = (id: string) => id.replace(/\//g, '-').toUpperCase();
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

/** The README's Status table: one row per agreement. */
export function parseRegister(readme: string): { id: string; title: string; file: string | null; st: LegalStatus }[] {
  const out: { id: string; title: string; file: string | null; st: LegalStatus }[] = [];
  let inTable = false;
  for (const line of readme.split('\n')) {
    if (/^\|\s*ID\s*\|\s*Agreement\s*\|/i.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (!line.startsWith('|')) {
      if (out.length) break;
      continue;
    }
    const c = cells(line);
    if (c.length < 4 || /^-+$/.test(c[0])) continue;
    const file = /`([^`]+)`/.exec(c[2])?.[1] ?? null;
    const st: LegalStatus = /^dropped/i.test(c[3]) ? 'drop' : /working (document|checklist)/i.test(c[3]) ? 'wk' : 'fd';
    out.push({ id: c[0], title: c[1], file, st });
  }
  return out;
}

/** The README's "Signing order": "1. F-01: What it is (a note)". */
export function parseOrder(readme: string): [string, string, string | null][] {
  const at = readme.search(/^#+\s*Signing order/im);
  if (at < 0) return [];
  const out: [string, string, string | null][] = [];
  for (const line of readme.slice(at).split('\n').slice(1)) {
    if (/^#/.test(line)) break;
    const m = /^\s*\d+\.\s+([^:\s]+):\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const note = /^(.*?)\s*\((.+)\)\s*$/.exec(m[2]);
    out.push(note ? [m[1], note[1], note[2]] : [m[1], m[2], null]);
  }
  return out;
}

export type Note = { id: string; note: number; gate: string; sev: string; spec: string; q: string; status: 'open' | 'confirm' | 'answered' | 'decided' | 'resolved' };
const bucket = (s: string): Note['status'] | null => {
  const t = s.trim().toLowerCase();
  if (t.startsWith('open')) return 'open';
  if (/^answered\s*[—–-]\s*counsel to confirm/.test(t)) return 'confirm';
  if (t.startsWith('answered')) return 'answered';
  if (t.startsWith('decided')) return 'decided';
  if (t.startsWith('resolved') || t.startsWith('superseded')) return 'resolved';
  return null;
};

/** A counsel packet part: "## MB-01 Title", then a table of notes. */
export function parsePacket(md: string): Note[] {
  const out: Note[] = [];
  let id: string | null = null;
  for (const line of md.split('\n')) {
    const h = /^##\s+(\S+)/.exec(line);
    if (h) {
      id = h[1];
      continue;
    }
    if (!id || !line.startsWith('|')) continue;
    const c = cells(line);
    if (c.length < 6 || !/^\d+$/.test(c[0])) continue;
    const status = bucket(c[5]);
    if (status) out.push({ id, note: Number(c[0]), gate: c[1], sev: c[2], spec: c[3], q: c[4], status });
  }
  return out;
}

/** A markdown file's first heading, without its own id ("# R-01: Title" → "Title"). */
export const headingOf = (md: string, id?: string) => {
  const h = /^#\s+(.+)$/m.exec(md)?.[1]?.trim() ?? null;
  return h && id ? h.replace(new RegExp(`^${id.replace(/[-/]/g, '\\$&')}\\s*[:—–-]?\\s*`, 'i'), '') : h;
};
/** Its first paragraph after the heading, one line. */
export const leadOf = (md: string) => {
  const body = md.replace(/^#.*$/m, '').split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#') && !p.startsWith('|') && !p.startsWith('```'));
  return body ? body.replace(/\s+/g, ' ').replace(/[*_`]/g, '').slice(0, 200) : null;
};

/** Everything the tab shows, worked out from the repo's files. */
export function buildLegal(input: {
  repo: string;
  sha: string;
  readAt: number;
  readme: string;
  parts: string[];
  tree: string[];
  research: [string, string][];
  specs: [string, string][];
  commits: { message: string; date: string }[];
}): Legal {
  const notes = input.parts.flatMap(parsePacket);
  const byId = new Map<string, Note[]>();
  for (const n of notes) (byId.get(idKey(n.id)) ?? byId.set(idKey(n.id), []).get(idKey(n.id))!).push(n);
  const REG: LegalRow[] = parseRegister(input.readme).map((r) => {
    const N = byId.get(idKey(r.id)) ?? [];
    const open = N.filter((n) => n.status === 'open');
    const dir = r.file ? r.file.slice(0, r.file.lastIndexOf('/') + 1) : '';
    const cn = input.tree.find((p) => p.endsWith(`/${idKey(r.id)}-counsel-notes.md`) && (!dir || p.startsWith(dir))) ?? input.tree.find((p) => p.endsWith(`/${idKey(r.id)}-counsel-notes.md`)) ?? null;
    return [
      r.id,
      r.title,
      r.file,
      r.st,
      cn,
      N.length,
      open.length,
      open.filter((n) => n.sev === 'S1').length,
      N.filter((n) => n.status === 'confirm').length,
      [...new Set(open.map((n) => n.gate))].sort(),
    ];
  });
  const count = (s: Note['status']) => notes.filter((n) => n.status === s).length;
  const open = notes.filter((n) => n.status === 'open');
  const gates = [...new Set([...Object.keys(GATE_NAMES), ...open.map((n) => n.gate)])].filter((g) => /^G\d$/.test(g)).sort();
  const spec = new Map<string, number>();
  for (const n of open) spec.set(n.spec, (spec.get(n.spec) ?? 0) + 1);
  const PRS: Legal['PRS'] = [];
  for (const c of input.commits) {
    const m = /^(.*?)\s*\(#(\d+)\)\s*$/.exec(c.message.split('\n')[0]);
    if (m && !PRS.some((p) => p[0] === Number(m[2]))) PRS.push([Number(m[2]), Date.parse(c.date), m[1]]);
    if (PRS.length >= 10) break;
  }
  return {
    repo: input.repo,
    sha: input.sha,
    readAt: input.readAt,
    full: true,
    REG,
    COUNSEL: { triaged: notes.length, open: open.length, confirm: count('confirm'), answered: count('answered'), decided: count('decided'), resolved: count('resolved'), s1: open.filter((n) => n.sev === 'S1').length },
    GATES: gates.map((g) => [g, GATE_NAMES[g] ?? g, [1, 2, 3].map((s) => open.filter((n) => n.gate === g && n.sev === `S${s}`).length) as [number, number, number]]),
    SPEC: [...spec.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    S1: open.filter((n) => n.sev === 'S1').map((n) => [n.id, n.note, n.gate, n.spec, n.q]),
    ORDER: parseOrder(input.readme),
    RESEARCH: input.research.map(([path, md]) => {
      const id = /([A-Z]+-\d+)/.exec(path.split('/').pop() ?? '')?.[1] ?? path;
      return [id, headingOf(md, id) ?? path, path];
    }),
    SPECS: input.specs.map(([path, md]) => [headingOf(md) ?? path, path, leadOf(md)]),
    PRS,
  };
}

/** What everyone but Admin sees: the ids and the counts, with every title, file, question and change taken out. */
export function totalsOnly(L: Legal): Legal {
  return {
    ...L,
    full: false,
    REG: L.REG.map(([id, , , st, , n, open, s1, conf, gates]) => [id, null, null, st, null, n, open, s1, conf, gates]),
    S1: L.S1.map(([id, n, g, sp]) => [id, n, g, sp, null]),
    ORDER: L.ORDER.map(([id]) => [id, null, null]),
    RESEARCH: L.RESEARCH.map(([id]) => [id, null, null]),
    SPECS: L.SPECS.map(() => [null, null, null]),
    PRS: L.PRS.map(([n, at]) => [n, at, null]),
  };
}

/** A token that can't see the agreements repo: Legal is off with this reason, not failing. */
export class LegalDenied extends Error {
  constructor(readonly off: string) {
    super(off);
  }
}

export function legalReader(env: Env = process.env, f: typeof fetch = fetch, now = () => Date.now()) {
  const own = env.COMMAND_AGREEMENTS_TOKEN?.trim();
  const tokenName = own ? 'COMMAND_AGREEMENTS_TOKEN' : 'GITHUB_TOKEN';
  const token = own || env.GITHUB_TOKEN?.trim();
  const repo = env.COMMAND_AGREEMENTS_REPO?.trim() || 'Deed3Labs/clear-agreements';
  const headers = (raw = false) => ({ Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${token}` });
  const api = async <T>(path: string): Promise<T> => {
    const r = await f(`https://api.github.com/repos/${repo}/${path}`, { headers: headers(), signal: AbortSignal.timeout(10_000) });
    if (r.status === 401) throw new LegalDenied(`GitHub refused ${tokenName} (expired or revoked)`);
    // GitHub answers 404 for a private repo the token can't see
    if (r.status === 403 || r.status === 404) throw new LegalDenied(`${tokenName} can’t read ${repo}: add it to the token’s repositories, with Contents: read`);
    if (!r.ok) throw new Error(`clear-agreements ${r.status}`);
    return (await r.json()) as T;
  };
  const raw = async (path: string, sha: string) => {
    const r = await f(`https://api.github.com/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`, { headers: headers(true), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`clear-agreements ${r.status} on a file`);
    return r.text();
  };

  const read = async (sha: string): Promise<Legal> => {
    const { tree } = await api<{ tree: { path: string; type: string }[] }>(`git/trees/${sha}?recursive=1`);
    const files = tree.filter((t) => t.type === 'blob').map((t) => t.path);
    const parts = files.filter((p) => p.startsWith('docs/counsel-packet/') && PARTS.some((x) => p.split('/').pop()!.startsWith(x)) && p.endsWith('.md')).sort();
    const research = files.filter((p) => /^docs\/research\/[^/]+\.md$/.test(p)).sort();
    const specs = files.filter((p) => /^specs\/[^/]+\.md$/.test(p)).sort();
    const [readme, partMd, researchMd, specMd, commits] = await Promise.all([
      raw('README.md', sha),
      Promise.all(parts.map((p) => raw(p, sha))),
      Promise.all(research.map((p) => raw(p, sha).then((md) => [p, md] as [string, string]))),
      Promise.all(specs.map((p) => raw(p, sha).then((md) => [p, md] as [string, string]))),
      api<{ commit: { message: string; committer?: { date?: string }; author?: { date?: string } } }[]>(`commits?sha=${sha}&per_page=50`),
    ]);
    return buildLegal({
      repo,
      sha,
      readAt: now(),
      readme,
      parts: partMd,
      tree: files,
      research: researchMd,
      specs: specMd,
      commits: commits.map((c) => ({ message: c.commit.message, date: c.commit.committer?.date ?? c.commit.author?.date ?? '' })),
    });
  };

  let kept: { sha: string; p: Promise<Legal> } | null = null;
  let checked = 0;
  let head: Promise<string> | null = null;
  return {
    off: () => (token ? null : 'neither COMMAND_AGREEMENTS_TOKEN nor GITHUB_TOKEN is set'),
    /** The register and counsel's counts at main; read again only when main has moved. */
    async read(): Promise<Legal> {
      if (!head || now() - checked > CHECK_MS) {
        checked = now();
        head = api<{ sha: string }>('commits/main').then((c) => c.sha);
        head.catch(() => (head = null));
      }
      const sha = await head;
      if (!kept || kept.sha !== sha) {
        const p = read(sha);
        kept = { sha, p };
        p.catch(() => kept?.p === p && (kept = null));
      }
      return kept.p;
    },
  };
}

let shared: ReturnType<typeof legalReader> | null = null;
/** The API's one reader, so every request shares what was read at main. */
export const liveLegal = () => (shared ??= legalReader());
