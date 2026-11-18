import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/* The full check of live pages against the reference (18 Nov): Build, Records and Settings read what's recorded,
   never the seed's sample rows or the reference's fixed words. */

const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const build = src('./build2.tsx'),
  buildLive = src('./buildLive.ts'),
  admin = src('./admin2.tsx'),
  adminLive = src('./adminLive.ts'),
  sections = src('../live/sections.ts');

describe('Build, live', () => {
  test('a background refresh reads the Ops Safe again, so its signers never fall back to the stored rows', () => {
    const refresh = sections.slice(sections.indexOf('export async function refreshSection'), sections.indexOf('/** Signing out forgets'));
    expect(refresh).toContain("if (route === 'contracts') await import('./safe').then((m) => m.loadSafe())");
  });
  test('Every project says what its checks and its production deploy did', () => {
    expect(build).not.toContain('{ckDot(r.main)}Not read</span>');
    expect(build).toContain("r.main === 'pass' ? 'Passing' : r.main === 'fail' ? 'Failing'");
    expect(buildLive).toContain(": runsOn(p.id),");
  });
  test('the Deploys brief and a pull request’s review state use what was read', () => {
    expect(build).toContain("LV.RUN_ON ? LV.RUN_NOTE + '.'");
    expect(build).not.toContain("if (c.st === 'review') return 'Ready for review';");
    expect(build).toContain('asked for changes` : `Approved by ${who(last.who)} · ready to merge`');
  });
  test('the Ops Safe’s signers are its own threshold', () => {
    expect(build).toContain("const ctrlTxt = k => k === 'OPS' && LV ? LV.threshold");
    expect(build).not.toContain('CTRL[c[10]]');
  });
});

describe('Records and Settings, live', () => {
  test('what’s on file is counted from the documents', () => {
    expect(adminLive).toContain("const DCOUNT2 = Object.fromEntries(KINDS.map((k) => [k, DOCS2.filter((d) => d[2] === k).length]));");
  });
  test('Backups says Not real yet rather than vanishing', () => {
    expect(admin).toContain("<b>Not real yet</b><em>Needs a record of each backup and when it ran</em>");
  });
  test('Network reads the chain index and the readiness row from what’s recorded', () => {
    expect(admin).toContain('const NW = AL ? CHAIN.network || null');
    expect(admin).toContain("['Ops Safe', AL.SAFE ? `${AL.SAFE.threshold} of ${AL.SAFE.owners} signers` : 'Not connected']");
  });
});
