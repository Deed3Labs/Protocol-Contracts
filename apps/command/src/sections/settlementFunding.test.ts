import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { demoSettle, settleNeed } from './settleCard';

const card = readFileSync(new URL('./settleCard.tsx', import.meta.url), 'utf8');
const worksheet = readFileSync(new URL('./settlementFunding.tsx', import.meta.url), 'utf8');
const money = readFileSync(new URL('./money2.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('./homeHub.tsx', import.meta.url), 'utf8');
const build = readFileSync(new URL('./build2.tsx', import.meta.url), 'utf8');
const buildLive = readFileSync(new URL('./buildLive.ts', import.meta.url), 'utf8');
const live = readFileSync(new URL('../live/sections.ts', import.meta.url), 'utf8');
const host = readFileSync(new URL('./pageHost.tsx', import.meta.url), 'utf8');

/* Card settlement (decision 54, the redesign): will the swipes settle at the next cut-off, and what to press if not. */

describe('where it goes', () => {
  test('Money → Overview: the full card leads, #nsettle, from the money section live', () => {
    expect(live).toContain('vars.settlementFunding = d.SETTLEMENT_FUNDING ?? null;');
    expect(money).toContain('const SETL = () => L ? vars.settlementFunding ?? null : demoSettle(SF_NOW(), \'covered\');');
    expect(money).toContain('html(document.getElementById(\'nv\'), <>{band(settle, 1)}{band(<>{claimsCell()}{gateCell()}</>)}');
    expect(card).toContain("'nsettle',");
  });
  test('Money → Pools → Yield pool: the slim card after the 30-day chart, then Pool Tier principal, unchanged', () => {
    expect(money).toContain('return <>{band(flow)}{band(pay)}{band(proj)}{settle}{band(<>{a}{b}</>)}{band(tbl)}</>;');
    expect(money).toContain("const settle = <>{band(sf)}{band(<PoolTierPrincipal demo={!L} money={money} cls=\"s12\" />)}</>;");
    expect(card).toContain('<button data-ntab="overview" data-njump="nsettle">Fund or review →</button>');
  });
  test('both strips: a 5th tile that jumps to the card; Home’s strip is five columns', () => {
    expect(money).toContain('<div className="strip s5">');
    expect(money).toContain("'data-njump': 'nsettle'");
    expect(home).toContain('<div className="h-strip s5">');
    expect(home).toContain("settleTile(homeSettle(), { cls: 'h-sc'");
  });
  test('both needs lists: one row, the same words, only when it isn’t Covered', () => {
    expect(money).toContain('const NEED = L ? [...settleRow(),');
    expect(money).toContain('] : [...settleRow(), ...mine.map(');
    expect(home).toContain('heads: [...settleHead(), ...liveHeads()');
    const now = new Date(2026, 9, 21, 16, 4).getTime();
    expect(settleNeed(demoSettle(now, 'covered'), now)).toBeNull();
    expect(settleNeed(demoSettle(now, 'short'), now)).toMatchObject({ title: 'Card settlement · $1,513.60 short', meta: 'Fund by 09:00 · cut-off Thu 13:00', owner: 'Two people', action: 'Fund →' });
    expect(settleNeed(demoSettle(now, 'ontrack'), now)).toMatchObject({ title: 'Card settlement · On track', meta: 'Desk moves it at 08:00 · cut-off Thu 13:00', owner: 'The desk has it', action: 'Review →' });
  });
  test('its own sheet in Money’s chain, the reference’s CSS', () => {
    expect(host).toContain("money: ['g', 'fm', 'n', 'sf'],");
  });
});

describe('the demo follows the reference’s four states', () => {
  const now = new Date(2026, 9, 21, 16, 4).getTime();
  test('Covered, On track, Short and Stopped', () => {
    expect((['covered', 'ontrack', 'short', 'stopped'] as const).map((s) => demoSettle(now, s).verdict.label)).toEqual(['Covered', 'On track', 'Short', 'Desk stopped']);
    expect(demoSettle(now, 'short').verdict.cells.map((c: any) => c.value)).toEqual(['$5,850.00', '$4,336.40', '$1,513.60', '09:00']);
  });
});

describe('manual funding goes through the proposals flow', () => {
  test('each source’s button proposes its Money action; run and stop are the one-person routes', () => {
    for (const k of ["card: 'settlement-book'", "card: 'settlement-deploy'", "card: 'settlement-margin'", "card: 'settlement-restart'"]) expect(money).toContain(k);
    expect(money).toContain("return run('money', K.card,");
    expect(money).toContain("api('POST', '/settlement-funding/run')");
    expect(money).toContain("api('POST', '/settlement-funding/stop', {");
    // nothing here sends money from a key of its own
    expect(card).not.toMatch(/privateKey|eth_sendTransaction|signTransaction/);
  });
  test('the reference’s preview chips aren’t shipped', () => {
    expect(card).not.toContain('nsfpv');
    expect(money).not.toContain('nsfpv');
  });
});

describe('the Pool Tier principal worksheet stays, read-only', () => {
  test('the posted figure with the worksheet’s, suggested', () => {
    expect(worksheet).toContain("api('GET', '/pool-tier-principal')");
    expect(worksheet).toContain('Suggested — the valuation signers post it');
    expect(worksheet).not.toMatch(/privateKey|PRIVATE_KEY|signTransaction|eth_sendTransaction|'POST'/);
  });
});

describe('Build → Security: automatic jobs (decisions 51 and 54)', () => {
  test('the settlement funding desk is a row of the one AUTO card, beside payout top-ups (once), live from the API', () => {
    expect(build).toContain('const AUTO = LV ? LV.AUTO : [');
    expect(buildLive).toContain('AUTO: Array.isArray(vars.buildAuto) ? vars.buildAuto : null,');
    expect(live).toContain('vars.buildAuto = d.AUTO ?? null;');
    expect(build.match(/t: 'Payout top-ups'/g)?.length).toBe(1);
    expect(build.match(/t: 'Settlement funding'/g)?.length).toBe(1);
    expect(build).toContain("off: ['SETTLEMENT_FUNDING_ENABLED', 'Or stopSettlementFunder() on the Yield Pool']");
  });
  test('Signing names the settlement stages (SA, SR, SL) from the plan reader’s table', () => {
    expect(build).toContain('SGL.stageOf(k)');
  });
});

describe('before the desk has checked: its live state, nothing yet, and a tag', () => {
  test('no “Not real yet”, no notification, nothing to press', () => {
    const off = { ...demoSettle(Date.now(), 'covered'), off: { tag: 'Queued', why: 'The settlement lane waits on its timelock' } };
    expect(settleNeed(off)).toBeNull();
    expect(card).toContain("const btn = (k, t, primary) => (can && !S.off ?");
    expect(card).toContain("{h.can && !S.off ? (S.stopped ?");
    expect(card).toContain("const pillTone = (S) => (S.off ? 'var(--fg-50)' : TONE[S.verdict.tone]);");
  });
});
