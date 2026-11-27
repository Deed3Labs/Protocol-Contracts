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

describe('Growth, Members, Field and Merchants, live', () => {
  const growth = src('./growth2.tsx'),
    growthLive = src('./growthLive.ts'),
    members = src('./members2.tsx'),
    fm = src('./fm2.tsx');
  test('no made-up sparkline, change or jitter on a live breakdown; a channel’s unknown change is a dash', () => {
    expect(growth).toContain('{L ? <span className="quiet">—</span> : spark(hash(r.n) + k, r.rate > avg)}');
    expect(growth).toContain('r.prev = L ? null :');
    expect(growthLive).toContain("v ? Math.round((j / v) * 1000) / 10 : 0, null, []]");
  });
  test('opened and first spends by week, browsers and the waitlist lists come from what’s recorded', () => {
    expect(growthLive).toContain("fig['growth.weekly.opened'] ?? zeros");
    expect(growthLive).toContain("BROWSERS: fig['growth.browsers'] ?? []");
    expect(growth).toContain('const W = vars.WAITLIST;');
    expect(growth).toContain("import { vars } from './data';");
  });
  test('Members: shops live by city from Merchants, the planner’s pace from the batches sent', () => {
    expect(members).toContain("const SL = LV && !needsData('merchants') ? fmLive().LIVE_BY_CITY : null;");
    expect(members).toContain('pace: LV ? recentPace() || 50 : 50');
  });
  test('Field and Merchants: the reference’s placement rule on live inputs, the pipeline contact, the 14-day bars', () => {
    expect(fm).toContain('const C = cityRows().map(c => scored ? c :');
    expect(fm).toContain('LV.MS?.find(m => m.name === x.shop)?.card?.contact?.name');
    expect(fm).toContain('const d14 = vars.cleared14?.[m.id];');
    expect(fm).toContain("import { S, vars } from './data';");
  });
});
