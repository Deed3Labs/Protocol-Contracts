// @ts-nocheck: ported from the redesign's BUILD2 module (design/command-center-ui) with scripts/port/module.cjs; its data is its own.
import { Fragment } from 'react';
import { attrs, css, hasHtml, html } from '../runtime/dom';
import { LIVE as LIVE_APP, REAL } from '../live/env';
import { act } from '../live/actions';
import { reloadSection } from '../live/sections';
import { buildLive } from './buildLive';
import { CC } from './cc';
import { openCFlow } from './contracts';
import { LOG, S } from './data';
import { registerPage, shadowHost } from './pageHost';
import { openItem, render as renderShell, toast, vLevel } from './shell';

/*
 * Build (design/command-center-ui, the BUILD2 module): the code behind every app and the contracts it
 * ships to, in five tabs (Overview, Changes, Contracts, Deploys, Security), with side panels for a
 * change, a contract, a finding and an incident. It lives in its own shadow root (pageHost.tsx); its
 * inner module reads the root through a document stand-in (DOCP), as the reference has it. Links out
 * go through CC.go, so they land on the right page and pane.
 *
 * Live (REAL), its datasets are buildLive()'s (`LV`: named so, not L, as the module uses L for its own
 * lists): the indexer's contracts and releases, the GitHub poller's commits and pull requests, and the
 * Ops Safe's owners and queue, and Command's own records of incidents, findings and audits (written from
 * here). What nothing records yet (checks, the apps' deploys, reviews) says "Not real yet", and its buttons
 * are hidden.
 */

/** The page's skeleton: the reference template's markup. */
function skeleton() {
  return <div className="gw bw" id="bw"><div className="hdr stack" id="hdr" /><nav className="gtabs" aria-label="Build views"><button data-btab="overview">Overview</button><button data-btab="changes">Changes</button><button data-btab="contracts">Contracts</button><button data-btab="deploys">Deploys</button><button data-btab="security">Security</button></nav><div id="bv" /></div>;
}
function makeBuild() {
  const { host, R: SR, W, into } = shadowHost('build', skeleton());
  const LV = REAL ? buildLive() : null;
  const LIVE = () => host.isConnected && CC.route() === 'build';
  const RO = () => CC.viewing() && vLevel('build') < 3;
  const TOT = () => CC.viewing() && vLevel('build') === 1;
  const meKey = () => {
    // live, the signed-in person (the prototype's view picks one of its demo people)
    if (LV) return LV.me;
    const v = S.view;
    if (!v) return 'kai';
    return {
      K: 'kai',
      DR: 'dana',
      BS: 'bs',
      ML: 'marcus'
    }[v.person] || {
      admin: 'kai',
      protocol: 'dana',
      board: 'bs',
      field: 'marcus'
    }[v.g] || 'viewer';
  };
  const ROOT_EV = new Set(['click', 'input', 'change']);
  const DOCP = {
    getElementById: id => SR.getElementById(id),
    querySelector: q => SR.querySelector(q) || (q === '.modal' ? document.querySelector(q) : null),
    querySelectorAll: q => SR.querySelectorAll(q),
    createElement: t => document.createElement(t),
    get body() {
      return W;
    },
    get documentElement() {
      return document.documentElement;
    },
    addEventListener: (t, f, o) => (ROOT_EV.has(t) ? SR : document).addEventListener(t, f, o)
  };
  function goOut(path) {
    const [r, sub] = path.split('/');
    return CC.go(r, sub);
  }
  let API = null;
  function setHash() {
    if (!LIVE()) return;
    const t = API.tab();
    try {
      history.replaceState(null, '', '#build' + (t === 'overview' ? '' : '/' + t));
    } catch (e) {}
  }
  API = (document => {
    /* ══ Build data — the Command Center's own contract figures (map, releases, Ops Safe), plus the code behind every app ══════
       Demo "today" is Wed 21 Oct 2026, 14:00. 30 of 31 contracts live on Base Sepolia. AssurancePool v1.3 waits on Kai (Dana signed).
       Rosa's cap is in the 24-hour wait. RevolvingIssuer v1.3 went live today. */
    const DAY = 864e5,
      TODAY = LV ? LV.TODAY : Date.UTC(2026, 9, 21),
      NOW = LV ? LV.NOW : TODAY + 14 * 3600e3;
    const D = (m, d, y = 2026, h = 0) => Date.UTC(y, m - 1, d, h);
    const H = (m, d, h, mi = 0) => Date.UTC(2026, m - 1, d, h, mi);
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fmtD = t => `${new Date(t).getUTCDate()} ${MON[new Date(t).getUTCMonth()]}`;
    const WD = t => new Date(t).toLocaleDateString('en-US', {
      weekday: 'short',
      timeZone: 'UTC'
    });
    const hm = t => new Date(t).toISOString().slice(11, 16);
    const leaf = (t, month = true) => <span className="leaf"><span>{WD(t)}</span><b>{new Date(t).getUTCDate()}</b>{month ? <span>{MON[new Date(t).getUTCMonth()]}</span> : ''}</span>;
    const ago = t => {
      const m = Math.round((NOW - t) / 6e4);
      if (m < 60) return `${Math.max(1, m)} min ago`;
      const h = Math.round(m / 60);
      if (h < 24) return `${h} h ago`;
      const d = Math.round(h / 24);
      return d === 1 ? 'yesterday' : `${d} days ago`;
    };
    const dayLbl = t => {
      const d = Math.round((TODAY - Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate())) / DAY);
      return d === 0 ? 'Today' : d === 1 ? 'Yesterday' : `${WD(t)} ${fmtD(t)}`;
    };
    const mkey = items => <div className="mkey">{items.map(([c, t], __k) => <span key={__k}><i className="sw" style={css(`background:${c}`)} />{t}</span>)}</div>;
    const int = n => Math.round(n).toLocaleString('en-US');

    /* people: who writes code, who reviews, who signs */
    const PPL = LV ? LV.PPL : {
      kai: {
        n: 'Kai',
        ini: 'K',
        role: 'Admin',
        eng: true,
        signer: true
      },
      dana: {
        n: 'Dana Ruiz',
        ini: 'DR',
        role: 'ClearLabs',
        eng: true,
        signer: true
      },
      bs: {
        n: 'Board signer',
        ini: 'BS',
        role: 'Co-op board',
        signer: true
      },
      marcus: {
        n: 'Marcus Lee',
        ini: 'ML',
        role: 'Field'
      },
      bot: {
        n: 'Dependabot',
        ini: 'DB',
        bot: true
      },
      viewer: {
        n: 'Viewer',
        ini: 'VW',
        role: 'Read-only'
      }
    };

    /* every project. The contracts, both apps and the API and SDK share one monorepo (Protocol-Contracts, default branch dev),
       so they share one PR sequence and one Dependabot feed; checks run per folder, so a red member app blocks only changes that touch apps/member. */
    const REPOS = LV ? LV.REPOS : [{
      id: 'proto',
      name: 'Protocol-Contracts',
      org: 'Deed3Labs',
      path: 'contracts',
      what: 'Smart contracts',
      lang: 'Solidity · Foundry',
      branch: 'dev',
      main: 'pass',
      runs: 48,
      rate: .96,
      dur: '4m 12s',
      cov: 81,
      tests: 412,
      last: H(10, 21, 11, 40),
      live: 'Base Sepolia · 30 of 31'
    }, {
      id: 'app',
      name: 'Protocol-Contracts',
      org: 'Deed3Labs',
      path: 'apps/member',
      what: 'Member app',
      lang: 'TypeScript · PWA',
      branch: 'dev',
      main: 'fail',
      runs: 71,
      rate: .88,
      dur: '6m 40s',
      cov: 64,
      tests: 286,
      last: H(10, 21, 12, 5),
      live: 'Sandbox · #129',
      failing: 'e2e › move money › shows “Repay $400.00”',
      failSince: H(10, 20, 18, 52)
    }, {
      id: 'merchant',
      name: 'Protocol-Contracts',
      org: 'Deed3Labs',
      path: 'apps/merchant',
      what: 'Merchant app',
      lang: 'TypeScript · tablet PWA',
      branch: 'dev',
      main: 'pass',
      runs: 33,
      rate: .94,
      dur: '3m 05s',
      cov: 58,
      tests: 148,
      last: H(10, 19, 16, 20),
      live: 'Sandbox · #127'
    }, {
      id: 'sdk',
      name: 'Protocol-Contracts',
      org: 'Deed3Labs',
      path: 'packages/sdk',
      what: 'API and SDK',
      lang: 'TypeScript · npm',
      branch: 'dev',
      main: 'pass',
      runs: 41,
      rate: .98,
      dur: '1m 20s',
      cov: 77,
      tests: 164,
      last: H(10, 21, 10, 30),
      live: 'Railway · SDK 0.4.2'
    }, {
      id: 'site',
      name: 'clearpath-website',
      org: 'ClearLabs',
      what: 'useclear.org',
      lang: 'Astro',
      branch: 'main',
      main: 'pass',
      runs: 22,
      rate: 1,
      dur: '52s',
      cov: null,
      tests: 36,
      last: H(10, 17, 10, 10),
      live: 'Production · #40'
    }, {
      id: 'cc',
      name: 'command-center',
      org: 'ClearLabs',
      what: 'This app',
      lang: 'TypeScript · Railway',
      branch: 'main',
      main: 'run',
      runs: 39,
      rate: .97,
      dur: '1m 48s',
      cov: 52,
      tests: 94,
      last: H(10, 21, 13, 50),
      live: 'Railway · testnet'
    }];
    const REPO = Object.fromEntries(REPOS.map(r => [r.id, r]));
    const RSHORT = {
      proto: 'Protocol',
      app: 'Member app',
      merchant: 'Merchant app',
      sdk: 'API and SDK',
      site: 'Website',
      cc: 'Command Center'
    };
    const RTINY = {
      proto: 'Contracts',
      app: 'App',
      merchant: 'Merchant',
      sdk: 'SDK',
      site: 'Site',
      cc: 'CC'
    };
    // live, a project's names are the API's (every project in the monorepo)
    if (LV) Object.assign(RSHORT, LV.RSHORT), Object.assign(RTINY, LV.RTINY);
    const MONO = REPOS.filter(r => r.path);

    /* changes: code (a pull request), upgrade (contract code that goes through the Ops Safe) and setting (an on-chain setting, no code) */
    const CHANGES = LV ? LV.CHANGES : [/* in progress */
    {
      id: 'c131',
      repo: 'proto',
      num: 130,
      kind: 'code',
      t: 'AssuranceOracle: price with a TWAP, not slot0',
      by: 'dana',
      st: 'draft',
      checks: 'run',
      plus: 184,
      minus: 41,
      files: 6,
      opened: H(10, 19, 15),
      upd: H(10, 21, 11, 40),
      contract: 'ao',
      finding: 'F2',
      note: 'Reads a time-weighted price with observe() instead of the spot price, so a flash loan can’t move it.'
    }, {
      id: 'a214',
      repo: 'app',
      num: 126,
      kind: 'code',
      t: 'Term plans shelf',
      by: 'kai',
      st: 'draft',
      checks: 'pass',
      plus: 1240,
      minus: 86,
      files: 23,
      opened: H(10, 16, 10),
      upd: H(10, 21, 9, 20),
      note: 'The shelf of term plans on the Earn page, with the split schedule and the opening date.'
    }, {
      id: 'd133',
      repo: 'sdk',
      num: 133,
      kind: 'code',
      t: 'SDK types for AssurancePool v1.3',
      by: 'dana',
      st: 'draft',
      checks: 'pass',
      plus: 96,
      minus: 40,
      files: 6,
      opened: H(10, 21, 10),
      upd: H(10, 21, 10, 30),
      contract: 'ap',
      after: 'u-ap',
      note: 'Regenerated from the v1.3 ABI. Merges only once the upgrade is live, so the apps never call a function the chain doesn’t have yet.'
    }, {
      id: 'k58',
      repo: 'cc',
      num: 58,
      kind: 'code',
      t: 'Build page',
      by: 'kai',
      st: 'draft',
      checks: 'run',
      plus: 2310,
      minus: 640,
      files: 9,
      opened: H(10, 21, 12, 30),
      upd: H(10, 21, 13, 50),
      note: 'Contracts becomes Build: smart contracts and the code behind every app. Agreements move to Governance.'
    }, /* in review */
    {
      id: 'a212',
      repo: 'app',
      num: 132,
      kind: 'code',
      t: 'Fix the Repay label test on dev',
      by: 'dana',
      st: 'review',
      checks: 'pass',
      rev: 'kai',
      plus: 38,
      minus: 12,
      files: 3,
      opened: H(10, 21, 9, 15),
      upd: H(10, 21, 12, 5),
      incident: 'I2',
      note: '#129 changed the button to “Repay $400.00” but the end-to-end test still looked for “Repay”. The member app on dev has been failing since 18:52 yesterday. Other folders still merge.'
    }, {
      id: 'm88',
      repo: 'merchant',
      num: 131,
      kind: 'code',
      t: 'Partial refunds',
      by: 'kai',
      st: 'review',
      checks: 'pass',
      rev: 'dana',
      also: ['sdk'],
      plus: 612,
      minus: 94,
      files: 14,
      opened: H(10, 20, 11),
      upd: H(10, 21, 8, 40),
      note: 'Refund part of a sale from the receipt. The member’s balance moves back by the same amount.'
    }, {
      id: 'c130',
      repo: 'proto',
      num: 128,
      kind: 'code',
      t: 'BurnerBond: OpenZeppelin v5 paths',
      by: 'dana',
      st: 'review',
      checks: 'fail',
      revState: 'changes',
      reviewer: 'kai',
      plus: 92,
      minus: 77,
      files: 5,
      opened: H(10, 18, 14),
      upd: H(10, 20, 16),
      contract: 'bb',
      finding: 'F4',
      note: 'Counters and security/ReentrancyGuard are gone in v5. Pins the version and moves the imports. One fuzz test still fails on the factory.'
    }, {
      id: 's41',
      repo: 'site',
      num: 41,
      kind: 'code',
      t: 'Shops page: enquiries go to Merchants',
      by: 'kai',
      st: 'review',
      checks: 'pass',
      revState: 'ok',
      reviewer: 'dana',
      plus: 146,
      minus: 30,
      files: 4,
      opened: H(10, 19, 10),
      upd: H(10, 20, 15),
      note: 'The enquiry form on /shops posts to the Command Center, so new shops land in Merchants → Pipeline.'
    }, {
      id: 'k57',
      repo: 'cc',
      num: 57,
      kind: 'code',
      t: 'Bump vite 5.4.8 → 5.4.10',
      by: 'bot',
      st: 'review',
      checks: 'pass',
      plus: 14,
      minus: 14,
      files: 2,
      opened: H(10, 20, 6),
      upd: H(10, 20, 6, 12),
      note: 'Patch release. No breaking changes listed.'
    }, /* the Ops Safe: 2 of 3 sign, then a 24-hour wait */
    {
      id: 'u-ap',
      repo: 'proto',
      num: 122,
      kind: 'upgrade',
      t: 'AssurancePool v1.3',
      by: 'dana',
      st: 'safe',
      contract: 'ap',
      finding: 'F1',
      sigs: {
        dana: H(10, 20, 9)
      },
      need: 'kai',
      opened: H(10, 12, 10),
      merged: H(10, 18, 11),
      checks: 'pass',
      plus: 236,
      minus: 58,
      files: 7,
      note: 'Gates every withdrawal behind a role, so only bonds, credit and lending can claim. Closes the open withdraw.',
      sim: 'Simulated on a Base Sepolia fork · 412 tests pass'
    }, {
      id: 'u-rosa',
      kind: 'setting',
      t: 'Raise Rosa’s cap to $150.00',
      by: 'marcus',
      st: 'safe',
      contract: 'mr',
      sigs: {
        dana: H(10, 20, 18)
      },
      need: 'kai',
      opened: H(10, 19, 11),
      from: 'Merchants',
      note: 'Rosa’s Panadería hit the $100.00 cap 3 times this week with no losses. Proposed from Merchants.'
    }, {
      id: 'u-dt',
      kind: 'setting',
      t: 'Register D&T Co. as a validator',
      by: 'kai',
      st: 'safe',
      contract: 'vr',
      block: 'Waits on formation',
      opened: H(10, 16, 10),
      from: 'Governance',
      note: 'The Deed & Title Co. reviews title before a deed is minted. Goes to signing once the company is formed.'
    }, {
      id: 'u-icw',
      kind: 'setting',
      t: 'Add Inland Cycle Works',
      by: 'marcus',
      st: 'safe',
      contract: 'mr',
      block: 'Waits on the agreement',
      opened: H(10, 20, 16),
      from: 'Merchants',
      note: 'NET-30, 2.5% fee, $100.00 cap. Goes to signing once the agreement is signed.'
    }, /* shipped, last 7 days */
    {
      id: 'u-ri',
      repo: 'proto',
      num: 123,
      kind: 'upgrade',
      t: 'RevolvingIssuer v1.3',
      by: 'dana',
      st: 'shipped',
      contract: 'ri',
      sigs: {
        dana: H(10, 19, 15),
        kai: H(10, 20, 10)
      },
      live: H(10, 21, 10),
      opened: H(10, 13, 10),
      checks: 'pass',
      plus: 318,
      minus: 120,
      files: 9,
      note: 'Draws cheapest tier first, repays most expensive first.'
    }, {
      id: 'k55',
      repo: 'cc',
      num: 55,
      kind: 'code',
      t: 'Field route planner',
      by: 'kai',
      st: 'shipped',
      live: H(10, 20, 21),
      checks: 'pass',
      plus: 3120,
      minus: 410,
      files: 11,
      opened: H(10, 17, 9)
    }, {
      id: 'u-up',
      kind: 'setting',
      t: 'Add Uptown Barber',
      by: 'marcus',
      st: 'shipped',
      contract: 'mr',
      sigs: {
        dana: H(10, 19, 9),
        kai: H(10, 19, 12)
      },
      live: H(10, 20, 12),
      opened: H(10, 18, 9),
      from: 'Merchants'
    }, {
      id: 'a209',
      repo: 'app',
      num: 129,
      kind: 'code',
      t: 'Repay button shows the amount',
      by: 'kai',
      st: 'shipped',
      live: H(10, 20, 18, 40),
      checks: 'pass',
      plus: 64,
      minus: 18,
      files: 4,
      opened: H(10, 19, 10),
      incident: 'I2',
      note: 'Merged with checks passing; the end-to-end test that broke runs only after a merge to dev.'
    }, {
      id: 'm86',
      repo: 'merchant',
      num: 127,
      kind: 'code',
      t: 'Scan directions on the counter screen',
      by: 'kai',
      st: 'shipped',
      live: H(10, 19, 16, 20),
      checks: 'pass',
      plus: 288,
      minus: 61,
      files: 8,
      opened: H(10, 17, 11)
    }, {
      id: 's40',
      repo: 'site',
      num: 40,
      kind: 'code',
      t: 'Less wordy homepage',
      by: 'kai',
      st: 'shipped',
      live: H(10, 17, 10, 10),
      checks: 'pass',
      plus: 402,
      minus: 960,
      files: 12,
      opened: H(10, 15, 13)
    }, {
      id: 'c129',
      repo: 'proto',
      num: 121,
      kind: 'code',
      t: 'Deploy LendingPool, BondVault and BondValuer',
      by: 'dana',
      st: 'shipped',
      live: H(10, 14, 16),
      checks: 'pass',
      plus: 540,
      minus: 22,
      files: 10,
      opened: H(10, 9, 10)
    }];
    const CHG = Object.fromEntries(CHANGES.map(c => [c.id, c]));
    const STAGES = LV ? [['draft', 'In progress', 'Drafts, and commits not released'], ['review', 'In review', 'Open pull requests'], ['safe', 'Ops Safe', LV.safe ? `On-chain · ${LV.threshold} of ${LV.safe.owners.length} sign` : 'On-chain · no Ops Safe yet'], ['shipped', 'Shipped', 'Last 7 days']] : [['draft', 'In progress', 'Drafts and work in progress'], ['review', 'In review', 'Needs a review and passing checks'], ['safe', 'Ops Safe', 'On-chain · 2 of 3 sign, then 24 hours'], ['shipped', 'Shipped', 'Last 7 days']];

    /* recent commits */
    const COMMITS = LV ? LV.COMMITS : [[H(10, 21, 13, 50), 'cc', 'kai', 'Build: change board and review panel', '3f9a1c2'], [H(10, 21, 12, 5), 'app', 'dana', 'Test: look for the Repay amount, not the word', 'e91b04d'], [H(10, 21, 11, 40), 'proto', 'dana', 'AssuranceOracle: observe() over a 30-minute window', 'b7c5a10'], [H(10, 21, 10, 30), 'sdk', 'dana', 'SDK: regenerate AssurancePool v1.3 types', 'd81c4f0'], [H(10, 21, 9, 20), 'app', 'kai', 'Term plans: split schedule preview', '4d2f8e6'], [H(10, 21, 9, 15), 'app', 'dana', 'Test: repro for the failing e2e', 'a03c771'], [H(10, 20, 21, 0), 'cc', 'kai', 'Field: route planner and the week strip', '71e0b5c'], [H(10, 20, 18, 40), 'app', 'kai', 'Move money: Repay $400.00 on the button', '7c2e9d1'], [H(10, 20, 16, 0), 'proto', 'dana', 'BurnerBond: ReentrancyGuard from utils', 'c4a8d02'], [H(10, 20, 11, 0), 'merchant', 'kai', 'Refunds: partial amount from the receipt', '52ff1e9'], [H(10, 19, 16, 20), 'merchant', 'kai', 'Counter: scan directions under the code', '08b6c3a'], [H(10, 19, 15, 0), 'proto', 'dana', 'RevolvingIssuer: repay most expensive tier first', '9c41e2a'], [H(10, 19, 10, 0), 'site', 'kai', 'Shops: enquiry form posts to the Command Center', 'e5d3a77'], [H(10, 18, 14, 0), 'proto', 'dana', 'Pin OpenZeppelin 5.0.2', '16af0b8'], [H(10, 18, 11, 0), 'proto', 'dana', 'AssurancePool: claims only through a role', 'fa31c9d'], [H(10, 17, 10, 10), 'site', 'kai', 'Home: cut the copy by half', '2b8e4f1'], [H(10, 17, 9, 0), 'cc', 'kai', 'Merchants: pipeline board', '6a90d3e']];

    /* commits per repo per day, last 28 days (to 21 Oct) */
    const rnd = s => {
      let x = s;
      return () => (x = x * 16807 % 2147483647) / 2147483647;
    };
    const ACT = LV ? LV.ACT : Object.fromEntries(REPOS.map((r, i) => {
      const R = rnd(97 + i * 31),
        base = {
          proto: 2.4,
          app: 3.1,
          merchant: 1.6,
          sdk: 1.1,
          site: .7,
          cc: 2.8
        }[r.id];
      return [r.id, Array.from({
        length: 28
      }, (_, d) => {
        const wd = new Date(TODAY - (27 - d) * DAY).getUTCDay(),
          wk = wd === 0 || wd === 6 ? .25 : 1;
        return Math.max(0, Math.round(base * wk * (.3 + R() * 1.5) - (R() < .2 ? 2 : 0)));
      })];
    }));

    /* where each repo runs */
    const ENVS = [['preview', 'Preview', 'Per pull request'], ['test', 'Testnet or sandbox', 'Base Sepolia · Lithic, Bridge and Plaid sandboxes'], ['prod', 'Production', 'Base mainnet · live providers']];
    const ENV = LV ? LV.ENV : {
      proto: {
        preview: ['Local fork', 'Each PR runs on a Base Sepolia fork', 'ok'],
        test: ['Base Sepolia', '30 of 31 contracts · RevolvingIssuer v1.3 today', 'ok'],
        prod: ['Not deployed', 'Needs the Phase 0 fixes and an external audit', 'no']
      },
      app: {
        preview: ['4 previews', 'One per open PR', 'ok'],
        test: ['Sandbox · #129', 'Deployed 20 Oct · dev failing since', 'warn'],
        prod: ['Not launched', 'Members are on the waitlist', 'no']
      },
      merchant: {
        preview: ['2 previews', 'One per open PR', 'ok'],
        test: ['Sandbox · #127', 'Deployed 19 Oct', 'ok'],
        prod: ['Not launched', 'Founding shops use the sandbox', 'no']
      },
      sdk: {
        preview: ['Canary per PR', 'Built and typed against the PR’s contracts', 'ok'],
        test: ['API on Railway · SDK 0.4.2', 'npm next tag · deployed today 10:30', 'ok'],
        prod: ['Not published', 'Goes public with mainnet', 'no']
      },
      site: {
        preview: ['1 preview', '#41', 'ok'],
        test: ['—', 'The site has no sandbox', 'na'],
        prod: ['useclear.org · #40', 'Live since 17 Oct', 'ok']
      },
      cc: {
        preview: ['1 preview', '#58 · this page', 'ok'],
        test: ['Railway · demo data', 'Deployed today 09:12', 'ok'],
        prod: ['Not launched', 'Goes live with the backend', 'no']
      }
    };
    const DEPLOYS = LV ? LV.DEPLOYS : [[H(10, 21, 10, 0), 'proto', 'test', 'RevolvingIssuer v1.3', 'Ops Safe', 'ok', 'Upgrade · 2 of 3 signed'], [H(10, 21, 9, 12), 'cc', 'test', '3f9a1c2', 'kai', 'ok', '1m 48s'], [H(10, 20, 18, 40), 'app', 'test', '#129 · 7c2e9d1', 'kai', 'warn', '2m 31s · e2e failing since'], [H(10, 19, 16, 20), 'merchant', 'test', '#127 · 08b6c3a', 'kai', 'ok', '1m 55s'], [H(10, 17, 10, 10), 'site', 'prod', '#40 · 2b8e4f1', 'kai', 'ok', '41s'], [H(10, 14, 16, 0), 'proto', 'test', 'LendingPool, BondVault, BondValuer v1.0', 'Ops Safe', 'ok', '3 contracts · 2 of 3 signed'], [H(10, 14, 11, 5), 'app', 'test', '#125 · 1f7d9a0', 'dana', 'back', 'Rolled back after 12 min · missing env var'], [H(10, 14, 11, 20), 'app', 'test', '#124 · 6b0e2c4', 'dana', 'ok', 'Restored'], [H(10, 8, 15, 0), 'proto', 'test', 'TermIssuer, Liquidator, SavingsIntent v1.0', 'Ops Safe', 'ok', '3 contracts'], [H(10, 6, 10, 0), 'proto', 'test', 'PayoutPool v0.9', 'Ops Safe', 'ok', 'Upgrade · oldest claim first']];

    /* security */
    const SEV = {
      critical: ['Critical', 'var(--absent)'],
      high: ['High', 'var(--underway)'],
      medium: ['Medium', 'color-mix(in srgb,var(--fg) 60%,transparent)'],
      low: ['Low', 'var(--line)']
    };
    const FINDINGS = LV ? LV.FINDINGS : [{
      id: 'F1',
      sev: 'critical',
      t: 'Anyone can withdraw from the AssurancePool',
      contract: 'ap',
      where: 'AssurancePool v1.2 · withdraw and withdrawToken',
      found: D(10, 10),
      by: 'Internal review',
      st: 'waiting',
      fix: 'u-ap',
      note: 'Both functions are public, and spare reserve is tracked by token rather than by depositor, so any address could take it. Nothing has been taken: the spare is $305.52 and no withdrawals have been made.'
    }, {
      id: 'F2',
      sev: 'high',
      t: 'The oracle price can be moved in one transaction',
      contract: 'ao',
      where: 'AssuranceOracle v1.0 · Uniswap V3 slot0',
      found: D(10, 10),
      by: 'Internal review',
      st: 'fixing',
      fix: 'c131',
      note: 'slot0 is the spot price, so a flash loan can push it and pull it back inside one transaction. A time-weighted price can’t be moved that way.'
    }, {
      id: 'F3',
      sev: 'medium',
      t: 'RTD counts asset-backed credit in full',
      contract: 'cr',
      where: 'CollateralRegistry · pool exposure',
      found: D(10, 10),
      by: 'Internal review',
      st: 'open',
      note: 'Asset-backed debt should count only its shortfall after a haircut. Nothing is affected yet: no asset-backed credit has been issued.'
    }, {
      id: 'F5',
      sev: 'medium',
      t: '3 dependency alerts in the member app',
      repo: 'app',
      where: 'Protocol-Contracts · apps/member · build tooling',
      found: D(10, 19),
      by: 'Dependabot',
      st: 'open',
      note: '1 high and 2 moderate, all in build tools. None of it ships to members. Alerts come for the whole monorepo, so each one is filed under the folder it touches.'
    }, {
      id: 'F4',
      sev: 'low',
      t: 'BurnerBond uses OpenZeppelin v4 paths',
      contract: 'bb',
      where: 'BurnerBond v1.0 · imports',
      found: D(10, 10),
      by: 'Internal review',
      st: 'fixing',
      fix: 'c130',
      note: 'Counters and security/ReentrancyGuard are gone in v5. The fix pins the version and moves the imports.'
    }, {
      id: 'F6',
      sev: 'medium',
      t: 'PayoutPool could pay a newer claim first',
      contract: 'pp',
      where: 'PayoutPool v0.8',
      found: D(9, 25),
      by: 'Internal review',
      st: 'fixed',
      fixedAt: D(10, 6),
      note: 'Fixed in PayoutPool v0.9: claims are paid oldest first, always.'
    }];
    const FSTATE = {
      open: ['Open', 'var(--absent)'],
      fixing: ['Fix in progress', 'var(--underway)'],
      waiting: ['Fix waiting on a signature', 'var(--live)'],
      fixed: ['Fixed', 'var(--settled)']
    };
    const INCIDENTS = LV ? LV.INCIDENTS : [{
      id: 'I1',
      t: 'Plaid sync 3 hours behind',
      st: 'open',
      sev: 'low',
      at: H(10, 21, 8, 12),
      area: 'Money',
      who: 'dana',
      note: 'Operating cash in Money is 3 hours old. Plaid’s status page shows delays for some banks.',
      ev: [[H(10, 21, 8, 12), 'Last good sync'], [H(10, 21, 11, 15), 'Flagged: more than 3 hours behind'], [H(10, 21, 11, 30), 'Dana is watching Plaid’s status page']]
    }, {
      id: 'I2',
      t: 'Member app checks failing on dev',
      st: 'open',
      sev: 'low',
      at: H(10, 20, 18, 52),
      area: 'Member app',
      who: 'dana',
      fix: 'a212',
      note: '#129 changed the Repay button to show the amount; one end-to-end test still looked for the old label. Sandbox still works.',
      ev: [[H(10, 20, 18, 40), '#129 merged and deployed to sandbox'], [H(10, 20, 18, 52), 'e2e failed on dev'], [H(10, 21, 9, 15), 'Dana opened #132 with the fix']]
    }, {
      id: 'I3',
      t: 'Sandbox deploy rolled back',
      st: 'closed',
      sev: 'low',
      at: H(10, 14, 11, 5),
      area: 'Member app',
      who: 'dana',
      dur: '12 min',
      note: '#125 shipped without a new environment variable. Rolled back to #124, then redeployed with it set.',
      ev: [[H(10, 14, 11, 5), '#125 deployed'], [H(10, 14, 11, 9), 'Sign-in failing in sandbox'], [H(10, 14, 11, 17), 'Rolled back to #124']]
    }, {
      id: 'I4',
      t: 'Partner credit paused automatically',
      st: 'closed',
      sev: 'medium',
      at: H(10, 6, 8),
      area: 'TermIssuer',
      who: 'auto',
      dur: '7 days',
      note: 'RTD fell to 19.5%, under the 20% floor, so TermIssuer stopped new partner credit on its own. It reopened on 13 Oct as the AssurancePool grew.',
      ev: [[H(10, 6, 8), 'RTD 19.5% · new partner credit paused'], [H(10, 13, 9), 'RTD back above 20% · reopened']]
    }, {
      id: 'I5',
      t: 'Base Sepolia RPC rate-limited',
      st: 'closed',
      sev: 'low',
      at: H(9, 30, 14),
      area: 'Protocol',
      who: 'dana',
      dur: '40 min',
      note: 'The RPC provider throttled reads. Moved to a second provider as a fallback.',
      ev: [[H(9, 30, 14), 'Reads failing'], [H(9, 30, 14, 40), 'Fallback provider added']]
    }];
    const KEYS = LV ? LV.KEYS : [['Ops Safe', '2 of 3 · Kai, Dana Ruiz, Board signer', 'Admin and pause on every live contract'], ['Deployer key', 'Testnet only · hardware wallet · Dana Ruiz', 'Last used 14 Oct'], ['Provider keys', 'Lithic, Bridge and Plaid sandboxes · in Railway', 'Rotated 30 Sep'], ['GitHub', '3 repos · 2 maintainers · Kai, Dana Ruiz', 'dev and main need a review · CODEOWNERS per folder'], ['Keys in this app', 'None', 'Signing happens in the Ops Safe']];

    /* signers and the Ops Safe */
    const SIGN_W = LV ? LV.SIGN_W : {
      K: [2, 3, 1, 1, 2, 2, 1, 3],
      DR: [3, 4, 2, 1, 1, 2, 1, 3],
      BS: [0, 1, 0, 1, 0, 0, 0, 0]
    };
    const SIGNERS = LV ? LV.SIGNERS : [['kai', 'K', 'Kai', 'Admin', 3.1], ['dana', 'DR', 'Dana Ruiz', 'ClearLabs', 5.4], ['bs', 'BS', 'Board signer', 'Co-op board', 31.0]];
    const CTR = LV ? LV.CTR : [/* id, name, version, layer, status, address, what it does, x, y, band (c credit · d deeds) — addresses from deployments/base-sepolia on the dev branch */
    ['am', 'AccessManager', 'v1.0', 0, 'live', '0x19aB…f207', 'Role-based access for the protocol. Admin is the Ops Safe.', 10, 13, 'c'], ['ms', 'MembershipRegistry', 'v1.0', 0, 'live', '0xE700…4dE8', 'Member entitlements on-chain, no personal data.', 10, 21, 'c'], ['nr', 'NetworkRegistry', 'v1.0', 0, 'live', '0x0a9F…3D7f', 'The parent registry every issuer is registered against.', 10, 37, 'c'], ['cr', 'CollateralRegistry', 'v1.0', 0, 'live', '0x62fB…52Cf', 'What each member has pledged, and what the AssurancePool would pay.', 10, 29, 'c'], ['mr', 'MerchantRegistry', 'v1.0', 0, 'live', '0x4172…f1f5', 'What each shop was promised: payout schedule, cap, fee, status.', 10, 45, 'c'], ['tr', 'TokenRegistry', 'v1.0', 0, 'live', '0x4B13…6a86', 'Which tokens count, with fallback prices.', 10, 53, 'c'], ['lc', 'LimitCalculator', 'v1.0', 1, 'live', '0xbA98…c0a7', 'Turns pledges and attestations into a member’s ceiling.', 30, 21, 'c'], ['ri', 'RevolvingIssuer', 'v1.3', 1, 'live', '0x7f15…6070', 'The tiered revolving line: savings-backed, asset-backed, income and Boost.', 30, 29, 'c'], ['ti', 'TermIssuer', 'v1.0', 1, 'live', '0xe467…3721', 'Term plans: partner credit, Clear Cash and the ELPA.', 30, 53, 'c'], ['lq', 'Liquidator', 'v1.0', 1, 'live', '0x8E2E…9593', 'Turns a defaulted member’s pledged savings into repayment of their own debt.', 30, 69, 'c'], ['cc', 'ClearCredit', 'v1.1', 2, 'live', '0x1d9f…928C', 'The co-op’s credit ledger, the deployable StableCredit. Only issuers mint.', 50, 39, 'c'], ['cu', 'ClearUSD', 'v1.1', 2, 'live', '0x2a11…D6D1', 'CLRUSD, upgradeable. Settles savings and bridges by CCIP.', 50, 69, 'c'], ['ao', 'AssuranceOracle', 'v1.0', 3, 'live', '0x2E52…Fe38', 'Prices reserve tokens.', 70, 13, 'c'], ['ap', 'AssurancePool', 'v1.2', 3, 'live', '0xf5E4…5840', 'Absorbs losses on unsecured credit. RTD reads it and nothing else.', 70, 21, 'c'], ['lp', 'LendingPool', 'v1.0', 3, 'live', '0x5840…ce23', 'Member money funding the unsecured tiers. Takes first loss. Holds $9,000.00 from 18 depositors.', 70, 29, 'c'], ['cp', 'CreditPool', '—', 3, 'later', '—', 'In the repo, not deployed. Members deposit credit for others to draw.', 70, 37, 'c'], ['pp', 'PayoutPool', 'v0.9', 3, 'live', '0xe9d1…7D66', 'Pays shops on the schedule they were promised, oldest claim first.', 70, 45, 'c'], ['esa', 'ESADepositVault', 'v1.1', 3, 'live', '0x8364…413b', 'Member savings, CLRUSD backed 1:1 by USDC.', 70, 69, 'c'], ['ce', 'ClaimEscrow', 'v1.0', 3, 'live', '0x24DA…c37D', 'Holds USDC sent by link until it’s claimed or refunded.', 70, 53, 'c'], ['si', 'SavingsIntent', 'v1.0', 3, 'live', '0xee28…C8Bc', 'One-transfer escrows that turn a deposit into savings.', 70, 61, 'c'], ['bb', 'BurnerBond', 'v1.0', 4, 'live', '0x4d96…c148', 'Zero-coupon bonds, one token each, with their factory and deposit. 6 issued.', 90, 21, 'c'], ['bv', 'BondVault', 'v1.0', 4, 'live', '0x9f31…A855', 'Where bond proceeds live, behind a redemption reserve. Holds $25,000.00 for 6 bonds.', 90, 29, 'c'], ['bvl', 'BondValuer', 'v1.0', 1, 'live', '0x64d5…0d2C', 'What a member’s pledged bonds are worth today, for CollateralRegistry.', 30, 61, 'c'], ['vr', 'ValidatorRegistry', 'v1.0', 0, 'live', '0x979E…bc91', 'Which validators may approve deeds, and for what.', 10, 84, 'd'], ['va', 'Validator', 'v1.0', 1, 'live', '0x18C5…79b9', 'Checks a deed’s title and papers before it’s minted. Made by the ValidatorFactory.', 30, 84, 'd'], ['mx', 'MetadataRenderer', 'v1.0', 1, 'live', '0x849e…70E5', 'Renders a deed’s features, condition and legal details.', 30, 93, 'd'], ['dn', 'DeedNFT', 'v1.1', 2, 'live', '0x1a4e…21E6', 'One token per property deed, with its traits and validation.', 50, 84, 'd'], ['sd', 'Subdivide', 'v1.0', 2, 'live', '0x3c94…923F', 'Splits a deed into units, like lots or rooms.', 50, 93, 'd'], ['fz', 'Fractionalize', 'v1.0', 3, 'live', '0xeC46…9823', 'Locks a deed or its units and issues shares against it.', 70, 84, 'd'], ['ft', 'FractionToken', 'v1.0', 4, 'live', '0x3E51…28dc', 'Shares in one property, made by the FractionTokenFactory.', 90, 84, 'd'], ['fm', 'FundManager', 'v1.0', 4, 'live', '0x73ea…401e', 'Money around deeds: commissions and payouts.', 90, 93, 'd']];
    const ctrOf = id => CTR.find(c => c[0] === id);
    /* a contract's name; a change the map doesn't place (live: a Safe transaction to another address) says so */
    const cname = id => (ctrOf(id) || [, 'Another contract'])[1];
    const LAYERS = ['Access', 'Issuance', 'Tokens', 'Pools and escrow', 'Capital'];
    const REL = LV ? LV.REL : [/* from, to, kind (reads · money · mint), verb, label on the map (blank = drawn, unlabelled · null = panel only), label side for vertical lines */
    ['ms', 'am', 'reads', 'checks members', ''], ['am', 'cc', 'reads', 'sets roles', null], ['nr', 'cr', 'reads', 'lists issuers', ''], ['nr', 'cc', 'reads', 'registers issuers', null], ['cr', 'lc', 'reads', 'pledges', ''], ['bvl', 'cr', 'reads', 'values bonds', ''], ['lc', 'ri', 'reads', 'limits', ''], ['lp', 'ri', 'money', 'funds unsecured credit', 'funds unsecured'], ['ri', 'cc', 'mint', 'mints credit', 'mints'], ['ti', 'cc', 'mint', 'mints credit', ''], ['cc', 'ap', 'money', 'claims on losses', ''], ['ao', 'ap', 'reads', 'prices reserves', ''], ['tr', 'ao', 'reads', 'token list', null], ['lp', 'ap', 'money', 'takes first loss', ''], ['cc', 'pp', 'money', 'pays merchant balances', ''], ['mr', 'pp', 'reads', 'payout terms', 'terms', 50], ['cc', 'cp', 'reads', 'credit deposits', ''], ['esa', 'cu', 'mint', 'mints against USDC', 'mints'], ['si', 'esa', 'money', 'deposits', ''], ['lq', 'cu', 'money', 'seizes pledged CLRUSD', 'seizes'], ['lq', 'esa', 'reads', 'redeems', null], ['lq', 'cc', 'reads', 'repays debt', null], ['bb', 'bv', 'money', 'bond proceeds', ''], ['vr', 'va', 'reads', 'lists validators', 'lists'], ['va', 'dn', 'reads', 'validates', 'checks'], ['mx', 'dn', 'reads', 'renders', ''], ['dn', 'sd', 'mint', 'splits into units', ''], ['dn', 'fz', 'money', 'locks deeds', 'locks'], ['sd', 'fz', 'money', 'locks units', ''], ['fz', 'ft', 'mint', 'issues shares', 'issues'], ['fm', 'dn', 'reads', 'commissions', null]];
    const EDGES = LV ? LV.EDGES : REL.filter(r => r[4] !== null);
    const RK = {
      reads: 'Reads from',
      money: 'Moves money',
      mint: 'Mints tokens'
    };
    const RELEASES = LV ? LV.RELEASES : {
      /* versions by contract, for the release lanes and panes */
      cc: [['v1.0', D(8, 2)], ['v1.1', D(9, 2)]],
      ri: [['v1.0', D(8, 2)], ['v1.1', D(9, 2)], ['v1.2', D(9, 30)], ['v1.3', D(10, 21)]],
      ti: [['v1.0', D(10, 8)]],
      lq: [['v1.0', D(10, 8)]],
      lp: [['v1.0', D(10, 14)]],
      bv: [['v1.0', D(10, 14)]],
      bvl: [['v1.0', D(10, 14)]],
      ap: [['v1.0', D(8, 2)], ['v1.1', D(9, 2)], ['v1.2', D(9, 29)]],
      ao: [['v1.0', D(9, 2)]],
      bb: [['v1.0', D(8, 14)]],
      esa: [['v1.0', D(8, 2)], ['v1.1', D(9, 9)]],
      nr: [['v1.0', D(9, 9)]],
      mr: [['v1.0', D(9, 9)]],
      cr: [['v1.0', D(9, 16)]],
      lc: [['v1.0', D(9, 16)]],
      pp: [['v0.8', D(9, 22)], ['v0.9', D(10, 6)]],
      am: [['v1.0', D(8, 2)]],
      ms: [['v1.0', D(9, 24)]],
      tr: [['v1.0', D(9, 2)]],
      cu: [['v1.0', D(9, 2)]],
      ce: [['v1.0', D(10, 1)]],
      si: [['v1.0', D(10, 8)]],
      vr: [['v1.0', D(8, 20)]],
      va: [['v1.0', D(8, 20)]],
      mx: [['v1.0', D(8, 20)]],
      dn: [['v1.0', D(8, 20)], ['v1.1', D(9, 30)]],
      sd: [['v1.0', D(9, 10)]],
      fz: [['v1.0', D(9, 10)]],
      ft: [['v1.0', D(9, 10)]],
      fm: [['v1.0', D(8, 20)]]
    };
    /* the protocol, drawn */
    function protoMap() {
      const N = id => ctrOf(id),
        W = 15,
        HN = 3.0; /* node half-width and half-height, in % */
      /* fan lines out where several leave or meet the same side of a box, so they never stack */
      const fan = {},
        offA = [],
        offB = [];
      EDGES.forEach((e, i) => {
        const A = N(e[0]),
          B = N(e[1]);
        if (A[7] === B[7]) return;
        const fw = B[7] > A[7];
        (fan[e[0] + (fw ? 'R' : 'L')] = fan[e[0] + (fw ? 'R' : 'L')] || []).push([i, 'A', B[8]]);
        (fan[e[1] + (fw ? 'L' : 'R')] = fan[e[1] + (fw ? 'L' : 'R')] || []).push([i, 'B', A[8]]);
      });
      Object.values(fan).forEach(l => {
        l.sort((x, y) => x[2] - y[2]);
        l.forEach(([i, w], j) => {
          const o = (j - (l.length - 1) / 2) * 1.5;
          (w === 'A' ? offA : offB)[i] = o;
        });
      });
      EDGES.forEach((e, i) => {
        const A = N(e[0]),
          B = N(e[1]);
        if (A[7] !== B[7] && A[8] === B[8]) {
          const o = offA[i] || 0 || offB[i] || 0;
          offA[i] = o;
          offB[i] = o;
        }
      });
      const geo = (e, i) => {
        const A = N(e[0]),
          B = N(e[1]),
          fw = B[7] > A[7];
        return {
          x1: A[7] + (fw ? W / 2 : -W / 2),
          x2: B[7] - (fw ? W / 2 : -W / 2),
          y1: A[8] + (offA[i] || 0),
          y2: B[8] + (offB[i] || 0)
        };
      };
      const path = (e, i) => {
        const [a, b, k] = e,
          A = N(a),
          B = N(b);
        if (A[7] === B[7]) {
          const dn = B[8] > A[8];
          return <path d={`M${A[7] * 10},${A[8] + (dn ? HN : -HN)} L${B[7] * 10},${B[8] + (dn ? -HN : HN)}`} className={`bm-e ${k}`} />;
        }
        const g = geo(e, i),
          mx = (g.x1 + g.x2) / 2 * 10;
        return <path d={`M${g.x1 * 10},${g.y1} C${mx},${g.y1} ${mx},${g.y2} ${g.x2 * 10},${g.y2}`} className={`bm-e ${k}`} />;
      };
      const lbl = (e, i) => {
        const [a, b, k,, l, lx] = e;
        if (!l) return '';
        const A = N(a),
          B = N(b);
        if (A[7] === B[7]) return '';
        const g = geo(e, i),
          x = lx != null ? lx : (g.x1 + g.x2) / 2,
          y = lx != null ? g.y1 : (g.y1 + g.y2) / 2;
        return <span className={`bm-el ${k}`} style={css(`left:${x}%;top:${y}%`)}>{l}</span>;
      };
      const pend = mapPend();
      return <><div className="bm" role="img" aria-label="How the contracts connect"><div className="bm-safe"><b>Ops Safe</b><span>{LV ? LV.safe ? `${LV.threshold} of ${LV.safe.owners.length} · signs changes to the contracts` : 'Not connected here yet' : '2 of 3 · admin and pause on every live contract'}</span></div><div className="bm-in">{LAYERS.map((l, i) => <Fragment key={i}><span className="bm-lay" style={css(`left:${10 + i * 20}%`)}>{l}</span><i className="bm-drop" style={css(`left:${10 + i * 20}%`)} /></Fragment>)}<i className="bm-sep" style={css("top:7.5%")} /><span className="bm-band" style={css("top:7.5%")}>Credit and money</span><i className="bm-sep" style={css("top:77%")} /><span className="bm-band" style={css("top:77%")}>Deeds and real assets</span><svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">{EDGES.map(path)}</svg>{EDGES.map(lbl)}{(LV ? LV.MAPPED : CTR).map((c, __k) => <button key={__k} type="button" className={`bm-n ${c[4]}${LV ? nodeLive(c, pend) : `${pend[c[0]] && !['bb', 'lp', 'bv'].includes(c[0]) ? ' pend' : ''}${c[0] === 'ap' && mapPend().ap && mapPend().ap.includes('you') ? ' me' : ''}${['bb', 'lp', 'bv'].includes(c[0]) ? ' info' : ''}`}`} data-ctr={c[0]} style={css(`left:${c[7]}%;top:${c[8]}%`)}><span className="bm-h"><b>{c[1]}</b><span className="mono">{c[2]}</span></span>{pend[c[0]] ? <span className="bm-t">{pend[c[0]]}</span> : ''}</button>)}</div></div><div className="bm-list">{[['c', 'Credit and money'], ['d', 'Deeds and real assets']].map(([b, bn], __k) => <Fragment key={__k}><div className="bm-lb">{bn}</div>{LAYERS.map((l, i) => {
              const cs = CTR.filter(c => c[3] === i && c[9] === b);
              return cs.length ? <div key={i} className="bm-pc"><span className="lbl">{l}</span>{cs.map((c, __k) => <button key={__k} type="button" className="bm-pr" data-ctr={c[0]}>{(() => {
                    const pv = pend[c[0]] || '',
                      k = /on you/.test(pv) ? 'me' : /in the wait|Waits|in the Ops Safe/.test(pv) ? 'wt' : '';
                    return <><i className={`${c[4]} ${k}`} /><span>{c[1]}{pv ? <em className={k}>{pv}</em> : ''}</span></>;
                  })()}<span className="mono quiet">{c[2]}</span></button>)}</div> : '';
            })}</Fragment>)}</div></>;
    }
    const mapKey = () => <div className="bm-keys">{mkey(LV ? [['var(--fg)', `Found on ${LV.chain.network || 'the chain'}`], ['var(--line)', 'Not found on-chain'], ['var(--underway)', 'Change in the Ops Safe'], ['var(--live)', 'Change waiting on you']] : [['var(--fg)', 'Live on Base Sepolia'], ['var(--line)', 'In the repo, not deployed'], ['var(--underway)', 'Change in the wait'], ['var(--live)', 'Change waiting on you']])}<div className="mkey"><span><i className="lk reads" />Reads from</span><span><i className="lk money" />Moves money</span><span><i className="lk mint" />Mints tokens</span></div></div>;

    /* ══ Build — smart contracts and the code behind every app ══════════════════════════════════════════════════
       Overview (is anything blocked or waiting on you) · Changes (every pull request and on-chain change, by stage) ·
       Contracts (the protocol map, the Ops Safe, releases and roles) · Deploys (where each repo runs, checks, history) ·
       Security (findings, audits, keys, incidents). Agreements live in Governance now. */
    const B = {
      st: 'review',
      tab: 'overview',
      repo: 'all',
      panel: null,
      me: 'kai',
      cp: 0,
      dp: 0,
      rej: false,
      // live: how many cards each board column shows (the first CARDS, then more), and when you last cleared Shipped
      more: {},
      cleared: (() => {
        try {
          return +localStorage.getItem('cc-build-cleared') || 0;
        } catch {
          return 0;
        }
      })()
    };
    const CARDS = 6;
    const ME = () => PPL[B.me],
      ENG = () => !!ME().eng,
      SIGNER = () => !!ME().signer;
    const who = k => k === B.me ? 'You' : PPL[k] ? PPL[k].n : k;
    const ICO = {
      chev: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>,
      back: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>,
      x: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>,
      arrow: <svg viewBox="0 0 8 12" aria-hidden="true"><path d="M1.5 1.5 6.5 6l-5 4.5" /></svg>
    };
    const cell = (cls, title, right, body, foot, id = '') => <div className={`cell ${cls}`} {...attrs(id ? ` id="${id}"` : '')}><div className="hd"><h2>{title}</h2><div className="r">{right}</div></div>{body}<div className="bk-ft">{foot}</div></div>;
    const lbl = t => <span className="lbl">{t}</span>;
    const band = (cells, first) => <section className="band" {...attrs(first ? ' style="margin-top:0"' : '')}><div className="bento">{cells}</div></section>;
    const pager = (p, n, per, key) => {
      const pages = Math.max(1, Math.ceil(n / per));
      return <span className="pg2"><span>{n ? p * per + 1 : 0}{"–"}{Math.min(n, (p + 1) * per)}{" of "}{n}</span><button {...attrs(`data-${key}="-1"${p === 0 ? ' disabled' : ''}`)} aria-label="Previous">{ICO.back}</button><button {...attrs(`data-${key}="1"${p >= pages - 1 ? ' disabled' : ''}`)} aria-label="Next">{ICO.chev}</button></span>;
    };
    const av = (k, cls = '') => <span className={`av sm ${cls}`} title={PPL[k] ? PPL[k].n : k}>{PPL[k] ? PPL[k].ini : '?'}</span>;
    const rtag = id => <span className="bd-rt">{RSHORT[id]}</span>;
    const ref = c => c.repo ? `${RSHORT[c.repo]} · #${c.num}` : `${cname(c.contract)} · setting`;
    /* who signs in the Ops Safe, in its order: live, its owners */
    const SIGK = () => LV ? LV.SIGNER_KEYS : ['kai', 'dana', 'bs'];
    const CK = {
      pass: ['Checks pass', 'var(--settled)'],
      fail: ['Checks failing', 'var(--absent)'],
      run: ['Checks running', 'var(--underway)'],
      none: ['No checks', 'var(--line)']
    };
    const ckDot = s => <i className={`bd-ck ck-${s}`} title={CK[s][0]} />;
    /* live: a time as "12 min", "4.2 h" or "3 d" */
    const span2 = ms => ms == null ? '—' : ms < 3600e3 ? `${Math.max(1, Math.round(ms / 60000))} min` : ms < 48 * 3600e3 ? `${(ms / 3600e3).toFixed(1)} h` : `${Math.round(ms / 864e5)} d`;
    /* live: the reviews GitHub has in 30 days (the poller's): time to a first review, each reviewer's, how long they take */
    const reviewsLive = () => {
      const R = LV.REVIEWS,
        rmx = Math.max(1, ...R.people.map(p => p.done)),
        dmx = Math.max(1, ...R.dist.map(d => d[1]));
      return cell('s5', 'Reviews', <span className="lbl">Last 30 days</span>, R.count || R.people.length ? <div className="bd-rv"><div className="m-big">{span2(R.median)}{" "}<small>median time to a first review</small></div><div className="led bd-rv-l">{R.people.map((p, __k) => <div key={__k}><span className="bd-rv-p">{av(p.key)}<span><b>{p.key === B.me ? 'You' : PPL[p.key] ? PPL[p.key].n : p.key}</b><em>{p.waiting ? `${p.waiting} waiting on ${p.key === B.me ? 'you' : 'them'}` : 'Nothing waiting'}{p.median != null ? ` · median ${span2(p.median)}` : ''}</em></span></span><span className="bd-rv-b"><i style={css(`width:${p.done / rmx * 100}%`)} /></span><b>{p.done}</b></div>)}</div><div className="bd-dist">{lbl('Time to a first review')}{R.dist.map(([t, n], __k) => <div key={__k}><span>{t}</span><span className="bd-rv-b"><i style={css(`width:${n / dmx * 100}%`)} /></span><b>{n}</b></div>)}</div></div> : <div className="lv-e"><span>No reviews in the last 30 days</span></div>, <><span>{R.count ? `${R.count} ${R.count === 1 ? 'pull request' : 'pull requests'} reviewed · branch rules are set in GitHub` : 'Branch rules are set in GitHub'}</span><span /></>);
    };

    /* where each change stands */
    const need = c => c.st === 'review' && c.rev === B.me ? 'review' : c.st === 'safe' && !c.block && !c.wait && c.need === B.me ? 'sign' : null;
    const mine = () => CHANGES.filter(c => need(c));
    const sigCount = c => Object.keys(c.sigs || {}).length;
    const stateTxt = c => LV ? stateLive(c) : c.st === 'draft' ? c.after && CHG[c.after].st !== 'shipped' ? `Draft · merges after ${CHG[c.after].t}` : c.checks === 'fail' ? 'Draft · checks failing' : 'Draft' : c.st === 'review' ? c.rev ? c.rev === B.me ? 'Waiting on your review' : `Waiting on ${who(c.rev)}` : c.revState === 'changes' ? `${who(c.reviewer)} asked for changes` : c.revState === 'ok' ? `Approved by ${who(c.reviewer)} · ready to merge` : 'Anyone can review' : c.st === 'safe' ? c.block ? c.block : c.wait ? `In the 24-hour wait · live ${WD(c.wait)} ${hm(c.wait)}` : c.need === B.me ? `Waiting on you · ${sigCount(c)} of 2` : `Waiting on ${who(c.need)} · ${sigCount(c)} of 2` : `Live ${/^(Today|Yesterday)$/.test(dayLbl(c.live)) ? dayLbl(c.live).toLowerCase() : dayLbl(c.live)}`;
    /* live: a change as the poller, the indexer or the Ops Safe has it (no review state, no timelock) */
    const stateLive = c => {
      const n = sigCount(c),
        req = c.req || LV.threshold;
      if (c.st === 'draft') return c.kind === 'upgrade' ? c.state || 'Commits not released' : 'Draft';
      if (c.st === 'review') return 'Ready for review';
      if (c.st === 'safe') return c.block ? c.block : c.outbox ? c.need === B.me ? 'Ready for you to sign and send' : 'Waiting for its first signature' : c.ready ? `Ready to execute · ${n} of ${req}` : c.need === B.me ? `Waiting on you · ${n} of ${req}` : `Waiting on the others · ${n} of ${req}`;
      const d = dayLbl(c.live),
        dd = /^(Today|Yesterday)$/.test(d) ? d.toLowerCase() : d;
      return c.kind === 'code' ? `Merged into ${c.base} ${dd}` : c.released ? `Live ${dd}` : `Executed ${dd}`;
    };
    /* live: a map node's classes, from its note (pending changes, or the API's note) */
    const nodeLive = (c, pend) => {
      const pv = pend[c[0]] || '';
      return `${/Ops Safe|waiting on/.test(pv) ? ' pend' : pv ? ' info' : ''}${/waiting on you/.test(pv) ? ' me' : ''}`;
    };
    const mapPend = () => {
      if (LV) {
        const p = {
          ...LV.CTR_NOTE
        };
        const n = {};
        CHANGES.filter(c => c.st === 'safe' && c.contract && !c.block).forEach(c => {
          const k = n[c.contract] = n[c.contract] || [0, 0];
          k[0]++;
          if (c.need === B.me) k[1]++;
        });
        Object.entries(n).forEach(([id, [all, me]]) => {
          p[id] = me ? `${me} ${me === 1 ? 'change' : 'changes'} · waiting on you` : `${all} ${all === 1 ? 'change' : 'changes'} in the Ops Safe`;
        });
        return p;
      }
      const p = {
        bb: '6 bonds',
        lp: '$9,000 held',
        bv: '$25,000 held'
      };
      CHANGES.filter(c => c.st === 'safe' && c.contract).forEach(c => {
        if (c.kind === 'upgrade' && c.need) p[c.contract] = `${c.t.split(' ').pop()} · waiting on ${c.need === B.me ? 'you' : who(c.need).split(' ')[0]}`;else if (c.need) p[c.contract] = `1 change · waiting on ${c.need === B.me ? 'you' : who(c.need).split(' ')[0]}`;else if (c.wait) p[c.contract] = '1 change in the wait';else if (c.block && c.contract === 'vr') p[c.contract] = 'Waits on D&T Co.';
      });
      return p;
    };

    /* ── header: one sentence, four vitals ── */
    function renderHdr() {
      if (LV) return renderHdrLive();
      const m = mine(),
        fail = REPOS.filter(r => r.main === 'fail'),
        open = FINDINGS.filter(f => f.st !== 'fixed'),
        crit = open.filter(f => f.sev === 'critical'),
        ap = CHG['u-ap'];
      const apW = ap.st === 'safe' && ap.need ? <a data-bopen="u-ap">{"waits on "}{ap.need === B.me ? 'your' : who(ap.need) + '’s'}{" signature"}</a> : ap.wait ? `is in the 24-hour wait` : 'is live';
      const BR = {
        overview: <>{crit.length ? <>{"AssurancePool v1.3 closes the one critical finding and "}{apW}.</> : 'No critical findings are open.'}{" "}{fail.length ? <>{"The member app’s checks are failing on dev; "}<a data-bopen="a212">#132 fixes it</a>.</> : 'Every main branch is passing.'}</>,
        changes: `${CHANGES.filter(c => c.st === 'review').length} changes are in review and ${CHANGES.filter(c => c.st === 'safe').length} wait in the Ops Safe. ${CHANGES.filter(c => c.st === 'shipped').length} shipped this week.`,
        contracts: <>{"30 of 31 contracts are live on Base Sepolia. AssurancePool v1.3 is the next upgrade and "}{apW}.</>,
        deploys: `Only useclear.org is in production. The contracts run on Base Sepolia and the apps run against the provider sandboxes.`,
        security: <>{open.length}{" findings are open. The critical one is fixed in AssurancePool v1.3, which "}{apW}.</>
      }[B.tab];
      const pass = REPOS.filter(r => r.main === 'pass').length;
      html(document.getElementById('hdr'), <><span className="when"><span className="dot" />Build · Wed 21 Oct · Demo data</span><p className="brief">{BR}</p><div className="strip"><div className="sc" data-btab="changes"><span className="lbl">Waiting on you</span><div className="sc-v">{m.length}{" "}<small>{m.length === 1 ? 'change' : 'changes'}</small></div><div className="mb">{m.map((c, i) => <i key={i} style={css(`left:${i * 100 / Math.max(2, m.length)}%;width:calc(${100 / Math.max(2, m.length)}% - 2px);background:${need(c) === 'sign' ? 'var(--live)' : 'var(--underway)'}`)} />)}</div><div className="sc-s">{m.filter(c => need(c) === 'sign').length}{" to sign · "}{m.filter(c => need(c) === 'review').length}{" to review"}</div></div><div className="sc" data-btab="deploys"><span className="lbl">Checks</span><div className="sc-v">{pass}{" "}<small>{"of "}{REPOS.length}{" passing"}</small></div><div className="mb">{REPOS.map((r, i) => <i key={i} style={css(`left:${i * 100 / REPOS.length}%;width:calc(${100 / REPOS.length}% - 2px);background:${CK[r.main][1]}`)} />)}</div><div className="sc-s">{fail.length ? `${fail.map(r => RSHORT[r.id]).join(', ')} failing` : 'All passing'}{REPOS.some(r => r.main === 'run') ? ' · 1 running' : ''}</div></div><div className="sc" data-btab="contracts"><span className="lbl">On testnet</span><div className="sc-v">{"30 "}<small>of 31 contracts</small></div><div className="mb"><i style={css(`width:${30 / 31 * 100}%`)} /><span className="hroom" style={css(`left:${30 / 31 * 100}%;right:0`)} /></div><div className="sc-s">Base Sepolia · nothing on mainnet yet</div></div><div className="sc" data-btab="security"><span className="lbl">Open findings</span><div className="sc-v">{open.length}{" "}<small>{crit.length}{" critical"}</small></div><div className="mb">{open.map((f, i) => <i key={i} style={css(`left:${i / Math.max(5, open.length) * 100}%;width:calc(${100 / Math.max(5, open.length)}% - 2px);background:${SEV[f.sev][1]}`)} />)}</div><div className="sc-s">No external audit yet</div></div></div></>);
    }

    /* ══ Overview ══════════════════════════════════════════════════════════════════ */
    function renderOverview() {
      if (LV) return renderOverviewLive();
      const m = mine(),
        open = INCIDENTS.filter(i => i.st === 'open');
      const NEED = [...m.map(c => [need(c) === 'sign' ? 'live' : 'underway', need(c) === 'sign' ? `Sign ${c.t}` : `Review #${c.num} · ${c.t}`, need(c) === 'sign' ? `Ops Safe · ${who(Object.keys(c.sigs)[0])} signed · ${c.finding ? 'closes the critical finding' : 'asked for in ' + (c.from || 'Build')}` : `${RSHORT[c.repo]} · ${who(c.by)} · fixes dev`, need(c) === 'sign' ? 'Now' : ago(c.upd).replace(' ago', ''), need(c) === 'sign' ? 'Your signature' : 'Your review', `data-bopen="${c.id}"`, 1]), ...(CHG.c130.revState === 'changes' ? [['line', 'BurnerBond: OpenZeppelin v5 paths', `Protocol · #128 · you asked for changes`, '1 d', 'Waiting on Dana', 'data-bopen="c130"']] : []), ...open.map(i => ['absent', i.t, `${i.area} · ${i.note.split('.')[0]}`, ago(i.at).replace(' ago', ''), i.who === 'auto' ? 'Automatic' : who(i.who).split(' ')[0] + ' is on it', `data-binc="${i.id}"`])];
      const needs = cell('s5', 'Needs you', <span className="lbl">{NEED.length}{" things"}</span>, <div className="bd-nd">{NEED.map(([sv, t, mm, age, own, at, me], __k) => <button key={__k} className="bd-nd-r" {...attrs(at)}><i style={css(`background:${{
            underway: 'var(--underway)',
            live: 'var(--live)',
            absent: 'var(--absent)',
            line: 'var(--line)'
          }[sv]}`)} /><span className="bd-nd-k"><b>{t}</b><span>{mm}</span></span><span className="bd-nd-a"><span className={me ? 'me' : ''}>{own}</span><span className="mono">{age}</span></span></button>)}</div>, <><span>Contract changes need 2 of 3 signers</span><button data-btab="changes">All changes →</button></>);
      const repos = cell('s7', 'Every project', <span className="lbl">{REPOS.length}{" projects · "}{new Set(REPOS.map(r => r.name)).size}{" repos"}</span>, <div className="bd-rp"><div className="bd-rp-r hd2"><span />{lbl('Project')}{lbl('Checks')}{lbl('Open')}{lbl('Last commit')}{lbl('Runs on')}</div>{REPOS.map((r, i) => {
          const o = CHANGES.filter(c => c.repo === r.id && (c.st === 'draft' || c.st === 'review')).length,
            g = i === 0 ? <div className="bd-rp-g">{lbl(`${r.org}/${r.name} · one repo · ${r.branch}`)}</div> : !r.path && REPOS[i - 1].path ? <div className="bd-rp-g">{lbl('Their own repos · main')}</div> : '';
          return <Fragment key={i}>{g}<button className="bd-rp-r" data-brepo={r.id}><span className="bd-rp-k"><b>{RSHORT[r.id]}</b><span>{r.path ? `${r.path}/` : `${r.org}/${r.name}`}</span></span><span className={`bd-st st-${r.main}`}>{ckDot(r.main)}{{
                  pass: 'Passing',
                  fail: 'Failing',
                  run: 'Running'
                }[r.main]}</span><b className="bd-rp-n">{o || '–'}</b><span className="bd-rp-l">{ago(r.last)}</span><span className="bd-rp-e">{r.live}</span></button></Fragment>;
        })}</div>, <><span>{int(CHANGES.filter(c => c.st === 'shipped').length)}{" shipped in the last 7 days"}</span><button data-btab="deploys">Deploys →</button></>);
      /* from change to live */
      const cnt = st => CHANGES.filter(c => c.st === st).length;
      const steps = [['draft', 'In progress', cnt('draft'), 'Draft pull requests'], ['review', 'In review', cnt('review'), 'Median 0.9 days to approve'], ['safe', 'Ops Safe', cnt('safe'), 'Contracts only · 2.1 days, then 24 hours'], ['shipped', 'Shipped', cnt('shipped'), 'Last 7 days']];
      const flow = cell('s7', 'From change to live', <span className="lbl">Every project</span>, <><div className="bd-fl">{steps.map(([k, t, n, s], i) => <button key={i} className={`bd-fs ${k}`} data-btab="changes"><div className="bd-fh"><span className="bd-fn">{i + 1}</span><b>{t}</b>{i < 3 ? <span className="bd-fa"><i />{ICO.arrow}</span> : ''}</div><span className="m-big">{n}</span><span className="bd-ft">{s}</span><div className="bd-fb">{CHANGES.filter(c => c.st === k).map((c, __k) => <i key={__k} className={need(c) ? 'me' : c.block || c.wait ? 'hx' : ''} title={c.t} />)}</div></button>)}</div><div className="bd-lw">{lbl('Longest in its stage')}{[['u-ap', 'Ops Safe since 18 Oct', '3 days'], ['u-dt', 'Blocked since 16 Oct', '5 days'], ['c131', 'Draft since 19 Oct', '2 days']].map(([id, s2, d2], __k) => {
            const c = CHG[id];
            return <button key={__k} className="bd-lw-r" data-bopen={id}><span><b>{c.t}</b><em>{s2}{need(c) ? ' · waiting on you' : c.block ? ' · ' + c.block.toLowerCase() : ''}</em></span><b>{d2}</b></button>;
          })}</div><div className="bd-fk f-key"><span><i style={css("background:var(--fg)")} />A change</span><span><i style={css("background:var(--live)")} />Waiting on you</span><span><i className="hx" />Waiting on something else</span></div></>, <><span>App changes ship when merged · contract changes go through the Ops Safe</span><span /></>);
      const inc = cell('s5', 'Incidents', <span className="lbl">Last 30 days</span>, <div className="bd-il">{INCIDENTS.map((i, __k) => <button key={__k} className={`bd-ir ${i.st}`} data-binc={i.id}>{leaf(i.at)}<span><b>{i.t}</b><span>{i.area}{" · "}{i.st === 'open' ? 'open' : 'resolved in ' + i.dur}</span></span><span className={`fst ${i.st === 'open' ? 'warn2' : ''}`}>{i.st === 'open' ? 'Open' : 'Closed'}</span></button>)}</div>, <><span>{open.length}{" open · none affect members"}</span><button data-btab="security">Security →</button></>);
      /* activity */
      const days = Array.from({
          length: 28
        }, (_, d) => TODAY - (27 - d) * DAY),
        mx = Math.max(...REPOS.flatMap(r => ACT[r.id]));
      const act = cell('s12', 'Activity', <span className="lbl">Commits a day · last 4 weeks</span>, <div className="bd-hm"><div className="bd-hm-r bd-hm-x"><span /><span className="bd-hm-c">{days.map((t, i) => <span key={i} className={i === 27 ? 'end' : ''}>{i % 7 === 0 || i === 27 ? fmtD(t) : ''}</span>)}</span><span>{lbl('Commits')}</span></div>{REPOS.map((r, __k) => <div key={__k} className="bd-hm-r"><span className="bd-hm-k"><b>{RSHORT[r.id]}</b></span><span className="bd-hm-c">{ACT[r.id].map((v, i) => <i key={i} style={css(`--v:${(v / mx).toFixed(2)}`)} className={`${v ? '' : 'z'} ${new Date(days[i]).getUTCDay() % 6 === 0 ? 'we' : ''}`} title={`${fmtD(days[i])} · ${v} commits`} />)}</span><b>{ACT[r.id].reduce((a, b) => a + b, 0)}</b></div>)}</div>, <><span className="f-key"><span><i className="bd-sq" style={css("--v:.15")} />Fewer</span><span><i className="bd-sq" style={css("--v:1")} />More</span><span><i className="bd-sq z" />None</span></span><button data-btab="changes">Commits →</button></>);
      html(document.getElementById('bv'), <>{band(<>{needs}{repos}</>, 1)}{band(<>{flow}{inc}</>)}{band(act)}</>);
    }

    /* ══ Changes ═══════════════════════════════════════════════════════════════════ */
    function tile(c) {
      const n = need(c),
        s = c.sigs || {};
      const sig = c.kind !== 'code' && (!LV || c.kind === 'setting') ? <span className="bd-sig">{SIGK().map((k, __k) => <i key={__k} className={s[k] ? 'on' : c.need === k ? 'me' : ''} title={`${PPL[k].n}${s[k] ? ' signed' : ''}`}>{PPL[k].ini}</i>)}</span> : '';
      return <button className={`bd-t ${n ? 'me' : ''} ${c.block ? 'blk' : ''} ${c.wait ? 'wt' : ''}`} data-bopen={c.id}><span className="bd-t-h">{c.repo ? <>{rtag(c.repo)}{(c.also || []).map((r, __k) => <span key={__k} className="bd-rt">{"+ "}{RTINY[r]}</span>)}{LV && !c.num ? <span className="bd-t-n">{plural((c.commits || []).length, 'commit', 'commits')}</span> : <span className="bd-t-n">#{c.num}</span>}</> : <><span className="bd-rt on">{c.from || 'On-chain'}</span><span className="bd-t-n">setting</span></>}{c.contract && c.kind === 'upgrade' ? <span className="bd-t-u">Upgrade</span> : ''}</span><b className="bd-t-t">{c.t}</b><span className={`bd-t-s ${n ? 'me' : ''}`}>{stateTxt(c)}</span><span className="bd-t-f">{av(c.by)}{c.kind === 'setting' || LV && !c.num ? <span>{c.contract || !LV ? cname(c.contract) : c.to ? shortA(c.to) : 'On-chain'}</span> : <span className="bd-t-ck">{ckDot(c.checks || 'none')}{LV ? <span>{plural(c.files, 'file', 'files')}</span> : <><span className="ad">+{int(c.plus)}</span><span className="rm">−{int(c.minus)}</span></>}</span>}{sig}</span></button>;
    }
    function renderChanges() {
      const F = [['all', 'All'], ...REPOS.map(r => [r.id, RSHORT[r.id]])],
        ok = c => B.repo === 'all' || c.repo === B.repo || (c.also || []).includes(B.repo) || !c.repo && B.repo === 'proto',
        gone = c => LV && c.st === 'shipped' && B.cleared && (c.live || c.upd || c.opened) <= B.cleared;
      const board = cell('s12', 'Every change', <div className="seg sm" role="group" aria-label="Repo">{F.map(([k, t], __k) => <button key={__k} data-brepo={k} aria-pressed={B.repo === k}>{t}</button>)}</div>, <><div className="bd-tabs">{STAGES.map(([k, t], __k) => <button key={__k} className={B.st === k ? 'on' : ''} data-bst={k}><b>{CHANGES.filter(c => c.st === k && ok(c) && !gone(c)).length}</b><span>{t}</span></button>)}</div><div className="bd-bd">{STAGES.map(([k, t, s], __k) => {
            const L = CHANGES.filter(c => c.st === k && ok(c) && !gone(c)).sort((a, b) => (need(b) ? 1 : 0) - (need(a) ? 1 : 0) || (b.upd || b.live || b.opened) - (a.upd || a.live || a.opened));
            if (!LV) return <section key={__k} className={`bd-c ${k} ${B.st === k ? 'on' : ''}`}><header className="bd-h"><span><b>{t}</b><span>{s}</span></span><b className="bd-k">{L.length}</b></header><div className="bd-b">{L.length ? L.map(tile) : <div className="bd-e">Nothing here</div>}</div></section>;
            // live: the first CARDS, then a dozen more at a time; Shipped clears for you (what shipped since still shows)
            const cap = B.more[k] || CARDS,
              rest = L.length - cap,
              hid = k === 'shipped' ? CHANGES.filter(c => c.st === k && ok(c) && gone(c)).length : 0;
            return <section key={__k} className={`bd-c ${k} ${B.st === k ? 'on' : ''}`}><header className="bd-h"><span><b>{t}</b><span>{k === 'shipped' && B.cleared ? `Since you cleared it ${fmtD(B.cleared)}` : s}</span></span><b className="bd-k">{L.length}</b></header><div className="bd-b">{L.length ? L.slice(0, cap).map(tile) : <div className="bd-e">{hid ? 'Nothing shipped since you cleared it' : 'Nothing here'}</div>}{rest > 0 ? <button className="bd-more" data-bkmore={k}>{"Show "}{Math.min(12, rest)}{" more · "}{rest}{" not shown"}</button> : cap > CARDS ? <button className="bd-more" data-bkmore={k} data-less="">Show fewer</button> : ''}{k === 'shipped' && (L.length || hid) ? <button className="bd-more" data-bkclear={L.length ? 'clear' : 'back'}>{L.length ? 'Clear shipped · just for you' : `Bring back the ${plural(hid, 'cleared change', 'cleared changes')}`}</button> : ''}</div></section>;
          })}</div></>, <><span>{LV ? B.repo === 'all' ? 'On-chain changes come from Build, Merchants and Money' : `${REPO[B.repo].full || REPO[B.repo].name} · ${REPO[B.repo].path}` : B.repo === 'all' ? 'Settings come from Merchants and Governance' : `${REPO[B.repo].path ? REPO[B.repo].name + ' · ' + REPO[B.repo].path : REPO[B.repo].org + '/' + REPO[B.repo].name}`}</span><button data-bgh={LV && REPOS[0].url ? REPOS[0].url + '/pulls' : ''}>GitHub ↗</button></>);
      const L = COMMITS.filter(c => B.repo === 'all' || c[1] === B.repo),
        per = 8;
      B.cp = Math.min(B.cp, Math.max(0, Math.ceil(L.length / per) - 1));
      let prev = null;
      const commits = cell('s7', 'Commits', <span className="lbl">{B.repo === 'all' ? 'Every project' : RSHORT[B.repo]}</span>, LV && !L.length ? <div className="lv-e"><span>{B.repo === 'all' ? 'No commits yet' : 'No commits in this project yet'}</span></div> : <div className="bd-cm">{L.slice(B.cp * per, B.cp * per + per).map(([t, r, a, msg, sha], __k) => {
          const dl = dayLbl(t),
            h = dl !== prev ? <div className="bd-cm-d">{lbl(dl)}</div> : '';
          prev = dl;
          return <Fragment key={__k}>{h}<div className="bd-cm-r">{av(a)}<span className="bd-cm-k"><b>{msg}</b><span>{RSHORT[r]}{" · "}{who(a)}{" · "}{hm(t)}</span></span><span className="mono bd-cm-s">{sha}</span></div></Fragment>;
        })}</div>, <><span>{L.length}{LV ? ' of the newest commits' : " commits this week"}</span>{pager(B.cp, L.length, per, 'bcp')}</>);
      const rv = [['kai', 'Kai', CHANGES.filter(c => c.rev === 'kai').length, '4.2 h', 11], ['dana', 'Dana Ruiz', CHANGES.filter(c => c.rev === 'dana').length, '6.8 h', 14]],
        rmx = 14;
      const reviews = cell('s5', 'Reviews', <span className="lbl">Last 30 days</span>, <div className="bd-rv"><div className="m-big">{"5.1 h "}<small>median time to a first review</small></div><div className="led bd-rv-l">{rv.map(([k, n, w, med, done], __k) => <div key={__k}><span className="bd-rv-p">{av(k)}<span><b>{k === B.me ? 'You' : n}</b><em>{w ? `${w} waiting on ${k === B.me ? 'you' : 'them'}` : 'Nothing waiting'}{" · median "}{med}</em></span></span><span className="bd-rv-b"><i style={css(`width:${done / rmx * 100}%`)} /></span><b>{done}</b></div>)}</div><div className="bd-dist">{lbl('Time to a first review')}{[['Under 1 h', 7], ['1 to 4 h', 6], ['4 to 24 h', 8], ['Over a day', 4]].map(([t, n], __k) => <div key={__k}><span>{t}</span><span className="bd-rv-b"><i style={css(`width:${n / 8 * 100}%`)} /></span><b>{n}</b></div>)}</div><p className="bd-n">Every change to dev or main needs one review and passing checks. Contract changes then need 2 of 3 signers in the Ops Safe.</p></div>, <><span>Branch rules are set in GitHub</span><span /></>);
      html(document.getElementById('bv'), <>{band(board, 1)}{band(<>{commits}{LV ? reviewsLive() : reviews}</>)}</>);
    }

    /* ══ Contracts ═════════════════════════════════════════════════════════════════ */
    function renderContracts() {
      if (LV) return renderContractsLive();
      const map = cell('s12', 'The protocol', <span className="lbl">Base Sepolia · block 18,204,331</span>, <div className="bd-map">{protoMap()}</div>, <>{mapKey()}</>);
      const q = CHANGES.filter(c => c.st === 'safe');
      const safe = cell('s7', 'In the Ops Safe', <span className="lbl">2 of 3, then 24 h</span>, <div className="bd-q">{q.map((c, __k) => {
          const s = c.sigs || {},
            ks = ['kai', 'dana', 'bs'];
          return <button key={__k} className={`bd-q-r ${need(c) ? 'me' : ''}`} data-bopen={c.id}><span className="bd-q-k"><b>{c.t}</b><span>{ctrOf(c.contract)[1]}{" · "}{c.kind === 'upgrade' ? 'upgrade' : 'setting'}{" · "}{c.from ? 'from ' + c.from : 'Protocol #' + c.num}</span></span><span className="bd-q-s">{ks.map((k, __k) => <i key={__k} className={s[k] ? 'on' : c.need === k ? 'me' : ''} title={PPL[k].n}>{PPL[k].ini}</i>)}</span><span className={`bd-q-w ${c.block ? 'blk' : c.wait ? 'wt' : ''}`}>{c.block ? <><em className="hxw" />{c.block}</> : c.wait ? <><em className="hxw" />{"Live "}{WD(c.wait)}{" "}{hm(c.wait)}</> : need(c) ? <b>Your signature</b> : `Waiting on ${who(c.need)}`}</span></button>;
        })}</div>, <><span>Money moves are signed in Money</span><button data-bgo="money/moves">Money →</button></>);
      const signers = cell('s5', 'Signers', <span className="lbl">Signatures a week</span>, <div className="bd-sg"><div className="m-big">{"3.1 h "}<small>your median time to sign · the fastest of the three</small></div><div className="bd-sh"><div className="bd-sh-r bd-sh-x"><span />{['1 Sep', '8', '15', '22', '29', '6 Oct', '13', '20'].map((w, __k) => <span key={__k}>{w}</span>)}<span>Median</span></div>{SIGNERS.map(([k, ini, n, r, med], __k) => <div key={__k} className="bd-sh-r"><span className="bd-sh-k">{av(k)}<b>{k === B.me ? 'You' : n}</b></span>{SIGN_W[ini].map((v, __k) => <i key={__k} style={css(`--v:${v / 4}`)} className={v ? '' : 'z'}>{v || ''}</i>)}<b>{med.toFixed(1)}{" h"}</b></div>)}</div><div className="led bd-sg-l">{[['Signed since 1 Sep', `${Math.round(Object.values(SIGN_W).flat().reduce((a, b) => a + b, 0) / 2)} changes`], ['Board signer', 'Upgrades only']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div>, <><span>Ops Safe · 2 of 3</span><button data-btab="security">Keys →</button></>);
      /* releases */
      const from = D(8, 1),
        to = D(10, 31),
        X = t => ((t - from) / (to - from) * 100).toFixed(2),
        rows = Object.entries(RELEASES).filter(([k, v]) => v.length > 1 || v[0][1] >= D(10, 1)).sort((a, b) => b[1].length - a[1].length || b[1][b[1].length - 1][1] - a[1][a[1].length - 1][1]).slice(0, 10);
      const ticks = [D(8, 1), D(8, 15), D(9, 1), D(9, 15), D(10, 1)];
      const rel = cell('s7', 'Releases', <span className="lbl">Aug – Oct</span>, <div className="bd-rl"><div className="bd-rl-r bd-rl-x"><span /><span className="bd-rl-l">{ticks.map((t, i) => <span key={i} className={i % 2 ? 'odd' : ''} style={css(`left:${X(t)}%`)}>{fmtD(t)}</span>)}<span className="now" style={css(`left:${X(NOW)}%`)}>Today</span></span></div>{rows.map(([k, v], __k) => {
          const c = ctrOf(k),
            p = k === 'ap' && CHG['u-ap'].st === 'safe';
          return <button key={__k} className="bd-rl-r" data-bctr={k}><span className="bd-rl-k"><b>{c[1]}</b><span>{c[2]}{" live"}</span></span><span className="bd-rl-l"><i className="g" style={css(`left:${X(NOW)}%`)} /><i className="ln" style={css(`left:${X(v[0][1])}%;right:${100 - X(NOW)}%`)} />{v.map(([ver, t], i) => <i key={i} className={`dot ${i === v.length - 1 ? 'cur' : ''}`} style={css(`left:${X(t)}%`)} title={`${ver} · ${fmtD(t)}`} />)}{p ? <i className="dot nx" style={css(`left:${X(H(10, 22, 14))}%`)} title="v1.3 · waiting" /> : ''}</span></button>;
        })}</div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />Live version</span><span><i className="bd-ko" />Earlier</span><span><i className="bd-ko nx" />Next, in the Ops Safe</span></span><span>{Object.values(RELEASES).flat().length}{" releases"}</span></>);
      const R = [['Upgrade and admin', ['safe']], ['Pause', ['safe']], ['Mint credit', ['iss']], ['Set shop terms', ['safe']], ['Approve a deed', ['val']], ['Add a validator', ['safe']], ['Claim from the AssurancePool', ['bond', 'credit', 'lend']]];
      const COLS = [['safe', 'Ops Safe'], ['iss', 'Issuers'], ['bond', 'BurnerBond'], ['credit', 'ClearCredit'], ['lend', 'LendingPool'], ['val', 'Validators']];
      const roles = cell('s5', 'Who can do what', <span className="lbl">AccessManager roles</span>, <div className="bd-ro"><div className="bd-ro-r bd-ro-x"><span />{COLS.map(([, t], __k) => <span key={__k}><em>{t}</em></span>)}</div>{R.map(([t, h], __k) => <div key={__k} className="bd-ro-r"><span>{t}</span>{COLS.map(([k], __k) => <i key={__k} className={`${h.includes(k) ? 'on' : ''} ${t.startsWith('Claim') && h.includes(k) && CHG['u-ap'].st === 'safe' ? 'nx' : ''}`} />)}</div>)}<div className={`bd-ro-w ${CHG['u-ap'].st === 'safe' ? '' : 'done'}`}>{CHG['u-ap'].st === 'safe' ? <><b>Until v1.3:</b>{" anyone can claim from the AssurancePool. "}<button className="lnk3" data-bfind="F1">Finding →</button></> : 'Claims from the AssurancePool are limited to these three roles.'}</div></div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />Holds it</span><span><i className="hx" />Once v1.3 is live</span></span><span /></>);
      html(document.getElementById('bv'), <>{band(map, 1)}{band(<>{safe}{signers}</>)}{band(<>{rel}{roles}</>)}</>);
    }

    /* ══ Deploys ═══════════════════════════════════════════════════════════════════ */
    function renderDeploys() {
      if (LV) return renderDeploysLive();
      const env = cell('s12', 'Where it runs', <span className="lbl">{REPOS.length}{" repos · 3 environments"}</span>, <div className="bd-en"><div className="bd-en-r bd-en-x"><span />{ENVS.map(([k, t, s], __k) => <span key={__k}><b>{t}</b><em>{s}</em></span>)}</div>{REPOS.map((r, __k) => <div key={__k} className="bd-en-r"><button className="bd-en-k" data-brepo={r.id}><b>{RSHORT[r.id]}</b><span>{r.path || r.name}{" · "}{r.lang}</span></button>{ENVS.map(([k], __k) => {
            const [v, s, st] = ENV[r.id][k];
            return <span key={__k} className={`bd-en-c ${st}`}><i /><span><b>{v}</b><em>{s}</em></span></span>;
          })}</div>)}</div>, <><span className="f-key"><span><i style={css("background:var(--settled)")} />Running</span><span><i style={css("background:var(--underway)")} />Running, needs a look</span><span><i className="hx" />Not launched</span></span><span>Mainnet needs the Phase 0 fixes and an audit</span></>);
      const checks = cell('s7', 'Checks', <span className="lbl">Default branch · last 30 days</span>, <div className="bd-ch"><div className="bd-ch-r bd-ch-x"><span />{lbl('Pass rate')}{lbl('Runs')}{lbl('Time')}{lbl('Coverage')}</div>{REPOS.map((r, __k) => <button key={__k} className={`bd-ch-r ${r.main}`} data-brepo={r.id}><span className="bd-ch-k">{ckDot(r.main)}<span><b>{RSHORT[r.id]}</b><em>{r.main === 'fail' ? r.failing : `${int(r.tests)} tests`}</em></span></span><span className="bd-ch-p"><span className="bd-ch-b"><i style={css(`width:${r.rate * 100}%`)} /><i className="f" style={css(`width:${(1 - r.rate) * 100}%`)} /></span><b>{Math.round(r.rate * 100)}%</b></span><span>{r.runs}</span><span>{r.dur}</span><span>{r.cov == null ? '–' : r.cov + '%'}</span></button>)}</div>, <><span>Checks run per folder · a red one blocks only what touches it</span><button data-bopen="a212">The fix for dev →</button></>);
      const per = 6,
        L = DEPLOYS;
      B.dp = Math.min(B.dp, Math.ceil(L.length / per) - 1);
      const hist = cell('s5', 'Deploys', <span className="lbl">Newest first</span>, <div className="bd-dl">{L.slice(B.dp * per, B.dp * per + per).map(([t, r, e, v, by, st, s], __k) => <div key={__k} className={`bd-dl-r ${st}`}>{leaf(t)}<span><b>{RSHORT[r]}{" · "}{v}</b><span>{{
                test: r === 'proto' ? 'Base Sepolia' : 'Sandbox',
                prod: 'Production'
              }[e]}{" · "}{PPL[by] ? who(by) : by}{" · "}{s}</span></span><span className={`fst ${st === 'back' ? 'warn2' : st === 'warn' ? 'warn2' : ''}`}>{{
              ok: 'Live',
              warn: 'Live',
              back: 'Rolled back'
            }[st]}</span></div>)}</div>, <><span>Apps deploy on merge</span>{pager(B.dp, L.length, per, 'bdp')}</>);
      html(document.getElementById('bv'), <>{band(env, 1)}{band(<>{checks}{hist}</>)}</>);
    }

    /* ══ Security ══════════════════════════════════════════════════════════════════ */
    function renderSecurity() {
      if (LV) return renderSecurityLive();
      const ord = {
          critical: 0,
          high: 1,
          medium: 2,
          low: 3
        },
        F = FINDINGS.slice().sort((a, b) => (a.st === 'fixed') - (b.st === 'fixed') || ord[a.sev] - ord[b.sev]);
      const open = F.filter(f => f.st !== 'fixed');
      const fnd = cell('s8', 'Findings', <span className="lbl">{open.length}{" open · "}{F.length - open.length}{" fixed"}</span>, <div className="bd-fd">{F.map((f, __k) => {
          const fx = f.fix && CHG[f.fix];
          return <button key={__k} className={`bd-fd-r ${f.st}`} data-bfind={f.id}><span className={`bd-sev ${f.sev}`}>{SEV[f.sev][0]}</span><span className="bd-fd-k"><b>{f.t}</b><span>{f.where}</span></span><span className="bd-fd-s"><i style={css(`background:${FSTATE[f.st][1]}`)} /><span><b>{FSTATE[f.st][0]}</b><em>{f.st === 'fixed' ? `${fmtD(f.fixedAt)}` : fx ? `${fx.repo ? '#' + fx.num : fx.t} · ${stateTxt(fx).toLowerCase()}` : 'No fix yet'}</em></span></span></button>;
        })}</div>, <><span>Found by internal review and Dependabot</span><span /></>);
      const rv = 18,
        tot = 31;
      const aud = cell('s4', 'Audits', <span className="lbl">31 contracts</span>, <div className="bd-au"><div className="m-big">{rv}{" "}<small>{"of "}{tot}{" contracts reviewed internally"}</small></div><div className="bd-au-b"><i style={css(`width:${rv / tot * 100}%`)} /><i className="hx" style={css(`width:${(tot - rv) / tot * 100}%`)} /></div><div className="led bd-au-k">{[['Reviewed', 'Credit and money · 18'], ['Not yet', 'Deeds and capital · 13']].map(([k, v], i) => <div key={i}><span><i className={i ? 'hx' : ''} />{k}</span><b>{v}</b></div>)}</div><div className="bd-au-l">{lbl('Before mainnet')}<div className="led">{[['Phase 0 fixes', '1 critical left', 'p'], ['External audit', 'Not booked', ''], ['Bug bounty', 'Not yet', ''], ['Mainnet deploy', 'After all three', '']].map(([k, v, st], __k) => <div key={__k}><span>{k}</span><b className={st ? 'wt' : ''}>{v}</b></div>)}</div></div></div>, <><span>Credit and money contracts first</span><span /></>);
      const keys = cell('s6', 'Keys and access', <span className="lbl">Who can change what</span>, <div className="led bd-ky">{KEYS.map(([k, v, s], __k) => <div key={__k}><span><b>{k}</b><em>{s}</em></span><b>{v}</b></div>)}</div>, <><span>Set in Permissions and GitHub</span><button data-bgo="team">Permissions →</button></>);
      const inc = cell('s6', 'Incidents', <span className="lbl">Last 30 days</span>, <div className="bd-il">{INCIDENTS.map((i, __k) => <button key={__k} className={`bd-ir ${i.st}`} data-binc={i.id}>{leaf(i.at)}<span><b>{i.t}</b><span>{i.area}{" · "}{i.st === 'open' ? 'open' : 'resolved in ' + i.dur}</span></span><span className={`fst ${i.st === 'open' ? 'warn2' : ''}`}>{i.st === 'open' ? 'Open' : 'Closed'}</span></button>)}</div>, <><span>None reached members</span><span /></>);
      html(document.getElementById('bv'), <>{band(<>{fnd}{aud}</>, 1)}{band(<>{keys}{inc}</>)}</>);
    }

    /* ══ Live (REAL): each tab from what the poller, the indexer and the Ops Safe have ═════════════ */
    /* a cell with no real source yet: hatched, with what it needs (as Money's) */
    const notReal = (cls, title, need, id = '') => cell(cls, title, lbl('Not real yet'), <><div className="bk-empty hatch" style={css("min-height:120px;opacity:.5")} /><div className="bk-empty">{need}</div></>, <span />, id);
    const shortA = a => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    /* ── Build's own records, live (migration 0066): incidents, findings and audits, written from here ── */
    // who may write them: Propose or more on Build, in the live app (the empty preview saves nothing)
    const CANW = () => LIVE_APP && !RO() && !TOT();
    const FST = {
      ...FSTATE,
      accepted: ['Accepted · won’t fix', 'var(--line)']
    };
    const SEV_ORD = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3
    };
    const openF = f => f.state === 'open' || f.state === 'fixing';
    const PER = 6;
    /** Findings, then incidents, in a sentence (the Security tab's brief). */
    const secLine = () => {
      const fo = FINDINGS.filter(openF),
        cr = fo.filter(f => f.sev === 'critical').length,
        io = INCIDENTS.filter(i => i.st === 'open').length;
      return `${!FINDINGS.length ? 'No findings are recorded yet.' : fo.length ? `${plural(fo.length, 'finding is', 'findings are')} open${cr ? `, ${cr} critical` : ''}.` : 'Every finding is fixed or accepted.'} ${io ? `${plural(io, 'incident is', 'incidents are')} open.` : 'No incident is open.'}`;
    };
    /** The newest outside audit, done or booked (the header's tile). */
    const audLine = () => {
      const ext = LV.AUDITS.filter(a => a.kind === 'external'),
        done = ext.find(a => a.done),
        booked = ext.filter(a => !a.done).at(-1);
      return done ? `Outside audit ${fmtD(done.on)}${done.auditor ? ' · ' + done.auditor : ''}` : booked ? `Outside audit booked for ${fmtD(booked.on)}` : 'No outside audit yet';
    };
    /** The incidents a cell lists: every open one, then those that began or were resolved in the last 30 days. */
    function incCell(cls, max, more) {
      const L2 = INCIDENTS.filter(i => i.st === 'open' || Math.max(i.at, i.resolved ?? 0) >= NOW - 30 * DAY),
        op = L2.filter(i => i.st === 'open').length,
        rch = L2.filter(i => i.reached).length,
        pages = Math.ceil(L2.length / max),
        p = Math.max(0, Math.min(B.ip || 0, pages - 1)),
        paged = more && L2.length > max;
      B.ip = p;
      const rows = L2.slice(more ? p * max : 0, (more ? p * max : 0) + max);
      return cell(cls, 'Incidents', paged ? pager(p, L2.length, max, 'bip') : <span className="lbl">{L2.length > max ? `${max} of ${L2.length} · ` : ''}Open, and the last 30 days</span>, <div className="bd-il">{rows.length ? rows.map((i, __k) => <button key={__k} className={`bd-ir ${i.st}`} data-binc={i.id}>{leaf(i.at)}<span><b>{i.t}</b><span>{i.area}{" · "}{i.st === 'open' ? i.who === 'none' ? 'open · nobody on it' : `open · ${who(i.who)}` : 'resolved in ' + i.dur}</span></span><span className={`fst ${i.st === 'open' ? 'warn2' : ''}`}>{i.st === 'open' ? 'Open' : 'Closed'}</span></button>) : <div className="bd-e">{INCIDENTS.length ? 'None in the last 30 days' : 'No incidents yet'}</div>}</div>, <><span>{op}{" open · "}{rch ? `${rch} reached members` : 'none reached members'}</span>{more || <span />}</>);
    }
    /** The findings register: open first, then by severity, newest first; paged. */
    function fndCell() {
      const F = FINDINGS.slice().sort((a, b) => !openF(a) - !openF(b) || SEV_ORD[a.sev] - SEV_ORD[b.sev] || b.found - a.found),
        open = F.filter(openF).length,
        fixed = F.filter(f => f.state === 'fixed').length,
        acc = F.length - open - fixed,
        pages = Math.ceil(F.length / PER),
        p = Math.max(0, Math.min(B.fp || 0, pages - 1)),
        by = [...new Set(F.map(f => f.by).filter(Boolean))];
      B.fp = p;
      const row = (f, k) => {
        const fx = f.fix && CHG[f.fix],
          em = f.state === 'fixed' ? `Fixed ${fmtD(f.stAt)}` : f.state === 'accepted' ? `${fmtD(f.stAt)}${f.stNote ? ' · ' + f.stNote : ''}` : fx ? `${fx.repo ? '#' + fx.num : fx.t} · ${stateTxt(fx).toLowerCase()}` : f.pr ? `#${f.pr}` : f.change ? 'A change on Build' : 'No fix yet';
        return <button key={k} className={`bd-fd-r ${f.st}`} data-bfind={f.id}><span className={`bd-sev ${f.sev}`}>{SEV[f.sev][0]}</span><span className="bd-fd-k"><b>{f.t}</b><span>{f.where}</span></span><span className="bd-fd-s"><i style={css(`background:${FST[f.st][1]}`)} /><span><b>{FST[f.st][0]}</b><em>{em}</em></span></span></button>;
      };
      const right = F.length > PER && CANW() ? pager(p, F.length, PER, 'bfp') : <span className="lbl">{open}{" open · "}{fixed}{" fixed"}{acc ? ` · ${acc} accepted` : ''}</span>;
      const foot = CANW() ? <button data-bnew="finding">Add a finding</button> : F.length > PER ? pager(p, F.length, PER, 'bfp') : <span />;
      return cell('s8', 'Findings', right, <div className="bd-fd">{F.length ? F.slice(p * PER, p * PER + PER).map(row) : <div className="bd-e">No findings recorded yet</div>}</div>, <><span>{by.length ? `Found by ${by.slice(0, 2).join(' and ')}${by.length > 2 ? ` and ${by.length - 2} more` : ''}` : 'Each one is recorded here'}</span>{foot}</>);
    }
    /** Which contracts have been reviewed, and the audits themselves, newest first. */
    function audCell() {
      const tot = CTR.length,
        R = LV.reviewed,
        rv = R.any.size,
        ext = R.external.size,
        A = LV.AUDITS,
        last = A.find(a => a.kind === 'external' && a.done);
      const name = a => a.auditor || (a.kind === 'external' ? 'An outside auditor' : 'Internal review');
      return cell('s4', 'Audits', <span className="lbl">{plural(tot, 'contract', 'contracts')}</span>, <div className="bd-au"><div className="m-big">{rv}{" "}<small>{"of "}{tot}{" contracts reviewed"}</small></div><div className="bd-au-b"><i style={css(`width:${tot ? rv / tot * 100 : 0}%`)} /><i className="hx" style={css(`width:${tot ? (tot - rv) / tot * 100 : 100}%`)} /></div><div className="led bd-au-k">{[['Reviewed', `${ext} by an outside auditor · ${rv - ext} internally`], ['Not yet', plural(tot - rv, 'contract', 'contracts')]].map(([k, v], i) => <div key={i}><span><i className={i ? 'hx' : ''} />{k}</span><b>{v}</b></div>)}</div><div className="bd-au-l">{lbl('Audits')}<div className="led">{A.length ? A.slice(0, 4).map((a, __k) => <div key={__k} title={[a.names.join(', '), a.scope].filter(Boolean).join(' · ')}><span>{name(a)}{" · "}{a.names.length === 1 ? a.names[0] : plural(a.names.length, 'contract', 'contracts')}</span><b className={a.done ? '' : 'wt'}>{a.done ? fmtD(a.on) : `Booked · ${fmtD(a.on)}`}{a.report ? <>{" · "}<button className="lnk3" data-bgh={a.report}>Report ↗</button></> : ''}</b></div>) : <div className="lv-e"><span>No audits recorded yet</span></div>}</div></div></div>, <><span>{last ? `Last outside audit ${fmtD(last.on)}` : 'No outside audit yet'}</span>{CANW() ? <button data-bnew="audit">Record an audit</button> : <span />}</>);
    }
    /* the panels' fields: the reference's .vin inputs, each with its label */
    const fld = (label, input) => <label style={css('display:block')}>{lbl(label)}{input}</label>;
    const two = (a, b) => <div style={css('display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px')}>{a}{b}</div>;
    const row2 = (a, b) => <div style={css('display:flex;gap:8px;align-items:center;margin-top:8px')}>{a}{b}</div>;
    const sevSel = (id, v) => <select className="vin" id={id} defaultValue={v}>{Object.keys(SEV_ORD).map(k => <option key={k} value={k}>{SEV[k][0]}</option>)}</select>;
    const ctrSel = id => <select className="vin" id={id} defaultValue=""><option value="">None</option>{CTR.map(c => <option key={c[0]} value={c[0]}>{c[1]}</option>)}</select>;
    const today = () => new Date(NOW - new Date(NOW).getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    const teamOpts = cur => <><option value="">Nobody yet</option>{LV.TEAM.map(([k, n]) => <option key={k} value={k}>{k === B.me ? `You · ${n}` : n}</option>)}{cur !== 'none' && !LV.TEAM.some(([k]) => k === cur) ? <option value={cur}>{who(cur)}</option> : ''}</>;
    /** A form for a new incident, finding or audit, in the side panel. */
    function formLive(k) {
      const foot = (save, txt) => <div className="pn-ft"><button className="btn" data-bclose="">Cancel</button><button className="btn p" data-bsave={save}>{txt}</button></div>;
      if (k === 'incident') return <>{phd('Incident · new')}<><div className="pn-b"><div><p className="bpn-t">Open an incident</p><p className="bpn-s">Something went wrong: a sync behind, a deploy rolled back, a contract that paused. Its timeline starts here.</p></div>{fld('What happened', <input className="vin" id="bf-t" autoComplete="off" maxLength={160} />)}{two(fld('How bad', sevSel('bf-sev', 'low')), fld('Where', <select className="vin" id="bf-area" defaultValue=""><option value="">Not sure yet</option>{[...new Set([...REPOS.map(r => RSHORT[r.id]), 'Money', 'Providers', 'Command'])].map(a => <option key={a} value={a}>{a}</option>)}</select>))}{two(fld('Contract', ctrSel('bf-c')), fld('Who’s on it', <select className="vin" id="bf-own" defaultValue={LV.TEAM.some(([x]) => x === B.me) ? B.me : ''}>{teamOpts('none')}</select>))}{fld('When it began · if before now', <input className="vin" type="datetime-local" id="bf-at" />)}{fld('What we know', <textarea className="vin" id="bf-n" rows="3" maxLength={1000} />)}<label style={css('display:flex;gap:8px;align-items:center;font-size:13px')}><input type="checkbox" id="bf-r" />{" It reached members"}</label></div>{foot('incident', 'Open the incident')}</></>;
      if (k === 'finding') return <>{phd('Finding · new')}<><div className="pn-b"><div><p className="bpn-t">Add a finding</p><p className="bpn-s">A security finding: how bad it is, where, and who found it. Link its fix once there is one.</p></div>{fld('What it is', <input className="vin" id="bf-t" autoComplete="off" maxLength={160} />)}{two(fld('How bad', sevSel('bf-sev', 'medium')), fld('Contract', ctrSel('bf-c')))}{fld('Where · a function or a folder', <input className="vin" id="bf-w" autoComplete="off" maxLength={160} />)}{two(fld('Found by', <input className="vin" id="bf-by" defaultValue="Internal review" autoComplete="off" maxLength={80} />), fld('Found on', <input className="vin" type="date" id="bf-on" defaultValue={today()} max={today()} />))}{fld('What it means', <textarea className="vin" id="bf-n" rows="4" maxLength={2000} />)}</div>{foot('finding', 'Add the finding')}</></>;
      if (k === 'audit') return <>{phd('Audit · new')}<><div className="pn-b"><div><p className="bpn-t">Record an audit</p><p className="bpn-s">Which contracts were reviewed, internally or by an outside auditor. A day still to come is one that’s booked.</p></div>{two(fld('Kind', <select className="vin" id="bf-k" defaultValue="internal"><option value="internal">Internal review</option><option value="external">An outside auditor</option></select>), fld('Day', <input className="vin" type="date" id="bf-on" defaultValue={today()} />))}{fld('Who did it', <input className="vin" id="bf-by" autoComplete="off" maxLength={120} />)}<div>{lbl('Contracts')}<div style={css('display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px 12px;margin-top:8px;max-height:240px;overflow:auto;font-size:13px')}>{CTR.map(c => <label key={c[0]} style={css('display:flex;gap:6px;align-items:center;min-width:0')}><input type="checkbox" data-bfc={c[0]} /><span style={css('overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{c[1]}</span></label>)}</div></div>{fld('Scope · a version, a commit, what was left out', <input className="vin" id="bf-sc" autoComplete="off" maxLength={300} />)}{fld('Report · a link', <input className="vin" type="url" id="bf-rp" placeholder="https://" autoComplete="off" maxLength={500} />)}{fld('Note', <textarea className="vin" id="bf-n" rows="2" maxLength={1000} />)}</div>{foot('audit', 'Record the audit')}</></>;
      return '';
    }
    /** An incident, live: its timeline, who's on it, and (to someone on Build) an update, a new owner or resolving it. */
    function incPanelLive(i) {
      const open = i.st === 'open',
        w = CANW() && open,
        on = i.who === 'none' ? 'nobody is on it yet' : i.who === B.me ? 'you’re on it' : `${who(i.who)} is on it`;
      const rows = [['How bad', <span className={`bd-sev ${i.sev}`}>{SEV[i.sev][0]}</span>], ['Began', `${fmtD(i.at)} ${hm(i.at)}`], ...(i.contract && ctrOf(i.contract) ? [['Contract', <button className="lnk3" data-bctr={i.contract}>{ctrOf(i.contract)[1]}</button>]] : []), ['Reached members', i.reached ? 'Yes' : 'No'], ...(open ? [] : [['Resolved', `${fmtD(i.resolved)} ${hm(i.resolved)}`], ...(i.resolution ? [['What resolved it', i.resolution]] : [])])];
      return <>{phd('Incident', <span className={`fst ${open ? 'warn2' : ''}`} style={css("margin-left:8px")}>{open ? 'Open' : 'Closed'}</span>)}<><div className="pn-b"><div><p className="bpn-t">{i.t}</p><p className="bpn-s">{i.area}{" · "}{open ? on : 'resolved in ' + i.dur}</p></div>{i.note ? <p className="bpn-n">{i.note}</p> : ''}<div className="led">{rows.map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div><div>{lbl('What happened')}<div className="bd-tl">{(i.ev.length ? i.ev : [[i.at, 'Began', '']]).map(([t, s2, by], __k) => <div key={__k}><span className="mono">{fmtD(t)}{" "}{hm(t)}</span><span>{s2}{by && !s2.includes(by) ? ` · ${by}` : ''}</span></div>)}</div></div>{w ? <div>{lbl('Who’s on it')}{row2(<select className="vin" id="bown" defaultValue={i.who === 'none' ? '' : i.who} style={css('flex:1;margin-top:0')}>{teamOpts(i.who)}</select>, <button className="btn" data-bassign={i.id}>Give it</button>)}</div> : ''}{w ? fld('An update, or what resolved it', <textarea className="vin" id="bupd" rows="3" maxLength={500} />) : ''}</div><div className="pn-ft"><span className="small quiet" style={css("margin-right:auto")}>{open ? 'Open ' + ago(i.at) : 'Resolved in ' + i.dur}</span>{w ? <><button className="btn" data-bincup={i.id}>Add the update</button><button className="btn p" data-bresolve={i.id}>Mark resolved</button></> : ''}</div></></>;
    }
    /** A finding, live: where it is, its fix, and (to someone on Build) linking a fix or changing its state. */
    function findPanelLive(f) {
      const fx = f.fix && CHG[f.fix],
        acc = f.state === 'accepted',
        w = CANW(),
        steps = acc ? ['Found', 'Accepted · won’t fix'] : ['Found', 'Fix in progress', 'Fix waiting on a signature', 'Fixed'],
        at = acc ? 1 : ['open', 'fixing', 'waiting', 'fixed'].indexOf(f.st);
      const fixV = fx ? <button className="lnk3" data-bopen={fx.id}>{fx.repo ? '#' + fx.num + ' · ' : ''}{fx.t}</button> : f.pr ? f.prUrl ? <button className="lnk3" data-bgh={f.prUrl}>{`#${f.pr} ↗`}</button> : `#${f.pr}` : f.change ? <span className="mono">{f.change}</span> : 'None linked yet';
      const rows = [['Found', `${fmtD(f.found)}${f.by ? ' · ' + f.by : ''}`], ...(f.contract ? [['Contract', <button className="lnk3" data-bctr={f.contract}>{ctrOf(f.contract)[1]}</button>]] : []), ['Fix', fixV], ...(fx ? [['Where it is', stateTxt(fx)]] : []), ...(f.state === 'fixed' || acc ? [[acc ? 'Accepted' : 'Fixed', fmtD(f.stAt)]] : []), ...(acc && f.stNote ? [['Why', f.stNote]] : [])];
      // a fix is a pull request (by its number) or a change Build lists
      const cur = f.pr ? 'pr:' + f.pr : f.change ? 'ch:' + f.change : '';
      const opts = CHANGES.map(c => [c.repo && c.num ? 'pr:' + c.num : 'ch:' + c.id, `${c.repo && c.num ? '#' + c.num : c.kind === 'upgrade' ? 'Next release' : 'Ops Safe'} · ${c.t}`]);
      // one Build no longer lists (merged over a week ago, executed) keeps its own option
      if (cur && !opts.some(o => o[0] === cur)) opts.unshift([cur, f.pr ? `#${f.pr}` : f.change]);
      const edit = w ? <><div>{lbl('Its fix')}{row2(<select className="vin" id="bfixc" defaultValue={cur} style={css('flex:1;min-width:0;margin-top:0')}><option value="">None</option>{opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>, <input className="vin" id="bfixn" inputMode="numeric" placeholder="or #PR" aria-label="A pull request’s number" style={css('width:90px;margin-top:0')} />)}{row2(<span className="small quiet" style={css('flex:1')}>Linking a fix to an open finding puts it in progress</span>, <button className="btn" data-bfix={f.id}>Link the fix</button>)}</div><div>{lbl('Its state')}{row2(<select className="vin" id="bfsts" defaultValue={f.state} style={css('flex:1;margin-top:0')}>{[['open', 'Open'], ['fixing', 'Fix in progress'], ['fixed', 'Fixed'], ['accepted', 'Accepted · won’t fix']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>, <button className="btn" data-bfst={f.id}>Change it</button>)}<input className="vin" id="bfstn" autoComplete="off" maxLength={500} placeholder={f.sev === 'critical' ? 'Why it won’t be fixed · a second person approves' : 'Why, if it won’t be fixed'} /></div></> : '';
      return <>{phd('Finding', <span className={`bd-sev ${f.sev}`} style={css("margin-left:8px")}>{SEV[f.sev][0]}</span>)}<><div className="pn-b"><div><p className="bpn-t">{f.t}</p><p className="bpn-s">{f.where}</p></div><div className="bd-tk">{steps.map((t, i) => <span key={i} className={i < at ? 'done' : i === at ? 'now' : ''}><i />{t}</span>)}</div>{f.note ? <p className="bpn-n">{f.note}</p> : ''}<div className="led">{rows.map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{edit}</div><div className="pn-ft">{fx && need(fx) ? <button className="btn p" data-bopen={fx.id}>{need(fx) === 'sign' ? 'Sign the fix' : 'Review the fix'}</button> : <span className="small quiet" style={css("margin-right:auto")}>{FST[f.st][0]}</span>}</div></></>;
    }
    const val = id => (document.getElementById(id)?.value ?? '').trim();
    /** Saves a record from its panel or form (POST /actions/contracts/…); the page is built again from the answer, the panel kept. */
    function saveLive(t, d) {
      if (!LIVE_APP) return toast('Nothing is saved in the preview');
      const inc = id => INCIDENTS.find(i => i.id === id),
        fnd = id => FINDINGS.find(f => f.id === id);
      let kind, body, then, said;
      if (d.bsave === 'incident') {
        body = {
          title: val('bf-t'),
          severity: val('bf-sev') || 'low',
          area: val('bf-area'),
          note: val('bf-n'),
          reached: !!document.getElementById('bf-r')?.checked
        };
        if (!body.title) return toast('Say what happened');
        if (val('bf-c')) body.contract = val('bf-c');
        if (val('bf-own')) body.owner = val('bf-own');
        if (val('bf-at')) body.at = Date.parse(val('bf-at'));
        [kind, said, then] = ['incident-open', 'Incident opened · logged in Records', r => ({
          inc: 'I' + r.result.id
        })];
      } else if (d.bsave === 'finding') {
        body = {
          title: val('bf-t'),
          severity: val('bf-sev') || 'medium',
          area: val('bf-w'),
          note: val('bf-n'),
          foundBy: val('bf-by')
        };
        if (!body.title) return toast('Say what the finding is');
        if (!body.foundBy) return toast('Say who found it');
        if (val('bf-c')) body.contract = val('bf-c');
        if (val('bf-on') && val('bf-on') !== today()) body.at = Date.parse(val('bf-on'));
        [kind, said, then] = ['finding-add', 'Finding recorded · logged in Records', r => ({
          find: 'F' + r.result.id
        })];
      } else if (d.bsave === 'audit') {
        const cs = [...document.querySelectorAll('[data-bfc]')].filter(x => x.checked).map(x => x.dataset.bfc);
        body = {
          kind: val('bf-k') || 'internal',
          auditor: val('bf-by'),
          contracts: cs,
          scope: val('bf-sc'),
          on: val('bf-on'),
          note: val('bf-n')
        };
        if (!body.auditor) return toast('Say who did it');
        if (!cs.length) return toast('Pick the contracts it covered');
        if (!body.on) return toast('Pick the day');
        if (val('bf-rp')) {
          if (!/^https:\/\//.test(val('bf-rp'))) return toast('The report’s link starts with https://');
          body.report = val('bf-rp');
        }
        [kind, said, then] = ['audit', 'Audit recorded · logged in Records', () => null];
      } else if (d.bincup || d.bresolve) {
        const i = inc(d.bincup || d.bresolve);
        if (!i) return;
        if (d.bincup && !val('bupd')) return toast('Write the update first');
        [kind, body, said] = d.bincup ? ['incident-update', {
          id: i.n,
          line: val('bupd')
        }, 'Update added'] : ['incident-resolve', {
          id: i.n,
          resolution: val('bupd')
        }, 'Marked resolved · logged in Records'];
        then = () => ({
          inc: i.id
        });
      } else if (d.bassign) {
        const i = inc(d.bassign);
        if (!i) return;
        const o = val('bown') || null;
        if ((o || 'none') === i.who) return toast(o ? `${who(o)} is on it already` : 'Nobody is on it already');
        [kind, body, said, then] = ['incident-assign', {
          id: i.n,
          owner: o
        }, o ? `Given to ${who(o)}` : 'Taken off its owner', () => ({
          inc: i.id
        })];
      } else if (d.bfst) {
        const f = fnd(d.bfst);
        if (!f) return;
        const st = val('bfsts');
        if (st === f.state) return toast(`It’s ${FST[st][0].toLowerCase()} already`);
        if (st === 'accepted' && !val('bfstn')) return toast('Say why it won’t be fixed');
        [kind, body, said, then] = ['finding-state', {
          id: f.n,
          state: st,
          note: val('bfstn')
        }, `Marked ${FST[st][0].toLowerCase()}`, () => ({
          find: f.id
        })];
      } else if (d.bfix) {
        const f = fnd(d.bfix);
        if (!f) return;
        const n = val('bfixn').replace(/^#/, ''),
          c = val('bfixc');
        if (n && !/^[1-9]\d{0,6}$/.test(n)) return toast('A pull request’s number, like 132');
        body = {
          id: f.n
        };
        if (n) body.pr = +n;else if (c.startsWith('pr:')) body.pr = +c.slice(3);else if (c.startsWith('ch:')) body.change = c.slice(3);
        if (!body.pr && !body.change && !f.pr && !f.change) return toast('Pick the change that fixes it, or type its pull request’s number');
        [kind, said, then] = ['finding-fix', body.pr || body.change ? 'Fix linked' : 'Fix taken off', () => ({
          find: f.id
        })];
      } else return;
      t.disabled = true;
      act('contracts', kind, body).then(r => {
        toast(r.proposal ? 'Sent for a second person · it changes once someone else approves it in Needs you' : said);
        const P = then?.(r);
        B.panel = r.proposal ? B.panel : P;
        B.rej = false;
        renderShell();
      }, e => {
        t.disabled = false;
        toast(e.message);
      });
    }
    /** What waits in the Ops Safe, in a sentence. */
    const safeLine = () => {
      const m = mine(),
        q = CHANGES.filter(c => c.st === 'safe');
      if (!LV.safe && !q.length) return 'No Ops Safe is connected here yet.';
      if (m.length) return <><a data-btab="contracts">{m.length === 1 ? '1 change waits' : `${m.length} changes wait`}</a>{" on your signature in the Ops Safe."}</>;
      return q.length ? `${plural(q.length, 'change waits', 'changes wait')} in the Ops Safe.` : 'Nothing waits in the Ops Safe.';
    };
    const net = () => LV.chain.network || 'the chain';
    const chainTxt = () => LV.chain.network ? `${LV.chain.network}${LV.chain.block ? ' · block ' + int(LV.chain.block) : ' · not indexed yet'}` : 'Not indexed yet';
    function renderHdrLive() {
      const m = mine(),
        open = CHANGES.filter(c => c.st === 'draft' || c.st === 'review'),
        next = CHANGES.find(c => c.kind === 'upgrade' && c.st === 'draft'),
        n = CTR.length,
        pct = n ? LV.deployed / n * 100 : 0;
      const BR = {
        overview: <>{safeLine()}{" "}{!REPOS[0].full ? 'GitHub isn’t connected yet.' : open.length ? `${plural(open.length, 'change is', 'changes are')} open on ${REPOS[0].full}.` : `Nothing is open on ${REPOS[0].full}.`}</>,
        changes: `${CHANGES.filter(c => c.st === 'review').length} in review and ${CHANGES.filter(c => c.st === 'safe').length} in the Ops Safe. ${CHANGES.filter(c => c.st === 'shipped').length} shipped in the last 7 days.`,
        contracts: <>{LV.chain.network ? `${LV.deployed} of ${n} contracts are found on ${net()}.` : 'The chain isn’t indexed yet.'}{" "}{next ? <><a data-bopen={next.id}>{next.t}</a>{" is next: "}{next.state}.</> : safeLine()}</>,
        deploys: `${LV.chain.network ? `The contracts run on ${net()}.` : 'The chain isn’t indexed yet.'} Where the apps run (Railway and Vercel) isn’t read yet.`,
        security: <>{secLine()}{" "}{safeLine()}</>
      }[B.tab];
      const fo = FINDINGS.filter(openF),
        fcrit = fo.filter(f => f.sev === 'critical').length;
      html(document.getElementById('hdr'), <><span className="when"><span className="dot" />{`Build · ${WD(NOW)} ${fmtD(NOW)}`}</span><p className="brief">{BR}</p><div className="strip"><div className="sc" data-btab="changes"><span className="lbl">Waiting on you</span><div className="sc-v">{m.length}{" "}<small>{m.length === 1 ? 'change' : 'changes'}</small></div><div className="mb">{m.map((c, i) => <i key={i} style={css(`left:${i * 100 / Math.max(2, m.length)}%;width:calc(${100 / Math.max(2, m.length)}% - 2px);background:var(--live)`)} />)}</div><div className="sc-s">{`${m.length} to sign · ${CHANGES.filter(c => c.st === 'review' && (c.asked || []).includes(B.me)).length} reviews asked of you`}</div></div><div className="sc" data-btab="deploys"><span className="lbl">Checks</span>{LV.RUNS && LV.RUNS.runs ? <><div className="sc-v">{REPOS.filter(r => r.main === 'pass').length}{" "}<small>{"of "}{REPOS.length}{" passing"}</small></div><div className="mb">{REPOS.map((r, i) => <i key={i} style={css(`left:${i * 100 / REPOS.length}%;width:calc(${100 / REPOS.length}% - 2px);background:${CK[r.main][1]}`)} />)}</div><div className="sc-s">{REPOS.some(r => r.main === 'fail') ? `${REPOS.filter(r => r.main === 'fail').map(r => RSHORT[r.id]).join(', ')} failing into ${LV.RUNS.branch}` : `${LV.RUNS.passed} of ${LV.RUNS.runs} runs into ${LV.RUNS.branch} passed`}</div></> : <><div className="sc-v">—</div><div className="mb hatch" /><div className="sc-s">{LV.RUNS ? 'No runs in 30 days' : 'GitHub Actions aren’t read yet'}</div></>}</div><div className="sc" data-btab="contracts"><span className="lbl">{LV.chain.network === 'Base' ? 'On mainnet' : 'On testnet'}</span><div className="sc-v">{LV.deployed}{" "}<small>{"of "}{n}{" contracts"}</small></div><div className="mb"><i style={css(`width:${pct}%`)} /><span className="hroom" style={css(`left:${pct}%;right:0`)} /></div><div className="sc-s">{chainTxt()}</div></div><div className="sc" data-btab="security"><span className="lbl">Open findings</span><div className="sc-v">{fo.length}{" "}<small>{fcrit}{" critical"}</small></div><div className="mb">{fo.map((f, i) => <i key={i} style={css(`left:${i / Math.max(5, fo.length) * 100}%;width:calc(${100 / Math.max(5, fo.length)}% - 2px);background:${SEV[f.sev][1]}`)} />)}</div><div className="sc-s">{audLine()}</div></div></div></>);
    }
    function renderOverviewLive() {
      const m = mine(),
        ready = CHANGES.filter(c => c.ready);
      const NEED = [...m.map(c => ['live', c.outbox ? `Sign and send · ${c.t}` : `Sign · ${c.t}`, `Ops Safe · ${sigCount(c)} of ${c.req || LV.threshold} signed${c.from ? ' · from ' + c.from : ''}`, ago(c.opened).replace(' ago', ''), 'Your signature', `data-bopen="${c.id}"`, 1]), ...ready.map(c => ['underway', `Execute · ${c.t}`, `Ops Safe · ${sigCount(c)} of ${c.req} signed · in Safe{Wallet}`, ago(c.opened).replace(' ago', ''), 'Anyone can', `data-bopen="${c.id}"`]), ...INCIDENTS.filter(i => i.st === 'open' && (i.who === B.me || i.who === 'none')).map(i => ['absent', i.t, `${i.area} · ${SEV[i.sev][0]}`, ago(i.at).replace(' ago', ''), i.who === B.me ? 'You’re on it' : 'Nobody is on it', `data-binc="${i.id}"`, i.who === B.me ? 1 : 0])];
      const needs = cell('s5', 'Needs you', <span className="lbl">{plural(NEED.length, 'thing', 'things')}</span>, <div className="bd-nd">{NEED.length ? NEED.map(([sv, t, mm, age, own, at, me], __k) => <button key={__k} className="bd-nd-r" {...attrs(at)}><i style={css(`background:${{
            underway: 'var(--underway)',
            live: 'var(--live)',
            absent: 'var(--absent)'
          }[sv]}`)} /><span className="bd-nd-k"><b>{t}</b><span>{mm}</span></span><span className="bd-nd-a"><span className={me ? 'me' : ''}>{own}</span><span className="mono">{age}</span></span></button>) : <div className="bd-e">Nothing needs you</div>}</div>, <><span>{LV.safe ? `Contract changes need ${LV.threshold} of ${LV.safe.owners.length} signers` : 'No Ops Safe is connected yet'}</span><button data-btab="changes">All changes →</button></>);
      const repos = cell('s7', 'Every project', <span className="lbl">{plural(REPOS.length, 'project', 'projects')}{" · watched on GitHub"}</span>, <div className="bd-rp"><div className="bd-rp-r hd2"><span />{lbl('Project')}{lbl('Checks')}{lbl('Open')}{lbl('Last commit')}{lbl('Runs on')}</div>{REPOS.map((r, i) => {
          const o = CHANGES.filter(c => c.repo === r.id && (c.st === 'draft' || c.st === 'review')).length;
          return <Fragment key={i}><div className="bd-rp-g">{lbl(`${r.full || r.name} · ${r.branch}`)}</div><button className="bd-rp-r" data-brepo={r.id}><span className="bd-rp-k"><b>{RSHORT[r.id]}</b><span>{r.path}/</span></span><span className={`bd-st st-${r.main}`}>{ckDot(r.main)}Not read</span><b className="bd-rp-n">{o || '–'}</b><span className="bd-rp-l">{r.last ? ago(r.last) : '—'}</span><span className="bd-rp-e">{r.live}</span></button></Fragment>;
        })}</div>, <><span>{CHANGES.filter(c => c.st === 'shipped').length}{" shipped in the last 7 days"}</span><button data-btab="deploys">Deploys →</button></>);
      const cnt = st => CHANGES.filter(c => c.st === st).length;
      const steps = STAGES.map(([k, t, s2]) => [k, t, cnt(k), s2]);
      // the longest in its stage: since it was opened (a pull request, the first unreleased commit, the Safe's queue)
      const since = c => c.opened || NOW;
      const SN = Object.fromEntries(STAGES.map(([k, t]) => [k, t]));
      const long = CHANGES.filter(c => c.st !== 'shipped').sort((a, b) => since(a) - since(b)).slice(0, 3).map(c => {
        const d = Math.floor((NOW - since(c)) / DAY);
        return [c.id, `${SN[c.st]} since ${fmtD(since(c))}`, d < 1 ? 'today' : plural(d, 'day', 'days')];
      });
      const flow = cell('s7', 'From change to live', <span className="lbl">{RSHORT.proto}{" and the Ops Safe"}</span>, <><div className="bd-fl">{steps.map(([k, t, n, s2], i) => <button key={i} className={`bd-fs ${k}`} data-btab="changes"><div className="bd-fh"><span className="bd-fn">{i + 1}</span><b>{t}</b>{i < 3 ? <span className="bd-fa"><i />{ICO.arrow}</span> : ''}</div><span className="m-big">{n}</span><span className="bd-ft">{s2}</span><div className="bd-fb">{CHANGES.filter(c => c.st === k).map((c, __k) => <i key={__k} className={need(c) ? 'me' : c.block || c.wait ? 'hx' : ''} title={c.t} />)}</div></button>)}</div><div className="bd-lw">{lbl('Longest in its stage')}{long.length ? long.map(([id, s2, d2], __k) => {
            const c = CHG[id];
            return <button key={__k} className="bd-lw-r" data-bopen={id}><span><b>{c.t}</b><em>{s2}{need(c) ? ' · waiting on you' : c.block ? ' · ' + c.block.toLowerCase() : ''}</em></span><b>{d2}</b></button>;
          }) : <div className="bd-e">Nothing in flight</div>}</div><div className="bd-fk f-key"><span><i style={css("background:var(--fg)")} />A change</span><span><i style={css("background:var(--live)")} />Waiting on you</span><span><i className="hx" />Waiting on something else</span></div></>, <><span>Contract changes go through the Ops Safe</span><span /></>);
      const inc = incCell('s5', 5, <button data-btab="security">Security →</button>);
      const days = Array.from({
          length: 28
        }, (_, d) => TODAY - (27 - d) * DAY),
        mx = Math.max(1, ...REPOS.flatMap(r => ACT[r.id]));
      const act = cell('s12', 'Activity', <span className="lbl">Commits a day · last 4 weeks · of the newest commits</span>, <div className="bd-hm"><div className="bd-hm-r bd-hm-x"><span /><span className="bd-hm-c">{days.map((t, i) => <span key={i} className={i === 27 ? 'end' : ''}>{i % 7 === 0 || i === 27 ? fmtD(t) : ''}</span>)}</span><span>{lbl('Commits')}</span></div>{REPOS.map((r, __k) => <div key={__k} className="bd-hm-r"><span className="bd-hm-k"><b>{RSHORT[r.id]}</b></span><span className="bd-hm-c">{ACT[r.id].map((v, i) => <i key={i} style={css(`--v:${(v / mx).toFixed(2)}`)} className={`${v ? '' : 'z'} ${new Date(days[i]).getUTCDay() % 6 === 0 ? 'we' : ''}`} title={`${fmtD(days[i])} · ${v} commits`} />)}</span><b>{ACT[r.id].reduce((a, b) => a + b, 0)}</b></div>)}</div>, <><span className="f-key"><span><i className="bd-sq" style={css("--v:.15")} />Fewer</span><span><i className="bd-sq" style={css("--v:1")} />More</span><span><i className="bd-sq z" />None</span></span><button data-btab="changes">Commits →</button></>);
      html(document.getElementById('bv'), <>{band(<>{needs}{repos}</>, 1)}{band(<>{flow}{inc}</>)}{band(act)}</>);
    }
    /* the foot of the Ops Safe's cells: who you sign as, linking your wallet, the Safe itself */
    const safeFoot = () => <><span>{LV.wallet ? `Signing as ${shortA(LV.wallet)}` : 'Your own wallet signs · Command holds no key'}</span>{!LV.wallet && LIVE_APP ? <button data-blink="">Link your wallet →</button> : LV.safe ? <button data-bgh={LV.safe.link}>Open the Safe ↗</button> : <span />}</>;
    function renderContractsLive() {
      const map = cell('s12', 'The protocol', <span className="lbl">{chainTxt()}</span>, <div className="bd-map">{protoMap()}</div>, <>{mapKey()}</>);
      const q = CHANGES.filter(c => c.st === 'safe'),
        sf = LV.safe,
        ks = SIGK();
      const safe = cell('s7', 'In the Ops Safe', <span className="lbl">{sf ? `${sf.threshold} of ${sf.owners.length} sign` : 'Not connected'}</span>, <div className="bd-q">{q.length ? q.map((c, __k) => {
          const s = c.sigs || {};
          return <button key={__k} className={`bd-q-r ${need(c) ? 'me' : ''}`} data-bopen={c.id}><span className="bd-q-k"><b>{c.t}</b><span>{c.contract ? cname(c.contract) : c.to ? shortA(c.to) : 'On-chain'}{" · "}{c.hash ? 'nonce ' + c.nonce : 'not sent yet'}{c.from ? ' · from ' + c.from : ''}</span></span><span className="bd-q-s">{ks.map((k, __k) => <i key={__k} className={s[k] ? 'on' : c.need === k ? 'me' : ''} title={PPL[k].n}>{PPL[k].ini}</i>)}</span><span className={`bd-q-w ${c.block ? 'blk' : ''}`}>{c.block ? <><em className="hxw" />{c.block}</> : need(c) ? <b>{c.outbox ? 'Sign and send' : 'Your signature'}</b> : c.ready ? 'Ready to execute' : c.outbox ? 'Not sent yet' : `${sigCount(c)} of ${c.req}`}</span></button>;
        }) : <div className="bd-e">{sf ? 'Nothing waits in the Ops Safe' : 'The Ops Safe isn’t connected here yet'}</div>}</div>, safeFoot());
      /* signers: signatures a week, the last eight, and each one's median hours to sign */
      const SW = k => SIGN_W[k] || [0, 0, 0, 0, 0, 0, 0, 0],
        total = SIGNERS.reduce((a, s) => a + SW(s[1]).reduce((x, y) => x + y, 0), 0),
        meRow = SIGNERS.find(s => s[0] === B.me),
        meds = SIGNERS.map(s => s[4]).filter(v => v > 0).sort((a, b) => a - b),
        med = meds.length ? meds[meds.length >> 1] : 0;
      const wl = i => {
        const t = LV.weekStart(i);
        return i === 0 || new Date(t).getUTCMonth() !== new Date(LV.weekStart(i - 1)).getUTCMonth() ? fmtD(t) : String(new Date(t).getUTCDate());
      };
      const signers = cell('s5', 'Signers', <span className="lbl">Signatures a week</span>, SIGNERS.length ? <div className="bd-sg"><div className="m-big">{meRow && meRow[4] ? <>{meRow[4].toFixed(1)}{" h "}<small>your median time to sign</small></> : med ? <>{med.toFixed(1)}{" h "}<small>the signers’ median time to sign</small></> : <>{"— "}<small>no signatures to time yet</small></>}</div><div className="bd-sh"><div className="bd-sh-r bd-sh-x"><span />{[0, 1, 2, 3, 4, 5, 6, 7].map(i => <span key={i}>{wl(i)}</span>)}<span>Median</span></div>{SIGNERS.map(([k, sk, n, r, md], __k) => <div key={__k} className="bd-sh-r"><span className="bd-sh-k">{av(k)}<b>{k === B.me ? 'You' : n}</b></span>{SW(sk).map((v, __k) => <i key={__k} style={css(`--v:${Math.min(1, v / 4)}`)} className={v ? '' : 'z'}>{v || ''}</i>)}<b>{md ? `${md.toFixed(1)} h` : '—'}</b></div>)}</div><div className="led bd-sg-l">{[['Signatures in 8 weeks', String(total)], ['To pass', sf ? `${sf.threshold} of ${sf.owners.length}` : '—']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div> : <div className="bd-e">The Ops Safe isn’t connected here yet</div>, <><span>{sf ? `Ops Safe · ${sf.threshold} of ${sf.owners.length}` : 'Ops Safe · not connected'}</span><button data-btab="security">Keys →</button></>);
      /* releases: the indexer's upgrades, the last three months */
      const from = NOW - 90 * DAY,
        to = NOW + 10 * DAY,
        X = t => Math.max(0, Math.min(100, (t - from) / (to - from) * 100)).toFixed(2),
        rows = Object.entries(RELEASES).filter(([k, v]) => ctrOf(k) && v && v.length).sort((a, b) => b[1].length - a[1].length || b[1][b[1].length - 1][1] - a[1][a[1].length - 1][1]).slice(0, 10);
      const ticks = [0, 1, 2, 3, 4].map(i => from + i * 21 * DAY);
      const rel = cell('s7', 'Releases', <span className="lbl">{`${MON[new Date(from).getUTCMonth()]} – ${MON[new Date(NOW).getUTCMonth()]}`}</span>, <div className="bd-rl"><div className="bd-rl-r bd-rl-x"><span /><span className="bd-rl-l">{ticks.map((t, i) => <span key={i} className={i % 2 ? 'odd' : ''} style={css(`left:${X(t)}%`)}>{fmtD(t)}</span>)}<span className="now" style={css(`left:${X(NOW)}%`)}>Today</span></span></div>{rows.length ? rows.map(([k, v], __k) => {
          const c = ctrOf(k);
          return <button key={__k} className="bd-rl-r" data-bctr={k}><span className="bd-rl-k"><b>{c[1]}</b><span>{c[2]}{" live"}</span></span><span className="bd-rl-l"><i className="g" style={css(`left:${X(NOW)}%`)} /><i className="ln" style={css(`left:${X(v[0][1])}%;right:${100 - X(NOW)}%`)} />{v.map(([ver, t], i) => <i key={i} className={`dot ${i === v.length - 1 ? 'cur' : ''}`} style={css(`left:${X(t)}%`)} title={`${ver} · ${fmtD(t)}`} />)}</span></button>;
        }) : <div className="bd-e">No upgrades read from the chain yet</div>}</div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />Live version</span><span><i className="bd-ko" />Earlier</span></span><span>{plural(Object.values(RELEASES).flat().length, 'release', 'releases')}</span></>);
      /* who holds each AccessManager role, once it's read */
      const kr = LV.roles;
      const roles = kr ? cell('s5', 'Who can do what', <span className="lbl">Every contract’s roles</span>, <div className="bd-ro"><div className="bd-ro-r bd-ro-x"><span />{kr.holders.map((t, __k) => <span key={__k}><em>{t}</em></span>)}</div>{kr.roles.map(([t, h], __k) => <div key={__k} className="bd-ro-r"><span>{t}</span>{kr.holders.map((_, j) => <i key={j} className={`${h[j] ? 'on' : ''} ${h[j] > 1 ? 'nx' : ''}`} />)}</div>)}</div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />Holds it</span><span><i className="hx" />Not yet</span></span><span /></>) : notReal('s5', 'Who can do what', 'Needs AccessManager’s roles read from the chain: who may upgrade, pause, mint credit and claim from the AssurancePool.');
      html(document.getElementById('bv'), <>{band(map, 1)}{band(<>{safe}{signers}</>)}{band(<>{rel}{roles}</>)}</>);
    }
    function renderDeploysLive() {
      const env = cell('s12', 'Where it runs', <span className="lbl">{plural(REPOS.length, 'project', 'projects')}{" · 3 environments"}</span>, <div className="bd-en"><div className="bd-en-r bd-en-x"><span />{ENVS.map(([k, t, s], __k) => <span key={__k}><b>{t}</b><em>{k === 'test' ? LV.chain.network || 'Not indexed yet' : k === 'prod' ? 'Mainnet' : s}</em></span>)}</div>{REPOS.map((r, __k) => <div key={__k} className="bd-en-r"><button className="bd-en-k" data-brepo={r.id}><b>{RSHORT[r.id]}</b><span>{r.path}{" · "}{r.lang}</span></button>{ENVS.map(([k], __k) => {
            const [v, s, st] = ENV[r.id][k];
            return <span key={__k} className={`bd-en-c ${st}`}><i /><span><b>{v}</b><em>{s}</em></span></span>;
          })}</div>)}</div>, <><span className="f-key"><span><i style={css("background:var(--settled)")} />Running</span><span><i style={css("box-shadow:inset 0 0 0 1px var(--hair)")} />Not read yet</span></span><span>The apps’ deploys (Railway, Vercel) aren’t read yet</span></>);
      // the branch's GitHub Actions in 30 days, each project read by the job that covers its folder (coverage isn't measured)
      const RN = LV.RUNS;
      const checks = cell('s7', 'Checks', <span className="lbl">{`Into ${RN ? RN.branch : 'dev'} · last 30 days`}</span>, RN && RN.runs ? <div className="bd-ch"><div className="bd-ch-r bd-ch-x"><span />{lbl('Pass rate')}{lbl('Runs')}{lbl('Time')}{lbl('Coverage')}</div>{REPOS.map((r, __k) => {
          const j = r.job,
            rate = j && j.runs ? j.passed / j.runs : 0;
          return <button key={__k} className={`bd-ch-r ${r.main}`} data-brepo={r.id}><span className="bd-ch-k">{ckDot(r.main)}<span><b>{RSHORT[r.id]}</b><em>{j ? j.name : 'No job checks this folder'}</em></span></span><span className="bd-ch-p">{j ? <><span className="bd-ch-b"><i style={css(`width:${rate * 100}%`)} /><i className="f" style={css(`width:${(1 - rate) * 100}%`)} /></span><b>{Math.round(rate * 100)}%</b></> : <span className="quiet">–</span>}</span><span>{j ? j.runs : '–'}</span><span>{j && j.medianMs ? span2(j.medianMs) : '–'}</span><span className="quiet">–</span></button>;
        })}</div> : <div className="lv-e"><span>{RN ? 'No pull request ran its checks in the last 30 days' : 'GitHub Actions aren’t read yet'}</span></div>, <><span>{RN && RN.last ? `Last run ${RN.last.status === 'completed' ? RN.last.conclusion === 'success' ? 'passed' : RN.last.conclusion : 'still running'} · ${dayLbl(RN.last.at)} · coverage isn’t measured` : 'Checks run per folder · coverage isn’t measured'}</span>{RN && RN.last ? <button data-bgh={RN.last.url}>Runs in GitHub ↗</button> : <span />}</>);
      const per = 6,
        D2 = DEPLOYS;
      B.dp = Math.max(0, Math.min(B.dp, Math.ceil(D2.length / per) - 1));
      const hist = cell('s5', 'Deploys', <span className="lbl">Contract upgrades · newest first</span>, <div className="bd-dl">{D2.length ? D2.slice(B.dp * per, B.dp * per + per).map(([t, r, e, v, by, st, s], __k) => <div key={__k} className={`bd-dl-r ${st}`}>{leaf(t)}<span><b>{RSHORT[r]}{" · "}{v}</b><span>{LV.chain.network || 'The chain'}{" · "}{by}{" · "}{s}</span></span><span className="fst">Live</span></div>) : <div className="bd-e">No upgrades read from the chain yet</div>}</div>, <><span>From the chain’s Upgraded events</span>{pager(B.dp, D2.length, per, 'bdp')}</>);
      html(document.getElementById('bv'), <>{band(env, 1)}{band(<>{checks}{hist}</>)}</>);
    }
    function renderSecurityLive() {
      const fnd = fndCell();
      const aud = audCell();
      const keys = cell('s6', 'Keys and access', <span className="lbl">Who can change what</span>, <div className="led bd-ky">{KEYS.map(([k, v, s], __k) => <div key={__k}><span><b>{k}</b><em>{s}</em></span><b>{v}</b></div>)}</div>, <><span>Set in Team and GitHub</span><button data-bgo="team">Team →</button></>);
      const inc = incCell('s6', 6, CANW() ? <button data-bnew="incident">Open an incident</button> : null);
      html(document.getElementById('bv'), <>{band(<>{fnd}{aud}</>, 1)}{band(<>{keys}{inc}</>)}</>);
    }
    /* a change's panel, live: the pull request, the unreleased commits, or the Safe transaction */
    function chPanelLive(c) {
      const n = need(c),
        s = c.sigs || {},
        sf = LV.safe,
        req = c.req || LV.threshold,
        br = REPOS[0].branch;
      const head = c.kind === 'code' ? 'Pull request' : c.kind === 'upgrade' ? c.st === 'shipped' ? 'Contract release' : 'Contract change in progress' : c.st === 'shipped' ? 'Ops Safe transaction' : 'In the Ops Safe';
      const T = c.kind === 'code' ? ['Draft', 'Review', 'Merged'] : c.kind === 'upgrade' ? [`Commits on ${br}`, 'Released'] : ['Proposed', 'Ops Safe', 'Signed', 'Executed'];
      const at = c.kind === 'code' ? {
        draft: 0,
        review: 1,
        shipped: 3
      }[c.st] : c.kind === 'upgrade' ? c.st === 'shipped' ? 2 : 0 : c.st === 'shipped' ? 4 : c.ready ? 2 : c.outbox || c.block ? 0 : 1;
      const rows = [...(c.num ? [['Repo', `${REPOS[0].full} · #${c.num}`], ['Branch', `${c.head} → ${c.base}`], ['Checks', <span className="bd-ckt">{ckDot(c.checks)}{c.ck ? c.ck.state === 'fail' ? `Failing · ${c.ck.failing.join(', ')}` : c.ck.state === 'run' ? `Running · ${c.ck.passed} of ${c.ck.total} passed` : c.ck.state === 'pass' ? `${c.ck.passed} of ${c.ck.total} passed` : 'None ran' : 'Not read yet'}</span>], ['Reviews', c.reviews && c.reviews.length ? c.reviews.slice(-2).map(v => `${v.who === B.me ? 'You' : PPL[v.who] ? PPL[v.who].n : 'Someone'} ${v.state === 'APPROVED' ? 'approved' : v.state === 'CHANGES_REQUESTED' ? 'asked for changes' : 'commented'}`).join(' · ') : c.asked && c.asked.length ? `Asked of ${c.asked.map(k => k === B.me ? 'you' : PPL[k] ? PPL[k].n : 'someone').join(', ')}` : 'None asked'], ['Size', plural(c.files, 'file', 'files')]] : []), ...(c.commits ? [['Commits', `${(c.commits || []).length} on ${br}`]] : []), ...(c.from ? [['From', c.from]] : []), ...(c.contract ? [['Contract', <button className="lnk3" data-bctr={c.contract}>{cname(c.contract)}{" "}{(ctrOf(c.contract) || [])[2]}</button>]] : c.to ? [['To', <span className="mono">{shortA(c.to)}</span>]] : []), ...(c.method ? [['Call', c.method]] : []), ...(c.hash ? [['Nonce', String(c.nonce)]] : []), ...(c.kind === 'setting' && !c.block ? [['Signatures', <><span className="bd-sig">{SIGK().map((k, __k) => <i key={__k} className={s[k] ? 'on' : c.need === k ? 'me' : ''}>{PPL[k].ini}</i>)}</span>{" "}{sigCount(c)}{" of "}{req}</>]] : []), [c.kind === 'code' ? 'Opened' : c.kind === 'upgrade' ? 'First commit' : 'Proposed', `${fmtD(c.opened)}${c.by && c.by !== 'anon' ? ' by ' + who(c.by) : ''}`], ...(c.st === 'shipped' && c.live ? [[c.kind === 'code' ? 'Merged' : c.released ? 'Live' : 'Executed', fmtD(c.live)]] : [])];
      const st = <span className="small quiet" style={css("margin-right:auto")}>{stateTxt(c)}</span>;
      const ft = c.st === 'safe' && !c.block ? n === 'sign' && SIGNER() && LIVE_APP ? <><button className="btn" data-bclose="">Not now</button><button className="btn p" data-bsign={c.id}>{c.outbox ? 'Sign and send to the Safe' : 'Sign in the Ops Safe'}</button></> : c.ready && sf ? <>{st}<button className="btn p" data-bgh={sf.link}>{"Execute in Safe{Wallet} ↗"}</button></> : !LV.wallet && LIVE_APP && sf ? <>{st}<button className="btn" data-blink="">Link the wallet you sign with</button></> : st : <>{st}{c.url ? <button className="btn" data-bgh={c.url}>Open on GitHub ↗</button> : ''}</>;
      return <>{phd(head, c.repo ? rtag(c.repo) : '')}<><div className="pn-b"><div><p className="bpn-t">{c.t}</p><p className={`bpn-s ${n ? 'me' : ''}`}>{stateTxt(c)}</p></div><div className="bd-tk">{T.map((t, i) => <span key={i} className={i < at ? 'done' : i === at ? c.block ? 'blk' : 'now' : ''}><i />{t}</span>)}</div>{c.note ? <p className="bpn-n">{c.note}</p> : ''}<div className="led">{rows.map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{n === 'sign' ? <p className="bpn-w">{c.outbox ? <><b>Your wallet signs it first.</b>{" Then it’s in the Safe’s queue for the others."}</> : <><b>{`Your signature makes it ${sigCount(c) + 1} of ${req}.`}</b>{sigCount(c) + 1 >= req ? ' Then anyone can execute it in Safe{Wallet}.' : ' Then it waits for the others.'}</>}</p> : ''}</div><div className="pn-ft">{ft}</div></></>;
    }

    /* ══ Side panels ═══════════════════════════════════════════════════════════════ */
    function ensurePanel() {
      let pn = document.getElementById('bpanel');
      if (!pn) {
        const sc = document.createElement('div');
        sc.id = 'bscrim';
        sc.className = 'scrim';
        document.body.appendChild(sc);
        pn = document.createElement('aside');
        pn.id = 'bpanel';
        pn.className = 'panel bpanel';
        document.body.appendChild(pn);
      }
      return pn;
    }
    function renderPanel() {
      const pn = ensurePanel(),
        P = B.panel;
      if (!P) {
        document.body.classList.remove('pn');
        return;
      }
      // live, a form for a new record; a record that's gone (after a reload) closes its panel
      if (LV && (P.inc && !INCIDENTS.some(i => i.id === P.inc) || P.find && !FINDINGS.some(f => f.id === P.find))) {
        B.panel = null;
        document.body.classList.remove('pn');
        return;
      }
      document.body.classList.add('pn');
      if (LV && P.form) return html(pn, formLive(P.form));
      html(pn, P.ch ? chPanel(CHG[P.ch]) : P.ctr ? ctrPanel(P.ctr) : P.find ? findPanel(FINDINGS.find(f => f.id === P.find)) : P.inc ? incPanel(INCIDENTS.find(i => i.id === P.inc)) : '');
    }
    const phd = (k, x = '') => <div className="pn-hd"><span className="lbl">{k}</span>{x}<button className="x" data-bclose="" aria-label="Close">{ICO.x}</button></div>;
    function track(c) {
      const T = c.kind === 'code' ? c.repo === 'proto' ? ['Draft', 'Review', 'Merged', 'Testnet'] : ['Draft', 'Review', 'Merged', 'Deployed'] : c.kind === 'upgrade' ? ['Pull request', 'Merged', 'Ops Safe', '24-hour wait', 'Live'] : ['Proposed', 'Ops Safe', '24-hour wait', 'Live'];
      const at = c.kind === 'code' ? {
        draft: 0,
        review: 1,
        shipped: 3
      }[c.st] : c.kind === 'upgrade' ? c.st === 'shipped' ? 4 : c.wait ? 3 : 2 : c.st === 'shipped' ? 3 : c.wait ? 2 : 1;
      return <div className="bd-tk">{T.map((t, i) => <span key={i} className={i < at ? 'done' : i === at ? c.block ? 'blk' : 'now' : ''}><i />{t}</span>)}</div>;
    }
    function chPanel(c) {
      if (LV) return chPanelLive(c);
      const n = need(c),
        f = c.finding && FINDINGS.find(x => x.id === c.finding),
        s = c.sigs || {},
        inc = c.incident && INCIDENTS.find(i => i.id === c.incident);
      const rows = [...(c.repo ? [['Repo', `${REPO[c.repo].org}/${REPO[c.repo].name} · #${c.num}`], ...(REPO[c.repo].path ? [['Touches', [c.repo, ...(c.also || [])].map(r => REPO[r].path + '/').join(' · ')]] : []), ...(c.after ? [['Merges after', <button className="lnk3" data-bopen={c.after}>{CHG[c.after].t}</button>]] : []), ['Checks', <span className="bd-ckt">{ckDot(c.checks)}{CK[c.checks][0]}{c.checks === 'fail' && c.id === 'c130' ? ' · fuzz: factory deploys' : ''}</span>], ['Size', <>{c.files}{" files · "}<span className="ad">+{int(c.plus)}</span>{" "}<span className="rm">−{int(c.minus)}</span></>]] : [['From', c.from]]), ...(c.contract ? [['Contract', <button className="lnk3" data-bctr={c.contract}>{ctrOf(c.contract)[1]}{" "}{ctrOf(c.contract)[2]}</button>]] : []), ...(c.kind !== 'code' ? [['Signatures', <><span className="bd-sig">{['kai', 'dana', 'bs'].map((k, __k) => <i key={__k} className={s[k] ? 'on' : c.need === k ? 'me' : ''}>{PPL[k].ini}</i>)}</span>{" "}{sigCount(c)}{" of 2"}</>]] : []), ...(c.sim ? [['Simulation', c.sim]] : []), ...(f ? [['Closes', <button className="lnk3" data-bfind={f.id}>{SEV[f.sev][0]}{" · "}{f.t}</button>]] : []), ...(inc ? [['Incident', <button className="lnk3" data-binc={inc.id}>{inc.t}</button>]] : []), ['Opened', `${fmtD(c.opened)} by ${who(c.by)}`]];
      const ft = n === 'sign' ? SIGNER() ? <><button className="btn" data-bclose="">Not now</button><button className="btn p" data-bsign={c.id}>Sign in the Ops Safe</button></> : '' : n === 'review' ? B.rej ? <><button className="btn" data-brejx="">Back</button><button className="btn dz" data-brej={c.id}>Send the comments</button></> : <><button className="btn" data-brejo="">Request changes</button><button className="btn p" data-bapprove={c.id}>Approve</button></> : c.repo ? <><span className="small quiet" style={css("margin-right:auto")}>{stateTxt(c)}</span><button className="btn" data-bgh="">Open on GitHub ↗</button></> : <span className="small quiet" style={css("margin-right:auto")}>{stateTxt(c)}</span>;
      return <>{phd(c.kind === 'upgrade' ? 'Contract upgrade' : c.kind === 'setting' ? 'On-chain setting' : 'Pull request', c.repo ? rtag(c.repo) : '')}<><div className="pn-b"><div><p className="bpn-t">{c.t}</p><p className={`bpn-s ${n ? 'me' : ''}`}>{stateTxt(c)}</p></div>{track(c)}{c.note ? <p className="bpn-n">{c.note}</p> : ''}<div className="led">{rows.map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{n === 'review' && B.rej ? <label>{lbl('What should change')}<textarea id="brej" className="vin" rows="3" placeholder={`Tell ${who(c.by).split(' ')[0]} what to fix`} /></label> : ''}{n === 'sign' ? <p className="bpn-w"><b>Your signature makes it 2 of 2.</b>{" Then a 24-hour wait before it goes live, so anyone can still pause it."}</p> : ''}</div><div className="pn-ft">{ft}</div></></>;
    }
    function ctrPanel(id) {
      const c = ctrOf(id),
        rel = RELEASES[id] || [],
        ins = REL.filter(r => r[1] === id),
        outs = REL.filter(r => r[0] === id),
        ch = CHANGES.filter(x => x.contract === id && x.st !== 'shipped'),
        f = FINDINGS.filter(x => x.contract === id && x.st !== 'fixed' && x.st !== 'accepted');
      return <>{phd(LAYERS[c[3]], <span className="fst" style={css("margin-left:8px")}>{c[4] === 'live' ? 'Live' : 'Not deployed'}</span>)}<><div className="pn-b"><div><p className="bpn-t">{c[1]}{" "}<span className="mono quiet" style={css("font-size:15px")}>{c[2]}</span></p><p className="bpn-s">{c[6]}</p></div><div className="led">{[['Address', <span className="mono">{c[5]}</span>], LV ? ['Changes signed in', LV.safe ? `Ops Safe · ${LV.threshold} of ${LV.safe.owners.length}` : 'No Ops Safe yet'] : ['Admin and pause', 'Ops Safe · 2 of 3'], ...ins.map(r => [RK[r[2]], `${ctrOf(r[0])[1]} ${r[3]}`]).slice(0, 3), ...outs.map(r => [RK[r[2]], `${r[3]} → ${ctrOf(r[1])[1]}`]).slice(0, 3)].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{rel.length ? <div>{lbl('Releases')}<div className="bd-pr">{rel.slice().reverse().map(([v, t], i) => <div key={i}><span className="mono">{v}</span><span>{fmtD(t)}</span><span>{i === 0 ? 'Live' : ''}</span></div>)}</div></div> : ''}{ch.length ? <div>{lbl('In flight')}{ch.map((x, __k) => <button key={__k} className="bd-pl" data-bopen={x.id}><b>{x.t}</b><span>{stateTxt(x)}</span></button>)}</div> : ''}{f.length ? <div>{lbl('Open findings')}{f.map((x, __k) => <button key={__k} className="bd-pl" data-bfind={x.id}><b><span className={`bd-sev ${x.sev}`}>{SEV[x.sev][0]}</span>{" "}{x.t}</b><span>{FSTATE[x.st][0]}</span></button>)}</div> : ''}</div><div className="pn-ft"><span className="small quiet" style={css("margin-right:auto")}>Changes start as a pull request</span>{LV ? LIVE_APP && ENG() && !RO() ? <button className="btn p" data-bpropose={id}>Propose a change</button> : '' : c[4] === 'live' && SIGNER() ? <button className="btn dz" data-bpause={id}>Propose a pause</button> : ''}</div></></>;
    }
    function findPanel(f) {
      if (LV) return findPanelLive(f);
      const fx = f.fix && CHG[f.fix],
        order = ['open', 'fixing', 'waiting', 'fixed'],
        at = order.indexOf(f.st);
      return <>{phd('Finding', <span className={`bd-sev ${f.sev}`} style={css("margin-left:8px")}>{SEV[f.sev][0]}</span>)}<><div className="pn-b"><div><p className="bpn-t">{f.t}</p><p className="bpn-s">{f.where}</p></div><div className="bd-tk">{['Found', 'Fix in progress', 'Fix waiting on a signature', 'Fixed'].map((t, i) => <span key={i} className={i < at ? 'done' : i === at ? 'now' : ''}><i />{t}</span>)}</div><p className="bpn-n">{f.note}</p><div className="led">{[['Found', `${fmtD(f.found)} · ${f.by}`], ...(f.contract ? [['Contract', <button className="lnk3" data-bctr={f.contract}>{ctrOf(f.contract)[1]}</button>]] : []), ...(fx ? [['Fix', <button className="lnk3" data-bopen={fx.id}>{fx.repo ? '#' + fx.num + ' · ' : ''}{fx.t}</button>], ['Where it is', stateTxt(fx)]] : []), ...(f.fixedAt ? [['Fixed', fmtD(f.fixedAt)]] : [])].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div><div className="pn-ft">{fx && need(fx) ? <button className="btn p" data-bopen={fx.id}>{need(fx) === 'sign' ? 'Sign the fix' : 'Review the fix'}</button> : <span className="small quiet" style={css("margin-right:auto")}>{FSTATE[f.st][0]}</span>}</div></></>;
    }
    function incPanel(i) {
      if (LV) return incPanelLive(i);
      const fx = i.fix && CHG[i.fix];
      return <>{phd('Incident', <span className={`fst ${i.st === 'open' ? 'warn2' : ''}`} style={css("margin-left:8px")}>{i.st === 'open' ? 'Open' : 'Closed'}</span>)}<><div className="pn-b"><div><p className="bpn-t">{i.t}</p><p className="bpn-s">{i.area}{" · "}{i.who === 'auto' ? 'handled automatically' : who(i.who) + (i.st === 'open' ? ' is on it' : '')}</p></div><p className="bpn-n">{i.note}</p><div>{lbl('What happened')}<div className="bd-tl">{i.ev.map(([t, s], __k) => <div key={__k}><span className="mono">{fmtD(t)}{" "}{hm(t)}</span><span>{s}</span></div>)}</div></div>{fx ? <div className="led"><div><span>Fix</span><b><button className="lnk3" data-bopen={fx.id}>#{fx.num}{" · "}{fx.t}</button></b></div><div><span>Where it is</span><b>{stateTxt(fx)}</b></div></div> : ''}</div><div className="pn-ft"><span className="small quiet" style={css("margin-right:auto")}>{i.st === 'open' ? 'Open ' + ago(i.at) : 'Resolved in ' + i.dur}</span>{i.st === 'open' && ENG() ? <button className="btn" data-bresolve={i.id}>Mark resolved</button> : ''}</div></></>;
    }

    /* ══ render and events ═════════════════════════════════════════════════════════ */
    function render() {
      document.querySelectorAll('.gtabs [data-btab]').forEach(b => b.setAttribute('aria-current', b.dataset.btab === B.tab ? 'page' : 'false'));
      if (!LIVE()) return;
      sync();
      W.classList.toggle('ro', RO() || !ENG());
      W.classList.toggle('tot', TOT());
      renderHdr();
      ({
        overview: renderOverview,
        changes: renderChanges,
        contracts: renderContracts,
        deploys: renderDeploys,
        security: renderSecurity
      })[B.tab]();
      renderPanel();
      if (TOT()) CC.scrub(W);
      setHash();
    }
    function sync() {
      const k = meKey();
      if (k !== B.me) {
        B.me = k;
        B.panel = null;
      }
      const r = CHG['u-rosa'];
      if (r && r.need && !S.waiting.some(w => w.id === 'chain')) {
        r.sigs.kai = NOW;
        r.wait = NOW + DAY;
        delete r.need;
      }
    }
    const logIt = (what, detail, res) => {
      if (LV) return;
      try {
        LOG.unshift(['x' + Date.now(), Date.UTC(2026, 9, 21, 14, 30), PPL[B.me].ini === 'K' ? 'K' : PPL[B.me].ini, 'chain', what, detail, 'Mac · Redlands', res, res === 'approved' ? 'Second signature' : '']);
      } catch (e) {}
    };
    const closeB = () => {
      B.panel = null;
      B.rej = false;
    };
    document.addEventListener('click', e => {
      if (e.target.id === 'bscrim') {
        closeB();
        return render();
      }
      const t = e.target.closest('button,a,[data-btab],[data-bctr]');
      if (!t) return;
      const d = t.dataset;
      if (d.btab) {
        B.tab = d.btab;
        closeB();
        render();
        window.scrollTo({
          top: 0
        });
        return;
      }
      if (d.brepo) {
        B.repo = d.brepo;
        B.cp = 0;
        if (B.tab !== 'changes') {
          B.tab = 'changes';
          window.scrollTo({
            top: 0
          });
        }
        closeB();
        return render();
      }
      if (d.bopen) {
        B.panel = {
          ch: d.bopen
        };
        B.rej = false;
        return render();
      }
      if (d.bctr) {
        B.panel = {
          ctr: d.bctr
        };
        return render();
      }
      // the map's contracts carry data-ctr, which the reference's shell meant to open here (its document
      // listener never sees them: the click is retargeted to the host), so the map opens the panel itself
      if (d.ctr) {
        B.panel = {
          ctr: d.ctr
        };
        return render();
      }
      if (d.bfind) {
        B.panel = {
          find: d.bfind
        };
        return render();
      }
      if (d.binc) {
        B.panel = {
          inc: d.binc
        };
        return render();
      }
      if (d.bclose !== undefined) {
        closeB();
        return render();
      }
      if (d.bst) {
        B.st = d.bst;
        return render();
      }
      if (d.bkmore) {
        B.more[d.bkmore] = d.less !== undefined ? CARDS : (B.more[d.bkmore] || CARDS) + 12;
        return render();
      }
      // clearing Shipped is yours alone: this browser remembers when, and what ships after still shows
      if (d.bkclear) {
        B.cleared = d.bkclear === 'clear' ? Date.now() : 0;
        B.more.shipped = CARDS;
        try {
          if (B.cleared) localStorage.setItem('cc-build-cleared', String(B.cleared));
          else localStorage.removeItem('cc-build-cleared');
        } catch {}
        return render();
      }
      if (d.bcp) {
        B.cp += +d.bcp;
        return render();
      }
      if (d.bdp) {
        B.dp += +d.bdp;
        return render();
      }
      if (d.brejo !== undefined) {
        B.rej = true;
        return render();
      }
      if (d.brejx !== undefined) {
        B.rej = false;
        return render();
      }
      // live: signing goes through your own wallet to the Ops Safe (live/safe.ts), then the section loads again
      if (LV && (d.bsign || d.blink !== undefined)) {
        if (!LIVE_APP) return toast('Nothing is signed in the preview');
        const c = d.bsign && CHG[d.bsign];
        t.disabled = true;
        import('../live/safe').then(m => c ? c.outbox ? m.signAndSend(c.outbox) : m.signQueued(c.hash) : m.linkWallet()).then(r => {
          toast(!c ? `Linked ${shortA(r)} · logged` : c.outbox ? 'In the Safe’s queue · 1 signature so far · logged' : `Signed · ${r.signatures} of ${r.required}${r.signatures >= r.required ? ' · ready to execute in Safe{Wallet}' : ''}`);
          closeB();
          return reloadSection('build').then(() => renderShell());
        }, e => {
          t.disabled = false;
          toast(e.message);
        });
        return;
      }
      // live: proposing a change to a contract is the old page's flow, into the Ops Safe (contracts/propose)
      if (LV && d.bpropose) {
        closeB();
        render();
        return openCFlow('propose', d.bpropose);
      }
      // live: GitHub, the Safe and Safe{Wallet} open in a new tab; nothing else here acts without an API
      if (LV && d.bgh !== undefined) {
        if (!d.bgh) return toast('GitHub isn’t connected yet');
        window.open(d.bgh, '_blank', 'noopener,noreferrer');
        return;
      }
      // live: Build's own records (incidents, findings, audits): a form, a page of a list, or a save
      if (LV && d.bnew) {
        B.panel = {
          form: d.bnew
        };
        return render();
      }
      if (LV && (d.bfp || d.bip)) {
        if (d.bfp) B.fp = (B.fp || 0) + +d.bfp;else B.ip = (B.ip || 0) + +d.bip;
        return render();
      }
      if (LV && (d.bsave || d.bincup || d.bassign || d.bresolve || d.bfst || d.bfix)) return saveLive(t, d);
      if (LV && (d.bapprove || d.brej || d.brejo !== undefined || d.bresolve || d.bpause)) return;
      if (d.bsign && d.bsign === 'u-rosa' && S.waiting.some(w => w.id === 'chain')) {
        closeB();
        render();
        return openItem('chain');
      }
      if (d.bsign) {
        const c = CHG[d.bsign];
        logIt(`Signed “${c.t}”`, 'Second of two signatures. Live after the 24-hour wait.', 'approved');
        c.sigs[B.me] = NOW;
        c.wait = NOW + DAY;
        delete c.need;
        FINDINGS.filter(f => f.fix === c.id).forEach(f => {
          f.st = 'fixing';
        });
        closeB();
        render();
        return toast(`Signed · ${c.t} goes live ${WD(c.wait)} ${hm(c.wait)} after the 24-hour wait · logged in Records`);
      }
      if (d.bapprove) {
        const c = CHG[d.bapprove];
        logIt(`Approved #${c.num} · ${c.t}`, `${RSHORT[c.repo]} · ${who(c.by)} can merge.`, 'done');
        delete c.rev;
        c.revState = 'ok';
        c.reviewer = B.me;
        closeB();
        render();
        return toast(`Approved · ${who(c.by).split(' ')[0]} can merge #${c.num}`);
      }
      if (d.brej) {
        const c = CHG[d.brej];
        delete c.rev;
        c.revState = 'changes';
        c.reviewer = B.me;
        closeB();
        render();
        return toast(`Changes requested on #${c.num}`);
      }
      if (d.bresolve) {
        const i = INCIDENTS.find(x => x.id === d.bresolve);
        i.st = 'closed';
        i.dur = ago(i.at).replace(' ago', '');
        i.ev.push([NOW, `Resolved by ${who(B.me)}`]);
        closeB();
        render();
        return toast('Marked resolved · logged in Records');
      }
      if (d.bpause) return toast(`Pause proposed for ${ctrOf(d.bpause)[1]} · needs a second signer in the Ops Safe`);
      if (d.bgh !== undefined) return toast('Opens GitHub in a new tab');
      if (d.bgo) return goOut(d.bgo);
    });
    document.addEventListener('keydown', e => {
      if (!LIVE()) return;
      if (e.key === 'Escape' && B.panel && !document.querySelector('.modal')) {
        closeB();
        render();
      }
    });
    const TABS = ['overview', 'changes', 'contracts', 'deploys', 'security'],
      OLD = {
        chain: 'contracts',
        agreements: 'overview'
      };
    return {
      render,
      tab: () => B.tab,
      setTab(t) {
        t = OLD[t] || t;
        if (TABS.includes(t)) B.tab = t;
        closeB();
      },
      close() {
        closeB();
      },
      open(k, id) {
        B.panel = {
          [k]: id
        };
      },
      /** Live, the open incident or finding, as `inc:I3`, to open again when the page is built again. */
      keep: () => LV && B.panel && (B.panel.inc || B.panel.find) ? B.panel.inc ? 'inc:' + B.panel.inc : 'find:' + B.panel.find : ''
    };
  })(DOCP);
  function mount() {
    // the slot is the shell's: the host goes inside it
    if (!into('bx-slot')) return;
    API.render();
  }
  function unmount() {
    if (host.isConnected) return;
    API.close();
    W.classList.remove('pn');
  }
  /** A tab, and after a comma the panel to open on it (`security,inc:I3`, as tab() gives it when the page is built again). */
  function setTab(p) {
    const c = String(p ?? '').indexOf(',');
    if (c < 0) return API.setTab(p);
    API.setTab(String(p).slice(0, c));
    const q = String(p).slice(c + 1),
      j = q.indexOf(':');
    if (j > 0) API.open(q.slice(0, j), q.slice(j + 1));
  }
  return {
    mount,
    unmount,
    setTab: (_r, sub) => setTab(sub),
    tab: () => API.tab() + (API.keep() ? ',' + API.keep() : ''),
    host
  };
}
registerPage(['build'], 'bx-slot', makeBuild, { live: true });
