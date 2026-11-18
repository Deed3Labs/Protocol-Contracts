import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const money = readFileSync(new URL('./money2.tsx', import.meta.url), 'utf8');
const live = readFileSync(new URL('./moneyLive.ts', import.meta.url), 'utf8');

describe('the AssurancePool on Money, live (Phase 2c)', () => {
  test('reads the new pool’s figure, not the retired RTD one', () => {
    expect(live).toContain("assurance: fig('money.assurance') ?? null,");
    expect(live).not.toContain("fig('money.rtd')");
  });

  test('two compartments, the backstop floor and the coverage, read only', () => {
    // live, Overview's gate shows this cell until every rung of the loss ladder is read (brief update 2); Pools draws the order
    expect(money).toContain('if (L && !ladderRead()) return assuranceCell();');
    expect(money).toContain('Backstop floor');
    expect(money).toContain('Available coverage');
    expect(money).toContain('Draws, grants and transfers need two signers, from their own wallets');
    // Nothing here proposes or sends a pool action.
    const cell = money.slice(money.indexOf('function assuranceCell()'), money.indexOf('function gateCell()'));
    expect(cell).not.toMatch(/data-npropose|requestDraw|releaseDraw|proposeTransfer/);
  });
});

describe('the loss order on Pools, live', () => {
  test('is drawn with the rungs that are read; the rest say so and count as nothing', () => {
    expect(money).not.toContain("notReal('s12', 'If a member stops paying'");
    expect(money).toContain("unread ? 'Not read yet'");
    expect(money).toContain("<b>{unread ? '—' : money(v)}</b>");
    expect(money).toContain('partial = L.slice(0, 4).some(x => x[2] == null)');
  });
  test('Loss Holdback and the rate model are read, not written in', () => {
    expect(money).toContain("Y.holdback == null ? 'Not read yet'");
    expect(money).toContain('const c = L ? Y.curve : null;');
  });
});

describe('the yield pool’s reference cards, live', () => {
  test('Where member payments go and the 30-day pool are drawn live, in the reference’s order', () => {
    expect(money).not.toContain('if (L) return <>{band(flow)}{band(<>{a}{b}</>)}{settle}{band(tbl)}</>;');
    expect(money).toContain('return <>{band(flow)}{band(pay)}{band(proj)}{band(<>{a}{b}</>)}{settle}{band(tbl)}</>;');
  });
  test('member payments come from the issuers’ tiers and the charges, not the demo balances', () => {
    const live = money.slice(money.indexOf('function memberPaymentsLive()'), money.indexOf('function memberPayments()'));
    expect(live).toContain('Y.rates');
    expect(live).toContain('vars.merchantFees');
    expect(live).not.toMatch(/CARRY|MFEE|10689|0\.025/);
  });
  test('live, the projection has no Returns it wasn’t told about', () => {
    expect(money).toContain('const evs = L ? Y.toPayout > 0 ? [{');
  });
});

describe('Money’s reference cards, live (full check, 18 Nov)', () => {
  test('Pools → AssurancePool draws the reference’s two cards from the contract, not the old floor card', () => {
    const live = money.slice(money.indexOf('function poolAPLive()'), money.indexOf('/* Assurance fees (docs/operators'));
    expect(live).toContain("cell('s7', 'Two compartments'");
    expect(live).toContain("cell('s5', 'The backstop this month'");
    expect(live).not.toContain('Against the floor');
    expect(live).not.toMatch(/M\.floor|M\.unsecured \* /);
  });
  test('Pools → Payout pool draws the keeper and the top-up wallet live', () => {
    const live = money.slice(money.indexOf("/* live: the reference's keeper and top-up wallet"), money.indexOf("const lv = M.standShort ? ['Amber'"));
    expect(live).toContain("'Payout funding keeper'");
    expect(live).toContain("'The top-up wallet'");
    expect(live).not.toMatch(/Mon 2 Nov|13980|treasuryAllow/);
  });
  test('Needs you and Done take the jobs’ own records', () => {
    expect(money).toContain("'Top-up waits on CL Operating', `${money(T.needsHuman.remainder)}");
    expect(money).toContain("(AF()?.items ?? []).filter(i => i.status === 'due')");
    expect(money).toContain('N.done = [...L.DONE, ...autoDone()]');
  });
  test('no fixed date in a live legend', () => {
    expect(money).toContain("[L ? 'Clear Lending, within 14 days' : 'Clear Lending, by Mon 2 Nov'");
  });
});

describe('Home, live', () => {
  const home = readFileSync(new URL('./homeHub.tsx', import.meta.url), 'utf8');
  test('the third vital is Payout funding, graded as the keeper grades it', () => {
    expect(home).not.toContain('Loss cover');
    expect(home).toContain('M.payout < due30 ? `Amber');
  });
  test('heads-up and the timeline come from what’s recorded', () => {
    expect(home).toContain('heads: [...liveHeads(), ...ALERTS0');
    expect(home).toContain('past: livePast()');
    expect(home).toContain('...liveDue(now)');
  });
});
