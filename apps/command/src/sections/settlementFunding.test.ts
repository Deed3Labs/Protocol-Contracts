import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const card = readFileSync(new URL('./settlementFunding.tsx', import.meta.url), 'utf8');
const money = readFileSync(new URL('./money2.tsx', import.meta.url), 'utf8');
const build = readFileSync(new URL('./build2.tsx', import.meta.url), 'utf8');
const buildLive = readFileSync(new URL('./buildLive.ts', import.meta.url), 'utf8');
const live = readFileSync(new URL('../live/sections.ts', import.meta.url), 'utf8');

describe('Card settlement funding on Money → Pools → Yield pool (decision 54)', () => {
  test('the card sits on the yield pool, from the money section live and the sample in the demo, as the top-ups card does', () => {
    expect(live).toContain('vars.settlementFunding = d.SETTLEMENT_FUNDING ?? null;');
    expect(money).toContain('const SF = L ? vars.settlementFunding : demoSettlement(Date.now());');
    expect(money).toContain("cell('s7', 'Card settlement funding', ...settlementParts(SF, money))");
    expect(money).toContain('SETTLEMENT_FUNDING_ENABLED');
  });

  test('shows the cut-off and what is due, the CSA and buffer, the netting, sent and returned, the funder limit and the halt', () => {
    for (const words of [
      'Next cut-off',
      'Credit Settlement Account · buffer',
      'Today’s netting · Collection Account',
      'booked to the CSA',
      'Settlement Funding today · sent / returned',
      'Funder limit · every',
      'Settlement Headroom',
      'Stopped after move #',
      'clearSettlementFundingHalt.ts',
    ])
      expect(card).toContain(words);
    // the netting is labelled for what it is: the two flows are not matched one against the other
    expect(card).toContain('Collections and new draws are not matched one against the other');
  });

  test('the four states: normal, short (with the remainder batches), halted, lane not set up', () => {
    expect(card).toContain("if (S.halted) return 'halted';");
    expect(card).toContain("if (S.setup?.length) return 'setup';");
    expect(card).toContain("if (S.needsHuman) return 'short';");
    expect(card).toContain('The settlement lane isn’t set up');
    // a lane stopped on chain (stopSettlementFunder) says so beside its limit
    expect(card).toContain("S.lane.stopped ? ' · stopped' : ''");
    expect(card).toContain('settlement-remainder-deployers.json');
    expect(card).toContain('settlement-remainder-cl-operating.json');
    expect(card).toContain('The ESA vault is never a source.');
  });

  test('the Pool Tier principal: the posted figure with the worksheet’s, suggested, read-only', () => {
    expect(money).toContain('<PoolTierPrincipal demo={!L} money={money} />');
    expect(card).toContain("api('GET', '/pool-tier-principal')");
    expect(card).toContain('Suggested — the valuation signers post it');
    // nothing here posts it, or signs anything
    expect(card).not.toMatch(/privateKey|PRIVATE_KEY|signTransaction|eth_sendTransaction|'POST'/);
  });
});

describe('Build → Security: automatic jobs (decisions 51 and 54)', () => {
  test('the settlement funding desk is a row of the one AUTO card, beside payout top-ups (once), live from the API', () => {
    // one card, driven by AUTO (the API's autoJobs live, the reference's rows in the demo)
    expect(build).toContain('const AUTO = LV ? LV.AUTO : [');
    expect(buildLive).toContain('AUTO: Array.isArray(vars.buildAuto) ? vars.buildAuto : null,');
    expect(live).toContain('vars.buildAuto = d.AUTO ?? null;');
    expect(build).not.toContain('jobsCell');
    expect(live).not.toContain('AUTOMATIC_JOBS');
    expect(build.match(/t: 'Payout top-ups'/g)?.length).toBe(1);
    expect(build.match(/t: 'Settlement funding'/g)?.length).toBe(1);
    expect(build).toContain("off: ['SETTLEMENT_FUNDING_ENABLED', 'Or stopSettlementFunder() on the Yield Pool']");
  });

  test('Signing names the settlement stages (SA, SR, SL) from the plan reader’s table', () => {
    expect(build).toContain('SGL.stageOf(k)');
  });
});
