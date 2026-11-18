import { describe, expect, test } from 'bun:test';
import { buildLegal, headingOf, leadOf, LegalDenied, legalReader, parseOrder, parsePacket, parseRegister, totalsOnly } from './legal.js';

/*
 * Governance → Legal from clear-agreements. That repo is private and this one is public, so every file
 * here is made up: the shapes are the real ones (the README's Status table and signing order, the
 * counsel packet's per-agreement tables), the words are placeholders.
 */

const README = `# sample-agreements

## Status

| ID | Agreement | File | Status |
| --- | --- | --- | --- |
| F-01 | Sample agreement one | \`entities/a/F-01-sample-one.md\` | Final draft v1.0, awaiting counsel |
| F-04 | Sample agreement four | — | Dropped: not needed |
| F-06/07 | Sample agreement six and seven | \`entities/a/F-06-07-sample.md\`, \`F-06-07-b.md\` | Final draft v1.0, awaiting counsel |
| F-12 | Sample checklist | \`entities/a/F-12-sample-checklist.md\` | Final draft v1.0, working document |
| MB-01 | Sample member agreement | \`members/MB-01-sample.md\` | Final draft v1.0, awaiting counsel |

### Signing order

1. F-01: Sample step one
2. F-06/07: Sample step two (a sample note)

The rest follow.

## Not legal advice
`;
const PART_A = `# Sample packet, part A

Source: sample. Gates: G0 sample; G1 sample.

## MB-01 Sample member agreement

| Note | Gate | Severity | Specialty | Question | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | G1 | S1 | Securities | Sample question one? | Open: sample |
| 2 | G1 | S2 | Tax | Sample question two? | Answered — counsel to confirm: sample |
| 3 | G2 | S3 | Tax | Sample question three? | Answered: sample |
| 4 | G1 | S2 | Tax | Sample question four? | Decided — applied |
`;
const PART_B = `# Sample packet, part B

## F-01 Sample agreement one

| Note | Gate | Severity | Specialty | Question | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | G0 | S2 | Corporate & governance | Sample question five? | Open: sample |
| 2 | G0 | S3 | Tax | Sample question six? | Resolved: sample |
| 3 | G4 | S3 | Tax | Sample question seven? | Open: sample |

## F-06/07 Sample agreement six and seven

| Note | Gate | Severity | Specialty | Question | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | G0 | S1 | Securities | Sample question eight? | Open |
`;
const TREE = ['README.md', 'entities/a/F-01-sample-one.md', 'entities/a/F-01-counsel-notes.md', 'entities/a/F-06-07-counsel-notes.md', 'members/MB-01-sample.md', 'members/MB-01-counsel-notes.md'];
const input = {
  repo: 'Sample/agreements',
  sha: 'abc',
  readAt: 1,
  readme: README,
  parts: [PART_A, PART_B],
  tree: TREE,
  research: [['docs/research/R-01-sample.md', '# R-01: Sample memo one\n\nText.'] as [string, string]],
  specs: [['specs/sample-spec.md', '# Sample spec\n\nWhat the sample spec covers.\n\nMore.'] as [string, string]],
  commits: [
    { message: 'Sample change two (#9)\n\nBody.', date: '2026-11-17T10:00:00Z' },
    { message: 'A direct commit', date: '2026-11-16T10:00:00Z' },
    { message: 'Sample change one (#8)', date: '2026-11-14T10:00:00Z' },
  ],
};

describe('reading clear-agreements', () => {
  test('the register: its rows, files and statuses', () => {
    expect(parseRegister(README)).toEqual([
      { id: 'F-01', title: 'Sample agreement one', file: 'entities/a/F-01-sample-one.md', st: 'fd' },
      { id: 'F-04', title: 'Sample agreement four', file: null, st: 'drop' },
      { id: 'F-06/07', title: 'Sample agreement six and seven', file: 'entities/a/F-06-07-sample.md', st: 'fd' },
      { id: 'F-12', title: 'Sample checklist', file: 'entities/a/F-12-sample-checklist.md', st: 'wk' },
      { id: 'MB-01', title: 'Sample member agreement', file: 'members/MB-01-sample.md', st: 'fd' },
    ]);
  });

  test('the signing order, a note in brackets kept apart', () => {
    expect(parseOrder(README)).toEqual([
      ['F-01', 'Sample step one', null],
      ['F-06/07', 'Sample step two', 'a sample note'],
    ]);
  });

  test('a packet part: a note per row, its status in one of five', () => {
    const N = parsePacket(PART_A);
    expect(N.map((n) => [n.id, n.note, n.gate, n.sev, n.status])).toEqual([
      ['MB-01', 1, 'G1', 'S1', 'open'],
      ['MB-01', 2, 'G1', 'S2', 'confirm'],
      ['MB-01', 3, 'G2', 'S3', 'answered'],
      ['MB-01', 4, 'G1', 'S2', 'decided'],
    ]);
  });

  test('every count the tab shows', () => {
    const L = buildLegal(input);
    expect(L.COUNSEL).toEqual({ triaged: 8, open: 4, confirm: 1, answered: 1, decided: 1, resolved: 1, s1: 2 });
    // each agreement's notes, open, open S1, answered pending counsel and gates with open notes; F-06/07 matched either way
    expect(L.REG.map((r) => [r[0], r[4], r[5], r[6], r[7], r[8], r[9]])).toEqual([
      ['F-01', 'entities/a/F-01-counsel-notes.md', 3, 2, 0, 0, ['G0', 'G4']],
      ['F-04', null, 0, 0, 0, 0, []],
      ['F-06/07', 'entities/a/F-06-07-counsel-notes.md', 1, 1, 1, 0, ['G0']],
      ['F-12', null, 0, 0, 0, 0, []],
      ['MB-01', 'members/MB-01-counsel-notes.md', 4, 1, 1, 1, ['G1']],
    ]);
    expect(L.GATES.find((g) => g[0] === 'G0')).toEqual(['G0', 'Formation and banking', [1, 1, 0]]);
    expect(L.GATES.map((g) => g[0])).toEqual(['G0', 'G1', 'G2', 'G3', 'G4', 'G5']);
    expect(L.SPEC).toEqual([['Securities', 2], ['Corporate & governance', 1], ['Tax', 1]]);
    expect(L.S1).toEqual([['MB-01', 1, 'G1', 'Securities', 'Sample question one?'], ['F-06/07', 1, 'G0', 'Securities', 'Sample question eight?']]);
    expect(L.RESEARCH).toEqual([['R-01', 'Sample memo one', 'docs/research/R-01-sample.md']]);
    expect(L.SPECS).toEqual([['Sample spec', 'specs/sample-spec.md', 'What the sample spec covers.']]);
    expect(L.PRS).toEqual([[9, Date.parse('2026-11-17T10:00:00Z'), 'Sample change two'], [8, Date.parse('2026-11-14T10:00:00Z'), 'Sample change one']]);
  });

  test('totals only: ids and counts, never a title, file, question or change', () => {
    const L = buildLegal(input);
    const T = totalsOnly(L);
    const s = JSON.stringify(T);
    for (const w of ['Sample agreement', 'Sample question', 'Sample memo', 'Sample spec', 'Sample change', 'Sample step', 'sample-one', 'counsel-notes']) expect(s).not.toContain(w);
    expect(T.full).toBe(false);
    expect(T.COUNSEL).toEqual(L.COUNSEL);
    expect(T.REG.map((r) => [r[0], r[6], r[7]])).toEqual(L.REG.map((r) => [r[0], r[6], r[7]]));
  });

  test('headings and leads', () => {
    expect(headingOf('# R-02 — Sample memo\n', 'R-02')).toBe('Sample memo');
    expect(leadOf('# T\n\n| a | b |\n\nThe *first* real paragraph\nwraps.')).toBe('The first real paragraph wraps.');
  });

  test('off without its token; read again only when main moves', async () => {
    expect(legalReader({}).off()).toBe('neither COMMAND_AGREEMENTS_TOKEN nor GITHUB_TOKEN is set');
    let sha = 'abc';
    let t = 0;
    const asked: string[] = [];
    const files: Record<string, string> = { 'README.md': README, 'docs/counsel-packet/part-A-sample.md': PART_A, 'docs/counsel-packet/part-B-sample.md': PART_B };
    const f = (async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      asked.push(u.pathname);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok');
      expect(u.pathname.startsWith('/repos/Sample/agreements/')).toBe(true);
      const path = u.pathname.replace('/repos/Sample/agreements/', '');
      if (path === 'commits/main') return Response.json({ sha });
      if (path.startsWith('git/trees/')) return Response.json({ tree: Object.keys(files).map((p) => ({ path: p, type: 'blob' })) });
      if (path === 'commits') return Response.json([{ commit: { message: 'Sample change (#3)', committer: { date: '2026-11-17T00:00:00Z' } } }]);
      if (path.startsWith('contents/')) return new Response(files[decodeURIComponent(path.slice('contents/'.length))]);
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const r = legalReader({ COMMAND_AGREEMENTS_TOKEN: 'tok', COMMAND_AGREEMENTS_REPO: 'Sample/agreements' }, f, () => t);
    const a = await r.read();
    expect(a.COUNSEL.triaged).toBe(8);
    expect(a.REG).toHaveLength(5);
    const n = asked.length;
    // within the minute: main isn't asked again, nothing is read
    t = 30_000;
    await r.read();
    expect(asked.length).toBe(n);
    // after it, main is asked; unchanged, nothing else is read
    t = 61_000;
    await r.read();
    expect(asked.length).toBe(n + 1);
    // main moved: read again
    sha = 'def';
    t = 122_000;
    expect((await r.read()).sha).toBe('def');
    expect(asked.length).toBeGreaterThan(n + 2);
  });

  test('without its own token it reads with the GitHub poller’s; its own wins when both are set', async () => {
    const auth: (string | null)[] = [];
    const f = (async (_url: string, init?: RequestInit) => {
      auth.push(new Headers(init?.headers).get('authorization'));
      return new Response('', { status: 500 });
    }) as unknown as typeof fetch;
    const shared = legalReader({ GITHUB_TOKEN: 'gh' }, f);
    expect(shared.off()).toBeNull();
    await shared.read().catch(() => {});
    const own = legalReader({ GITHUB_TOKEN: 'gh', COMMAND_AGREEMENTS_TOKEN: 'own' }, f);
    await own.read().catch(() => {});
    expect(auth).toEqual(['Bearer gh', 'Bearer own']);
  });

  test('a token that can’t see the repo turns Legal off with the reason, naming the token', async () => {
    for (const [status, env, why] of [
      [404, { GITHUB_TOKEN: 'gh' }, 'GITHUB_TOKEN can’t read Deed3Labs/clear-agreements: add it to the token’s repositories, with Contents: read'],
      [403, { COMMAND_AGREEMENTS_TOKEN: 'own' }, 'COMMAND_AGREEMENTS_TOKEN can’t read Deed3Labs/clear-agreements: add it to the token’s repositories, with Contents: read'],
      [401, { GITHUB_TOKEN: 'gh' }, 'GitHub refused GITHUB_TOKEN (expired or revoked)'],
    ] as const) {
      const f = (async () => new Response('', { status })) as unknown as typeof fetch;
      const e = await legalReader(env, f).read().catch((x) => x);
      expect(e).toBeInstanceOf(LegalDenied);
      expect(e.off).toBe(why);
    }
  });
});
