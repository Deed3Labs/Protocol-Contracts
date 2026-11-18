import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as LD from './legalDemo';

/*
 * This repository is public; clear-agreements is private (brief update 2, section 0). Governance → Legal's
 * demo is the reference's placeholders only, and no real agreement title, research memo or spec may land in
 * the source, the fixtures or a built bundle.
 *
 * The first part always runs. The second reads the real register's titles with COMMAND_AGREEMENTS_TOKEN
 * (Contents: read on Deed3Labs/clear-agreements; COMMAND_AGREEMENTS_REPO for another) and looks for each one
 * in the files that ship; without the token it says it was skipped. The titles are only ever held in memory.
 */

describe('Legal’s demo is placeholders', () => {
  test('every row the reference ships with, and nothing else', () => {
    expect(LD.LREG.length).toBeGreaterThan(0);
    for (const r of LD.LREG) {
      expect(r[1]).toMatch(/^Sample agreement [A-Z]+-\d/);
      if (r[2]) expect(r[2]).toMatch(/^sample\//);
      if (r[4]) expect(r[4]).toMatch(/^sample\//);
    }
    for (const q of LD.LS1) expect(q[4]).toMatch(/^Sample question for counsel, a placeholder/);
    for (const m of LD.LRESEARCH) {
      expect(m[1]).toMatch(/^Research memo \d+ Placeholder/);
      expect(m[2]).toMatch(/^sample\//);
    }
    for (const s of LD.LSPECS) {
      expect(s[0]).toMatch(/^Sample spec \d+$/);
      expect(s[2]).toMatch(/^What this spec covers Placeholder/);
    }
    for (const o of LD.LORDER) {
      expect(o[1]).toMatch(/^Signing step \d+$/);
      if (o[2]) expect(o[2]).toMatch(/^A note on this step Placeholder/);
    }
    for (const p of LD.LPRS) expect(p[2]).toMatch(/^Sample change/);
    expect(LD.DEMO_REPO).toContain('OWNER/AGREEMENTS-REPO');
  });
});

const TOKEN = process.env.COMMAND_AGREEMENTS_TOKEN?.trim();
const REPO = process.env.COMMAND_AGREEMENTS_REPO?.trim() || 'Deed3Labs/clear-agreements';
const ROOT = resolve(import.meta.dir, '../../../..');
/**
 * What ships, and what it's built from: Command's source and bundle, the API's source, migrations and the fixtures.
 * Not the design reference itself (design/command-center-ui), which is Kai's file: its Records demo names one real
 * document (d12), which isn't ported. If that row is ported as it stands, this fails.
 */
const SHIPPED = ['apps/command/src', 'apps/command/dist', 'apps/api/src', 'apps/api/migrations', 'packages/command-types/src'];
const TEXT = /\.(ts|tsx|js|cjs|mjs|json|css|html|sql|md)$/;

function* files(path: string): Generator<string> {
  if (!existsSync(path)) return;
  if (statSync(path).isFile()) {
    if (TEXT.test(path)) yield path;
    return;
  }
  for (const f of readdirSync(path)) if (f !== 'node_modules') yield* files(join(path, f));
}

describe('no real clear-agreements title ships', () => {
  test.skipIf(!TOKEN)('none of the register’s titles, or its memos’, is in the source, fixtures or bundle', async () => {
    const get = async (path: string) => {
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: { Accept: 'application/vnd.github.raw', Authorization: `Bearer ${TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' } });
      if (!r.ok) throw new Error(`clear-agreements ${r.status}`);
      return r.text();
    };
    const readme = await get('README.md');
    const titles = new Set<string>();
    for (const line of readme.split('\n')) {
      const c = line.split('|').map((x) => x.trim());
      if (c.length > 4 && /^[A-Z]+-\d/.test(c[1])) titles.add(c[2]);
    }
    const research = (await (await fetch(`https://api.github.com/repos/${REPO}/contents/docs/research`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()) as { path: string }[];
    for (const r of research.filter((x) => x.path.endsWith('.md'))) {
      const h = /^#\s+(.+)$/m.exec(await get(r.path))?.[1];
      if (h) titles.add(h.replace(/^[A-Z]+-\d+\s*[:—–-]?\s*/, ''));
    }
    // short or generic titles ("Advisor Agreement") are words any agreement page could use; the rest are the register's own
    const look = [...titles].filter((t) => t.length >= 28);
    expect(look.length).toBeGreaterThan(10);
    const found: string[] = [];
    for (const dir of SHIPPED)
      for (const f of files(join(ROOT, dir))) {
        if (f.endsWith('legalDemo.test.ts')) continue;
        const s = readFileSync(f, 'utf8');
        for (const t of look) if (s.includes(t)) found.push(`${f.slice(ROOT.length + 1)}: a register title`);
      }
    // only where it was found, never the title itself
    expect(found).toEqual([]);
  });
});
