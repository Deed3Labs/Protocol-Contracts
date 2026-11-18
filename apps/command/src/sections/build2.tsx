// @ts-nocheck: ported from the redesign's BUILD2 module (design/command-center-ui) with scripts/port/module.cjs; its data is its own.
import { Fragment } from 'react';
import { attrs, css, hasHtml, html } from '../runtime/dom';
import { LIVE as LIVE_APP, REAL } from '../live/env';
import { act } from '../live/actions';
import { reloadSection } from '../live/sections';
import { buildLive } from './buildLive';
import * as SGL from './signingLive';
import { CC } from './cc';
import { openCFlow } from './contracts';
import { LOG, S } from './data';
import { keep, registerPage, shadowHost } from './pageHost';
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
  return <div className="gw bw" id="bw"><div className="hdr stack" id="hdr" /><nav className="gtabs" aria-label="Build views"><button data-btab="overview">Overview</button><button data-btab="changes">Changes</button><button data-btab="contracts">Contracts</button><button data-btab="signing">Signing</button><button data-btab="deploys">Deploys</button><button data-btab="security">Security</button></nav><div id="bv" /></div>;
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
       Rosa's cap is in the 7-day wait. RevolvingIssuer v1.3 went live today. */
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
      t: 'Retire AssuranceOracle',
      by: 'dana',
      st: 'draft',
      checks: 'run',
      plus: 12,
      minus: 418,
      files: 6,
      opened: H(10, 19, 15),
      upd: H(10, 21, 11, 40),
      contract: 'ao',
      finding: 'F2',
      note: 'The new AssurancePool reads no price and has no target RTD, so the oracle and its slot0 read go. Its role grants are revoked in the same change.'
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
    }, /* each contract's Safe: two signers, then its 7-day timelock */
    {
      id: 'u-ap',
      repo: 'proto',
      num: 122,
      kind: 'upgrade',
      t: 'AssurancePool v2',
      by: 'dana',
      st: 'shipped',
      contract: 'ap',
      finding: 'F1',
      sigs: {
        dana: H(10, 20, 9),
        kai: H(10, 21, 9)
      },
      live: H(10, 21, 9),
      opened: H(10, 12, 10),
      merged: H(10, 18, 11),
      checks: 'pass',
      plus: 236,
      minus: 58,
      files: 7,
      note: 'A fresh deploy, not an upgrade: two compartments, Credit Backstop and Member Assurance, with no withdraw, sweep or rescue. Money leaves only by a released draw, a grant or a 14-day transfer. Its setup runs on day 7, when the Assurance timelock’s batch executes.',
      sim: 'Deployed in the Base Sepolia day-0 run · gate 0 FAIL'
    }, {
      id: 'u-rosa',
      kind: 'setting',
      t: 'Raise Rosa’s approval cap to $1,000.00',
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
        const STAGES = LV ? [['draft', 'In progress', 'Drafts, and commits not released'], ['review', 'In review', 'Open pull requests'], ['safe', 'Ops Safe', LV.safe ? `On-chain · ${LV.threshold} of ${LV.safe.owners.length} sign` : 'On-chain · no Ops Safe yet'], ['shipped', 'Shipped', 'Last 7 days']] : [['draft', 'In progress', 'Drafts and work in progress'], ['review', 'In review', 'Needs a review and passing checks'], ['safe', 'In a Safe', 'On-chain · two signers, then a 7-day timelock'], ['shipped', 'Shipped', 'Last 7 days']];

    /* recent commits */
    const COMMITS = LV ? LV.COMMITS : [[H(10, 21, 13, 50), 'cc', 'kai', 'Build: change board and review panel', '3f9a1c2'], [H(10, 21, 12, 5), 'app', 'dana', 'Test: look for the Repay amount, not the word', 'e91b04d'], [H(10, 21, 11, 40), 'proto', 'dana', 'Retire AssuranceOracle and revoke its roles', 'b7c5a10'], [H(10, 21, 10, 30), 'sdk', 'dana', 'SDK: regenerate AssurancePool v1.3 types', 'd81c4f0'], [H(10, 21, 9, 20), 'app', 'kai', 'Term plans: split schedule preview', '4d2f8e6'], [H(10, 21, 9, 15), 'app', 'dana', 'Test: repro for the failing e2e', 'a03c771'], [H(10, 20, 21, 0), 'cc', 'kai', 'Field: route planner and the week strip', '71e0b5c'], [H(10, 20, 18, 40), 'app', 'kai', 'Move money: Repay $400.00 on the button', '7c2e9d1'], [H(10, 20, 16, 0), 'proto', 'dana', 'BurnerBond: ReentrancyGuard from utils', 'c4a8d02'], [H(10, 20, 11, 0), 'merchant', 'kai', 'Refunds: partial amount from the receipt', '52ff1e9'], [H(10, 19, 16, 20), 'merchant', 'kai', 'Counter: scan directions under the code', '08b6c3a'], [H(10, 19, 15, 0), 'proto', 'dana', 'RevolvingIssuer: repay most expensive tier first', '9c41e2a'], [H(10, 19, 10, 0), 'site', 'kai', 'Shops: enquiry form posts to the Command Center', 'e5d3a77'], [H(10, 18, 14, 0), 'proto', 'dana', 'Pin OpenZeppelin 5.0.2', '16af0b8'], [H(10, 18, 11, 0), 'proto', 'dana', 'AssurancePool: claims only through a role', 'fa31c9d'], [H(10, 17, 10, 10), 'site', 'kai', 'Home: cut the copy by half', '2b8e4f1'], [H(10, 17, 9, 0), 'cc', 'kai', 'Merchants: pipeline board', '6a90d3e']];

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
        test: ['Base Sepolia', 'Audited stack · day 0 done 17 Nov · day 7 on 24 Nov', 'ok'],
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
    const DEPLOYS = LV ? LV.DEPLOYS : [[H(10, 21, 10, 0), 'proto', 'test', 'RevolvingIssuer v1.3', 'Credit timelock', 'ok', 'Upgrade · two signers, then 7 days'], [H(10, 21, 9, 12), 'cc', 'test', '3f9a1c2', 'kai', 'ok', '1m 48s'], [H(10, 20, 18, 40), 'app', 'test', '#129 · 7c2e9d1', 'kai', 'warn', '2m 31s · e2e failing since'], [H(10, 19, 16, 20), 'merchant', 'test', '#127 · 08b6c3a', 'kai', 'ok', '1m 55s'], [H(10, 17, 10, 10), 'site', 'prod', '#40 · 2b8e4f1', 'kai', 'ok', '41s'], [H(10, 14, 16, 0), 'proto', 'test', 'LendingPool, BondVault, BondValuer v1.0', 'Earn timelock', 'ok', '3 contracts · Clear Lending Safe, then 7 days'], [H(10, 14, 11, 5), 'app', 'test', '#125 · 1f7d9a0', 'dana', 'back', 'Rolled back after 12 min · missing env var'], [H(10, 14, 11, 20), 'app', 'test', '#124 · 6b0e2c4', 'dana', 'ok', 'Restored'], [H(10, 8, 15, 0), 'proto', 'test', 'TermIssuer, Liquidator, SavingsIntent v1.0', 'Ops Safe', 'ok', '3 contracts'], [H(10, 6, 10, 0), 'proto', 'test', 'PayoutPool v0.9', 'Ops Safe', 'ok', 'Upgrade · oldest claim first']];

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
      st: 'fixed',
      fixedAt: D(10, 21),
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
      st: 'fixed',
      fixedAt: D(10, 20),
      note: 'slot0 is the spot price, so a flash loan could push it and pull it back inside one transaction. Closed by retiring the oracle: the new AssurancePool has no target RTD and reads no price.'
    }, {
      id: 'F3',
      sev: 'medium',
      t: 'Pool exposure counts asset-backed credit in full',
      contract: 'cr',
      where: 'CollateralRegistry · poolExposure()',
      found: D(10, 10),
      by: 'Internal review',
      st: 'open',
      note: 'The AssurancePool’s floor reads this figure as the covered book. Asset-backed debt should count only its shortfall after a haircut. Nothing is affected yet: no asset-backed credit has been issued.'
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
      t: 'Backstop draws refused until the floor was posted',
      st: 'closed',
      sev: 'medium',
      at: H(10, 6, 8),
      area: 'AssurancePool',
      who: 'auto',
      dur: '7 days',
      note: 'The month’s floor inputs weren’t posted, so the coverage cap stayed at zero and the pool refused every backstop draw. Two Assurance signers posted them on 13 Oct.',
      ev: [[H(10, 6, 8), 'Draw refused · coverage cap is zero'], [H(10, 13, 9), 'Floor inputs posted with setFloorInputs · draws reopen']]
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
    /* the API's jobs that move money or read for it: docs/operators/payout-topups.md, assurance-fee-payer.md, DEPLOY-RUNBOOK 4.3 */
    const AUTO = LV ? LV.AUTO : [{
      t: 'Payout top-ups',
      d: 'Decision 51 · CL Operating to the PayoutPool when 14 days is short',
      w: 'payout-topup',
      a: '0xC0C4…5068',
      lim: ['$5,000 a week', 'Set on chain 17 Nov · $0 spent'],
      run: ['Not on yet', 'Turns on after day 7 · 24 Nov'],
      st: 'wait',
      off: ['PAYOUT_TOPUP_ENABLED', 'Or CL Operating removes the delegate']
    }, {
      t: 'Assurance fee payer',
      d: 'Clear Lending’s monthly fee and recoveries into the Credit Backstop',
      w: 'cl-fees',
      a: '0xB9ed…cDFd',
      lim: ['Only what CL Operating sent it', 'Fee and recovery tags · exactly the recorded amount'],
      run: ['Not on yet', 'Needs the new pool’s address · 24 Nov'],
      st: 'wait',
      off: ['ASSURANCE_FEE_PAYER_ENABLED', 'Or the pool drops it as a payer']
    }, {
      t: 'Payout funding keeper',
      d: 'Checks the deadline rule and the 30-day standing balance',
      w: 'No wallet',
      a: 'read-only',
      lim: ['Moves nothing', 'Emails ops once a day when Amber or Red'],
      run: ['Not on yet', 'On with the app address update'],
      st: 'wait',
      off: ['Nothing to switch off', 'It only reads']
    }];
    const KEYS = LV ? LV.KEYS : [/* from deploy/config/base-sepolia.rollout.env */
    ['Clear Treasury Safe', 'Two signers · Clear and Clear Financial', 'On testnet it plays the Ops Safe, the board Safe and the Clear Financial Safe: credit, Assurance and vault timelocks'], ['Clear Lending Safe', '2 of 2', 'Proposes on the Earn timelock: EarnControls, the Yield Pool and BondVault'], ['CL Operating · CL Loss Reserve', '1 of 1 each, owned by the Clear Lending Safe', 'Yield Pool Deployments and released backstop draws land here'], ['Foundation Safe', 'Deed timelock', 'Deed contracts and the functional contract registry'], ['CDP wallets', 'Card settler · CL Fees · Assurance Disbursement · Payout top-up', 'API-held keys that each do one routine payment job, inside a limit set on chain'], ['Deployer key', 'Testnet only · MetaMask', 'Hands every admin role to a timelock, then renounces it'], ['Provider keys', 'Lithic, Bridge and Plaid sandboxes · in Railway', 'Rotated 30 Sep'], ['GitHub', '3 repos · 2 maintainers · Kai, Dana Ruiz', 'dev and main need a review · CODEOWNERS per folder'], ['Keys in this app', 'None', 'MetaMask and each Safe sign; Command Center never holds a key']];

    /* signers and the Ops Safe */
    const SIGN_W = LV ? LV.SIGN_W : {
      K: [2, 3, 1, 1, 2, 2, 1, 3],
      DR: [3, 4, 2, 1, 1, 2, 1, 3],
      BS: [0, 1, 0, 1, 0, 0, 0, 0]
    };
    const SIGNERS = LV ? LV.SIGNERS : [['kai', 'K', 'Kai', 'Admin', 3.1], ['dana', 'DR', 'Dana Ruiz', 'ClearLabs', 5.4], ['bs', 'BS', 'Board signer', 'Co-op board', 31.0]];
    const CTR = LV ? LV.CTR : [/* id, name, version, layer, status, address, what it does, x, y, band (p controls · c credit · d deeds · x off the map), who holds its roles — from Protocol-Contracts, audit/phase-2f-integration; addresses from deployments/base-sepolia */
    ['am', 'AccessManager', 'v1.0', 0, 'live', '0x23aF…8DBe', 'Role-based access for the protocol. Admin is the Ops Safe.', 10, 14, 'p', 'OPS'], ['rs', 'RateSchedule', 'v1.0', 1, 'live', '0xdb73…8b97', 'What each credit product may charge, by state: the price Clear lists and the legal cap. RevolvingIssuer and TermIssuer read it before they charge. Changes wait on a timelock.', 30, 14, 'p', 'CL'], ['pc', 'PauseClock', 'v1.0', 2, 'live', '0x794A…9959', 'Counts the seconds a pause on a member’s CLRUSD or ESA was in force, so grace and cure periods run longer by that much and a pause never causes a default.', 50, 14, 'p', 'R'], ['nr', 'NetworkRegistry', 'v1.0', 3, 'live', '0xee10…1164', 'The parent registry every issuer is registered against, and the list of money paths the AssurancePool may pay. Its old AssuranceOracle field is retired.', 70, 14, 'p', 'OPS'], ['ec', 'EarnControls', 'v1.0', 4, 'live', '0xe4a7…cD97', 'The one governed contract both Earn products share: eligibility attestations and exemption tags, the Funding Limit and offering cap, the Ladder, the Equity Cushion and Reserve Shortfall pauses, and the Successor path.', 90, 14, 'p', 'CL'], ['ms', 'MembershipRegistry', 'v1.0', 0, 'live', '0xE700…4dE8', 'Member entitlements on-chain, no personal data. CLRUSD moves only between members; de-listing stops receiving only, with a reason code.', 10, 27, 'c', 'CO'], ['cr', 'CollateralRegistry', 'v1.0', 0, 'live', '0xfeDb…446A', 'What each member has pledged and what is locked. Reads bond values and the pool-share side of the pledge module; ClearUSD reads its locks.', 10, 33.5, 'c', 'CL'], ['tr', 'TokenRegistry', 'v1.0', 0, 'live', '0x4B13…8a86', 'Which tokens count, with fallback prices.', 10, 40, 'c', 'OPS'], ['lcm', 'LegacyContactModule', '—', 0, 'later', '—', 'Optional recovery module a member installs on their own smart account. After a wait the member can cancel, a chosen contact can rotate the owner key, and nothing else. No Clear role.', 10, 46.5, 'c', 'M'], ['mr', 'MerchantRegistry', 'v1.0', 0, 'live', '0x8f4C…3c1b', 'What each shop was promised: payout schedule, cap, fee, status.', 10, 53, 'c', 'CF'], ['ri', 'RevolvingIssuer', 'v1.3', 1, 'live', '0xBec5…E2F0', 'The tiered revolving line: savings-backed, asset-backed, income and Boost. Calendar cycles, cure notices, Assurance and workouts run in its modules (Cycles, Terms, Workouts, Extension).', 30, 27, 'c', 'CL'], ['lc', 'LimitCalculator', 'v1.0', 1, 'live', '0x6C08…4a20', 'Turns pledges and attestations into a member’s ceiling.', 30, 33.5, 'c', 'CL'], ['oi', 'OffersIssuer', 'v1.0', 1, 'live', 'New · 17 Nov', 'The co-op’s $10 to each new member, on a capped line of its own. The Safe pays it down. Redeployed on 17 Nov; the old one is retired.', 30, 40, 'c', 'CO'], ['ti', 'TermIssuer', 'v1.0', 1, 'live', '0x1b16…da57', 'Term plans: partner credit and Clear Cash. Origination prices each plan on-chain and pays the merchant fee leg to Clear Lending.', 30, 46.5, 'c', 'CL'], ['bvl', 'BondValuer', 'v1.0', 1, 'live', '0x7f63…02C8', 'What a member’s pledged bonds are worth today, for CollateralRegistry.', 30, 59.5, 'c', 'R'], ['lq', 'Liquidator', 'v1.0', 3, 'live', '0x6217…33f3', 'Enforces a member’s pledges after an objective default: Savings, pledged bonds and pledged Pool Shares. Never touches Ready to allocate USDC. Pauses lengthen its clock.', 70, 53, 'c', 'R'], ['cc', 'ClearCredit', 'v1.1', 2, 'live', '0x5923…82Bc', 'The co-op’s credit ledger, the deployable StableCredit. Only issuers mint. A shop’s positive balance here is what the co-op owes it.', 50, 40, 'c', 'CL'], ['ccp', 'CLRUSDTokenPool', 'v1.0', 2, 'live', '0xd8a1…CCc1', 'The CCIP pool that bridges CLRUSD between chains.', 50, 53, 'c', 'CF'], ['cu', 'ClearUSD', 'v1.1', 2, 'live', '0x2a11…D6D1', 'CLRUSD, upgradeable. Moves only between members; pledged balances stay locked. Bridges by CCIP.', 50, 66, 'c', 'CF'], ['ap', 'AssurancePool', 'v2.0', 3, 'live', '0x3c33…BB15', 'The co-op’s Assurance contract, owned by Clear Collective: a Credit Backstop compartment and a Member Assurance compartment (Hardship Grants), each paid out by two people after a timelock. Never funds merchant payouts.', 70, 27, 'c', 'CO'], ['cp', 'CreditPool', '—', 3, 'later', '—', 'In the repo, not deployed. Members deposit credit for others to draw.', 70, 33.5, 'c', ''], ['ce', 'ClaimEscrow', 'v1.0', 3, 'live', '0x24DA…c37D', 'Holds USDC sent by link until it’s claimed or refunded.', 70, 40, 'c', 'CF'], ['pp', 'PayoutPool', 'v0.9', 3, 'live', '0xb470…F861', 'Pays shops what the co-op owes them, on the schedule they were promised, oldest claim first. The AssurancePool never funds it.', 70, 46.5, 'c', 'CF'], ['esa', 'ESADepositVault', 'v1.1', 3, 'live', '0x8364…413b', 'Member savings: CLRUSD backed 1:1 by USDC, held for holders in the ESA Reserve Trust. Counts California mints for the pilot cap; two people can pause new CA mints.', 70, 66, 'c', 'CF'], ['si', 'SavingsIntent', 'v1.0', 3, 'live', '0xF807…B74B', 'One-transfer escrows that turn a deposit into savings.', 70, 72.5, 'c', 'CF'], ['lp', 'LendingPool', 'v1.0', 4, 'live', '0x5840…ce23', 'The Earn Yield Pool (ERC-4626). Pool Shares are limited-recourse demand notes: Share Value is principal plus interest less realized losses, with a Loss Holdback on redemptions. Deploys only to Clear Lending’s lending account. Holds $9,000.00 from 18 depositors.', 90, 27, 'c', 'CL'], ['pse', 'PoolShareEnforcer', 'v1.0', 4, 'live', '0xEB6f…4fa1', 'The pledge module’s pool-share side: tells CollateralRegistry when pledged Pool Shares may be enforced, and queues their redemption for the Liquidator.', 90, 40, 'c', 'R'], ['bb', 'BurnerBond', 'v1.0', 4, 'live', '0xe7F6…cC2A', 'Zero-coupon bonds, one token each. A bond rolls only on its holder’s confirmation; a pledged bond pays its debt at no less than present value. 6 issued.', 90, 46.5, 'c', 'CL'], ['bv', 'BondVault', 'v1.0', 4, 'live', '0x9f31…A855', 'Where bond proceeds live, behind a redemption reserve. Deployable excess goes only to Clear Lending’s treasury. Holds $25,000.00 for 6 bonds.', 90, 53, 'c', 'CL'], ['ca', 'CollateralAgent', 'v1.0', 4, 'live', '0x4884…2825', 'The Agent Role in the BondVault exactly as IV-10 Exhibit A states it: enforcement notices and distributions for bondholders, nothing else.', 90, 59.5, 'c', 'AG'], ['hd', 'HolderDirections', 'v1.0', 4, 'live', '0x8ec3…5Cda', 'Directions bondholders sign themselves, counted on-chain by Accreted Value, that instruct the Collateral Agent.', 90, 66, 'c', 'H'], ['ao', 'AssuranceOracle', 'v1.0', 3, 'live', '0x2E52…Fe38', 'Retired. Section 13 removed it from the money path; nothing reads it now.', 0, 0, 'x', ''], ['vr', 'ValidatorRegistry', 'v1.0', 0, 'live', '0x979E…bc91', 'Which validators may approve deeds, and for what.', 10, 85, 'd', 'OPS'], ['fcr', 'FunctionalContractRegistry', '—', 0, 'later', '—', 'The functional contracts a trust deed may be deposited into under any transfer policy (trust agreement v5).', 10, 93, 'd', 'OPS'], ['va', 'Validator', 'v1.0', 1, 'live', '0x18C5…79b9', 'Checks a deed’s title and papers before it’s minted. Made by the ValidatorFactory.', 30, 85, 'd', 'OPS'], ['mx', 'MetadataRenderer', 'v1.0', 1, 'live', '0x849e…70E5', 'Renders a deed’s features, condition and legal details.', 30, 93, 'd', 'OPS'], ['dn', 'DeedNFT', 'v1.1', 2, 'live', '0x1a4e…21E6', 'One token per property deed, with its traits, validation and trust agreement terms.', 50, 85, 'd', 'OPS'], ['sd', 'Subdivide', 'v1.0', 2, 'live', '0x3c94…923F', 'Splits a deed into units, like lots or rooms.', 50, 93, 'd', 'OPS'], ['fz', 'Fractionalize', 'v1.0', 3, 'live', '0xeC46…9823', 'Locks a deed or its units and issues shares against it.', 70, 85, 'd', 'OPS'], ['cta', 'CoopTransferAgent', '—', 3, 'later', '—', 'The only route by which a Coop-policy trust deed changes hands, including Clear’s right of first refusal (trust agreement v5).', 70, 93, 'd', 'R'], ['ft', 'FractionToken', 'v1.0', 4, 'live', '0x3E51…28dc', 'Shares in one property, made by the FractionTokenFactory.', 90, 85, 'd', ''], ['fm', 'FundManager', 'v1.0', 4, 'live', '0x73ea…401e', 'Money around deeds: commissions and payouts.', 90, 93, 'd', 'OPS']];
    /* who can change each contract: five 7-day timelocks, each run by its owner's Safe (deploy/*_timelock_handover.ts) */
    const CTR_AUX = LV ? LV.CTR_AUX : [/* deployed, not on the map: name, address, what it does, who runs it — deployments/base-sepolia on claude/new-session-e5u3cp */
    ['CreditTimelock', '0x3941…d330', 'Holds the credit contracts’ upgrades and settings for 7 days', 'Clear Treasury Safe, as the Ops Safe'], ['AssuranceTimelock', '0xE77F…7C6b', 'Holds AssurancePool changes for 7 days, after two Assurance signers approve', 'Clear Treasury Safe, as the board Safe'], ['VaultTimelock', '0xb49c…1994', 'Holds the savings vault and CLRUSD changes for 7 days', 'Clear Treasury Safe, as the Clear Financial Safe'], ['EarnTimelock', '0xB378…7911', 'Holds EarnControls, the Yield Pool, BondVault and the bond contracts for 7 days', 'Clear Lending Safe'], ['BurnerBondFactory', '0xf36d…a96a', 'Opens a bond collection for each approved token', 'Through the Earn timelock'], ['BurnerBondDeposit', '0xA030…dB8c', 'Takes the money behind each bond and holds the proceeds', 'Through the Earn timelock'], ['Create2Deployer', '0x2BFb…cB06', 'Deploys contracts to addresses known in advance', 'No one: a helper']];
    const CTR_OLD = LV ? LV.CTR_OLD : [/* retired, kept on record */
    ['OffersIssuer (old)', '0x150E…841c', 'Replaced by the 17 Nov deploy'], ['AssurancePool v1', '0xf5E4…5840', 'Replaced by AssurancePool v2'], ['ClearUSD v1', '0x5619…0Ae3', 'Replaced by the upgradeable ClearUSD'], ['AssuranceOracle', '0x2E52…Fe38', 'Off the money path since section 13']];
    const CTR_OLD_N = LV ? LV.CTR_OLD_N : 22; /* pre-audit, pre-2f, pre-2d and legacy copies in deployments/base-sepolia */
    const TLK = {
      deed: 'Deed timelock · Foundation Safe, 7 days',
      credit: 'Credit timelock · Ops Safe, 7 days',
      assur: 'Assurance timelock · board Safe, after two Assurance signers approve, 7 days',
      vault: 'Vault timelock · Clear Financial Safe, 7 days',
      earn: 'Earn timelock · Clear Lending Safe, 7 days',
      agent: 'Earn timelock · Clear Lending Safe and the Collateral Agent’s co-signature, 7 days',
      none: 'Nothing: no owner, no role and no upgrade',
      swap: 'Nothing: no admin; a new one is deployed and pointed to through the Earn timelock',
      member: 'The member’s own account: it installs and removes it',
      fadmin: 'Its own admin, named at deploy',
      gone: 'Retired: replaced by the new AssurancePool'
    };
    const TL_OF = {
      vr: 'deed',
      fcr: 'deed',
      va: 'deed',
      mx: 'deed',
      dn: 'deed',
      sd: 'deed',
      fz: 'deed',
      cta: 'deed',
      ft: 'deed',
      fm: 'deed',
      esa: 'vault',
      cu: 'vault',
      ccp: 'vault',
      ap: 'assur',
      lp: 'earn',
      ec: 'earn',
      pse: 'none',
      pc: 'none',
      bvl: 'swap',
      lcm: 'member',
      si: 'fadmin',
      bb: 'agent',
      bv: 'agent',
      ca: 'earn',
      hd: 'none',
      ao: 'gone'
    };
    const TLTXT = id => TLK[TL_OF[id] || 'credit'];
    const SAFE_OF = id => ({
      deed: 'Foundation Safe',
      assur: 'Board Safe',
      vault: 'Clear Financial Safe',
      earn: 'Clear Lending Safe',
      agent: 'Clear Lending Safe'
    })[TL_OF[id]] || 'Ops Safe';
    const CTRL = {
      OPS: 'Ops Safe · two signers',
      CF: 'Clear Financial · two people',
      CL: 'Clear Lending · two people',
      CO: 'Clear Collective · two people',
      AG: 'Collateral Agent',
      M: 'The member alone',
      H: 'Bondholders, by signed direction',
      R: 'No one: rules only'
    };
    const ctrOf = id => CTR.find(c => c[0] === id);
    /* a contract's name; a change the map doesn't place (live: a Safe transaction to another address) says so */
    const cname = id => (ctrOf(id) || [, 'Another contract'])[1];
    const MAP_N = CTR.filter(c => c[9] !== 'x').length,
      MAP_LIVE = CTR.filter(c => c[9] !== 'x' && c[4] === 'live').length;
    const MAP_INFO = ['bb', 'lp', 'bv', 'rs', 'pc', 'ec', 'pse', 'ca', 'hd', 'lcm', 'cta', 'fcr'];
    const LAYERS = ['Access', 'Issuance', 'Tokens', 'Pools, escrow and enforcement', 'Earn'];
    const REL = LV ? LV.REL : [/* from, to, kind (reads · money · mint), verb, label on the map (blank = drawn, unlabelled · null = panel only), label x for long lines — traced from each contract's stored addresses */
    ['ms', 'am', 'reads', 'checks members', ''], ['am', 'cc', 'reads', 'sets roles', null], ['rs', 'ri', 'reads', 'prices and legal caps', ''], ['rs', 'ti', 'reads', 'prices and legal caps', null], ['pc', 'lq', 'reads', 'lengthens grace and cure by paused time', null], ['pc', 'ri', 'reads', 'lengthens grace by paused time', ''], ['pc', 'ti', 'reads', 'lengthens cure by paused time', null], ['cu', 'pc', 'reads', 'pauses', null], ['esa', 'pc', 'reads', 'pauses', null], ['nr', 'ap', 'reads', 'lists the money paths it may pay', ''], ['nr', 'cr', 'reads', 'lists issuers', null], ['nr', 'cc', 'reads', 'registers issuers', null], ['ec', 'lp', 'reads', 'eligibility, limits and pauses', ''], ['ec', 'bb', 'reads', 'eligibility, Ladder and pauses', null], ['ec', 'bv', 'reads', 'Reserve Shortfall and Equity Cushion', null], ['ms', 'ec', 'reads', 'who is a member', null], ['cr', 'lc', 'reads', 'pledges', 'pledges'], ['bvl', 'cr', 'reads', 'values bonds', ''], ['lc', 'ri', 'reads', 'limits', ''], ['ri', 'ti', 'reads', 'share the Combined Ceiling', null], ['ri', 'cc', 'mint', 'mints credit', 'mints'], ['oi', 'cc', 'mint', 'mints the $10 offer', ''], ['ti', 'cc', 'mint', 'mints credit, with the fee leg to Clear Lending', ''], ['cc', 'pp', 'money', 'pays what the co-op owes shops', ''], ['mr', 'pp', 'reads', 'payout terms', 'terms'], ['cc', 'cp', 'reads', 'credit deposits', ''], ['esa', 'cu', 'mint', 'mints against USDC', 'mints'], ['si', 'esa', 'money', 'deposits', ''], ['cu', 'ccp', 'money', 'bridges by CCIP', ''], ['cr', 'cu', 'reads', 'locks pledged CLRUSD', null], ['ms', 'cu', 'reads', 'members-only transfers', null], ['lq', 'cu', 'money', 'enforces pledged CLRUSD', ''], ['lq', 'esa', 'reads', 'redeems', null], ['lq', 'cc', 'reads', 'repays the member’s debt', null], ['lq', 'bb', 'money', 'pays pledged bonds at present value', ''], ['lq', 'pse', 'money', 'queues pledged Pool Shares', ''], ['pse', 'lp', 'money', 'queued redemption', ''], ['pse', 'cr', 'reads', 'enforcement allowed', null], ['bb', 'bv', 'money', 'bond proceeds', ''], ['bvl', 'bb', 'reads', 'present value', null], ['ca', 'bv', 'reads', 'enforces for bondholders', ''], ['hd', 'ca', 'reads', 'holder directions', ''], ['vr', 'va', 'reads', 'lists validators', 'lists'], ['va', 'dn', 'reads', 'validates', 'checks'], ['mx', 'dn', 'reads', 'renders', ''], ['dn', 'sd', 'mint', 'splits into units', ''], ['dn', 'fz', 'money', 'locks deeds', 'locks'], ['sd', 'fz', 'money', 'locks units', ''], ['fz', 'ft', 'mint', 'issues shares', 'issues'], ['fm', 'dn', 'reads', 'commissions', null], ['cta', 'dn', 'money', 'moves Coop-policy deeds', 'transfers'], ['fcr', 'dn', 'reads', 'functional contracts', null]];
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
        HN = 0.6; /* node half-width and half-height, in % */
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
          return <path data-e={i} d={`M${A[7] * 10},${A[8] + (dn ? HN : -HN)} L${B[7] * 10},${B[8] + (dn ? -HN : HN)}`} className={`bm-e ${k}`} />;
        }
        const g = geo(e, i),
          mx = (g.x1 + g.x2) / 2 * 10;
        return <path data-e={i} d={`M${g.x1 * 10},${g.y1} C${mx},${g.y1} ${mx},${g.y2} ${g.x2 * 10},${g.y2}`} className={`bm-e ${k}`} />;
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
        return <span className={`bm-el ${k}`} data-e={i} style={css(`left:${x}%;top:${y}%`)}>{l}</span>;
      };
      const pend = mapPend();
      return <><div className="bm" role="img" aria-label="How the contracts connect"><div className="bm-safe">{LV ? mapSafeLive() : <><b>Five 7-day timelocks</b><span>Deed · Credit · Assurance · Vault · Earn — every upgrade and setting waits 7 days, proposed by its owner’s Safe</span></>}</div><div className="bm-in">{LAYERS.map((l, i) => <Fragment key={i}><span className="bm-lay" style={css(`left:${10 + i * 20}%`)}>{l}</span><i className="bm-drop" style={css(`left:${10 + i * 20}%`)} /></Fragment>)}<i className="bm-sep" style={css("top:7.5%")} /><span className="bm-band" style={css("top:7.5%")}>Controls and rules</span><i className="bm-sep" style={css("top:20.5%")} /><span className="bm-band" style={css("top:20.5%")}>Credit and money</span><i className="bm-sep" style={css("top:79%")} /><span className="bm-band" style={css("top:79%")}>Deeds and real assets</span><svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">{EDGES.map(path)}</svg>{EDGES.map(lbl)}{(LV ? LV.MAPPED : CTR).filter(c => c[9] !== 'x').map((c, __k) => <button key={__k} type="button" className={`bm-n ${c[4]}${c[9] === 'p' ? ' bm-ctl' : ''}${LV ? nodeLive(c, pend) : `${pend[c[0]] && !MAP_INFO.includes(c[0]) ? ' pend' : ''}${pend[c[0]] && /on you|^Sign/.test(pend[c[0]]) ? ' me' : ''}${MAP_INFO.includes(c[0]) ? ' info' : ''}`}`} data-ctr={c[0]} style={css(`left:${c[7]}%;top:${c[8]}%`)}><b className="bm-nm" title={c[1]}>{c[1]}</b><span className="bm-f">{c[10] ? <i className={`bm-o o-${c[10]}`} title={CTRL[c[10]]}>{c[10] === 'R' ? 'RULES' : c[10]}</i> : ''}{pend[c[0]] ? <span className="bm-t">{pend[c[0]]}</span> : ''}{c[2] !== '—' ? <span className="mono bm-v">{c[2]}</span> : ''}</span></button>)}</div></div><div className="bm-list">{[['p', 'Controls and rules'], ['c', 'Credit and money'], ['d', 'Deeds and real assets']].map(([b, bn], __k) => <Fragment key={__k}><div className="bm-lb">{bn}</div>{LAYERS.map((l, i) => {
              const cs = CTR.filter(c => c[3] === i && c[9] === b);
              return cs.length ? <div key={i} className="bm-pc"><span className="lbl">{l}</span>{cs.map((c, __k) => <button key={__k} type="button" className="bm-pr" data-ctr={c[0]}>{(() => {
                    const pv = pend[c[0]] || '',
                      k = /on you|^Sign/.test(pv) ? 'me' : /in the wait|waits/i.test(pv) ? 'wt' : '';
                    return <><i className={`${c[4]} ${k}`} /><span>{c[1]}{pv ? <em className={k}>{pv}</em> : ''}</span></>;
                  })()}<span className="mono quiet">{c[2]}</span></button>)}</div> : '';
            })}</Fragment>)}</div></>;
    }
    /* ══ Flow on the protocol map ═════════════════════════════════════════════════
       Lines flow quietly in the direction things actually move.
       Dashes: money lines march, mint lines carry a steady stream of land-green dots, reads stay still.
       Dots: every line carries a stream of small dots; money ink, mint land green, reads faint.
       Pointing at a contract brings its lines forward and steps the rest back. */
    let FLOW = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : 'flow',
      FLOW_ST = 'dots',
      FLOW_RAF = 0,
      FLOW_RO = null,
      FLOW_IO = null;
    /* drawn one way, money moves the other: the Liquidator pulls pledged CLRUSD, bond value and Pool Shares toward the debt */
    const FLOW_REV = {
      'lq>cu': 1,
      'lq>bb': 1,
      'lq>pse': 1,
      'pse>lp': 1
    };
    const FLOW_NS = 'http://www.w3.org/2000/svg';
    /* per style and kind: [gap between dots px, speed px/s, radius] — null means no dots */
    const FLOW_DOT = {
      dash: {
        money: null,
        mint: [32, 26, 3],
        reads: null
      },
      dots: {
        money: [26, 30, 2.2],
        mint: [32, 26, 3],
        reads: [40, 18, 1.6]
      }
    };
    function flowMount() {
      cancelAnimationFrame(FLOW_RAF);
      if (FLOW_RO) FLOW_RO.disconnect();
      if (FLOW_IO) FLOW_IO.disconnect();
      const bv = document.getElementById('bv'),
        bm = bv && bv.querySelector('.bm');
      if (!bm) return;
      const inn = bm.querySelector('.bm-in'),
        svg = inn.querySelector('svg'),
        D = bm.ownerDocument;
      bm.dataset.mo = FLOW;
      bm.dataset.st = FLOW_ST;
      const fx = D.createElementNS(FLOW_NS, 'svg');
      fx.setAttribute('class', 'bm-fx');
      fx.setAttribute('aria-hidden', 'true');
      inn.insertBefore(fx, svg.nextSibling);
      const P = [...svg.querySelectorAll('.bm-e')].map(p => {
        const e = EDGES[+p.dataset.e],
          rev = !!FLOW_REV[e[0] + '>' + e[1]];
        if (rev) p.classList.add('rev');
        return {
          p,
          e,
          k: e[2],
          rev,
          d0: p.getAttribute('d'),
          dots: []
        };
      });
      const toPx = (d, w, h, rev) => {
        const pts = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(m => [m[1] * w / 1000, m[2] * h / 100]);
        if (rev) pts.reverse();
        const f = q => q[0].toFixed(1) + ',' + q[1].toFixed(1);
        return pts.length === 4 ? `M${f(pts[0])} C${f(pts[1])} ${f(pts[2])} ${f(pts[3])}` : `M${f(pts[0])} L${f(pts[1])}`;
      };
      let focus = null,
        vis = true;
      const paintFocus = () => {
        const id = focus;
        bm.classList.toggle('foc', !!id);
        const nb = new Set();
        P.forEach(o => {
          const on = !!id && (o.e[0] === id || o.e[1] === id);
          if (on) {
            nb.add(o.e[0]);
            nb.add(o.e[1]);
          }
          o.on = on;
          o.p.classList.toggle('on', on);
          if (o.ar) o.ar.classList.toggle('on', on);
          o.dots.forEach(d => d.c.classList.toggle('on', on));
        });
        bm.querySelectorAll('.bm-el[data-e]').forEach(l => {
          const e = EDGES[+l.dataset.e];
          l.classList.toggle('on', !!id && (e[0] === id || e[1] === id));
        });
        bm.querySelectorAll('.bm-n').forEach(n => n.classList.toggle('nb', !!id && !nb.has(n.dataset.ctr)));
      };
      /* everything in pixels: arrowheads stay square and dots stay round however the map stretches */
      const build = () => {
        const w = svg.clientWidth,
          h = svg.clientHeight;
        if (!w) return;
        fx.setAttribute('viewBox', `0 0 ${w} ${h}`);
        html(fx, '');
        const gD = D.createElementNS(FLOW_NS, 'g'),
          gA = D.createElementNS(FLOW_NS, 'g');
        fx.append(gD, gA);
        P.forEach(o => {
          const g = D.createElementNS(FLOW_NS, 'path');
          g.setAttribute('d', toPx(o.d0, w, h, o.rev));
          o.len = g.getTotalLength();
          const n = Math.max(8, Math.round(o.len / 4));
          o.tab = [];
          for (let j = 0; j <= n; j++) {
            const q = g.getPointAtLength(o.len * j / n);
            o.tab.push([q.x, q.y]);
          }
          o.ar = null;
          if (o.k !== 'reads' && o.len > 8) {
            const t = o.tab[o.tab.length - 1],
              b = g.getPointAtLength(Math.max(0, o.len - 6)),
              a = Math.atan2(t[1] - b.y, t[0] - b.x),
              s = 6;
            const ar = D.createElementNS(FLOW_NS, 'path');
            ar.setAttribute('class', 'bm-ar ' + o.k);
            ar.setAttribute('d', `M${(t[0] - s * Math.cos(a - .55)).toFixed(1)},${(t[1] - s * Math.sin(a - .55)).toFixed(1)} L${t[0].toFixed(1)},${t[1].toFixed(1)} L${(t[0] - s * Math.cos(a + .55)).toFixed(1)},${(t[1] - s * Math.sin(a + .55)).toFixed(1)}`);
            gA.appendChild(ar);
            o.ar = ar;
          }
          o.dots = [];
          const spec = FLOW_DOT[FLOW_ST][o.k];
          if (spec && o.len > 8) {
            const [gap,, r] = spec,
              nd = Math.max(1, Math.floor(o.len / gap));
            for (let j = 0; j < nd; j++) {
              const c = D.createElementNS(FLOW_NS, 'circle');
              c.setAttribute('r', r);
              c.setAttribute('class', 'bm-dot ' + o.k);
              gD.appendChild(c);
              o.dots.push({
                c,
                ph: j / nd
              });
            }
          }
        });
        paintFocus();
      };
      const at = (o, f) => {
        const x = f * (o.tab.length - 1),
          j = Math.min(o.tab.length - 2, Math.floor(x)),
          s = x - j,
          a = o.tab[j],
          b = o.tab[j + 1];
        return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
      };
      const setFocus = id => {
        focus = id;
        paintFocus();
      };
      bm.querySelectorAll('.bm-n').forEach(n => {
        n.addEventListener('mouseenter', () => setFocus(n.dataset.ctr));
        n.addEventListener('focus', () => setFocus(n.dataset.ctr));
        n.addEventListener('mouseleave', () => setFocus(null));
        n.addEventListener('blur', () => setFocus(null));
      });
      bv.querySelectorAll('[data-bmo]').forEach(b => b.onclick = ev => {
        ev.stopPropagation();
        FLOW = b.dataset.bmo;
        bm.dataset.mo = FLOW;
        bv.querySelectorAll('[data-bmo]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      });
      bv.querySelectorAll('[data-bst]').forEach(b => b.onclick = ev => {
        ev.stopPropagation();
        FLOW_ST = b.dataset.bst;
        bm.dataset.st = FLOW_ST;
        bv.querySelectorAll('[data-bst]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        build();
      });
      const t0 = performance.now();
      const tick = now => {
        FLOW_RAF = requestAnimationFrame(tick);
        if (!bm.isConnected) {
          cancelAnimationFrame(FLOW_RAF);
          if (FLOW_RO) FLOW_RO.disconnect();
          if (FLOW_IO) FLOW_IO.disconnect();
          return;
        }
        if (!vis) return;
        const sec = Math.max(0, now - t0) / 1000;
        P.forEach(o => {
          if (!o.dots.length) return;
          const live = FLOW === 'flow' || FLOW === 'focus' && o.on,
            spd = FLOW_DOT[FLOW_ST][o.k][1];
          o.dots.forEach(d => {
            const f = live ? (sec * spd / o.len + d.ph) % 1 : d.ph,
              [x, y] = at(o, f);
            d.c.setAttribute('cx', x.toFixed(1));
            d.c.setAttribute('cy', y.toFixed(1));
            /* ease in from the sender and out into the receiver, so the stream never pops */
            const edge = Math.min(f, 1 - f) * o.len,
              a = Math.min(1, edge / 14);
            d.c.style.opacity = FLOW === 'off' || FLOW === 'focus' && !o.on ? 0 : a;
          });
        });
      };
      build();
      FLOW_RO = new ResizeObserver(build);
      FLOW_RO.observe(inn);
      FLOW_IO = new IntersectionObserver(es => {
        vis = es[0].isIntersecting;
      });
      FLOW_IO.observe(bm);
      FLOW_RAF = requestAnimationFrame(tick);
    }
    const ROLE_KEY = {
      CF: 'Clear Financial',
      CL: 'Clear Lending',
      CO: 'Clear Collective',
      AG: 'Collateral Agent',
      M: 'The member',
      H: 'Bondholders',
      OPS: 'Ops Safe',
      R: 'Code only'
    };
    const mapKey = () => {
      const box = (c, t) => <span><i className={`bk-b k-${c}`} />{t}</span>;
      return <div className="bm-keys"><div className="bk-row"><span className="bk-h">Contracts</span>{box('live', LV ? `Found on ${LV.chain.network || 'the chain'}` : 'Live')}{box('later', LV ? 'Not found on-chain' : 'Not deployed')}{box('ctl', 'Controls and rules')}{box('me', 'Waiting on you')}<i className="bk-sep" /><span className="bk-h bk-h2">Lines</span><span><i className="lk reads" />Reads</span><span><i className="lk money" />Moves money</span><span><i className="lk mint" />Mints</span></div><div className="bk-row"><span className="bk-h">Roles</span>{Object.entries(ROLE_KEY).map(([k, t], __k) => <span key={__k}><i className={`bm-o o-${k}`}>{k === 'R' ? 'RULES' : k}</i>{t}</span>)}<span className="bk-note">Always two people</span></div></div>;
    };

    /* ══ Build — smart contracts and the code behind every app ══════════════════════════════════════════════════
       Overview (is anything blocked or waiting on you) · Changes (every pull request and on-chain change, by stage) ·
       Contracts (the protocol map, the Ops Safe, releases and roles) · Deploys (where each repo runs, checks, history) ·
       Security (findings, audits, keys, incidents). Agreements live in Governance now. */
    const B = keep('build.B', {
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
    }, ['st', 'tab', 'repo', 'cp', 'dp', 'more']);
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
    const stateTxt = c => LV ? stateLive(c) : c.st === 'draft' ? c.after && CHG[c.after].st !== 'shipped' ? `Draft · merges after ${CHG[c.after].t}` : c.checks === 'fail' ? 'Draft · checks failing' : 'Draft' : c.st === 'review' ? c.rev ? c.rev === B.me ? 'Waiting on your review' : `Waiting on ${who(c.rev)}` : c.revState === 'changes' ? `${who(c.reviewer)} asked for changes` : c.revState === 'ok' ? `Approved by ${who(c.reviewer)} · ready to merge` : 'Anyone can review' : c.st === 'safe' ? c.block ? c.block : c.wait ? `In the 7-day wait · live ${WD(c.wait)} ${hm(c.wait)}` : c.need === B.me ? `Waiting on you · ${sigCount(c)} of 2` : `Waiting on ${who(c.need)} · ${sigCount(c)} of 2` : `Live ${/^(Today|Yesterday)$/.test(dayLbl(c.live)) ? dayLbl(c.live).toLowerCase() : dayLbl(c.live)}`;
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
        lp: 'Yield Pool',
        bv: '$25,000 held',
        ap: 'Setup runs 24 Nov',
        ca: 'Changes run 24 Nov',
        hd: 'Wired 24 Nov',
        lcm: 'Phase 2g',
        cta: 'Phase 3',
        fcr: 'Phase 3'
      };
      CHANGES.filter(c => c.st === 'safe' && c.contract).forEach(c => {
        if (c.kind === 'upgrade' && c.need) p[c.contract] = c.need === B.me ? `Sign ${c.t.split(' ').pop()}` : `${c.t.split(' ').pop()} · ${who(c.need).split(' ')[0]}`;else if (c.need) p[c.contract] = `Waiting on ${c.need === B.me ? 'you' : who(c.need).split(' ')[0]}`;else if (c.wait) p[c.contract] = 'In the wait';else if (c.block && c.contract === 'vr') p[c.contract] = 'Waits on D&T';
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
      const apW = ap.st === 'safe' && ap.need ? <a data-bopen="u-ap">{"waits on "}{ap.need === B.me ? 'your' : who(ap.need) + '’s'}{" signature"}</a> : ap.wait ? `is in the 7-day wait` : 'is live';
      const BR = {
        overview: <>{crit.length ? <>{"AssurancePool v2 closes the one critical finding and "}{apW}.</> : 'The audited stack is live on Base Sepolia; the day-7 batches run 24 Nov.'}{" "}{fail.length ? <>{"The member app’s checks are failing on dev; "}<a data-bopen="a212">#132 fixes it</a>.</> : 'Every main branch is passing.'}</>,
        changes: `${CHANGES.filter(c => c.st === 'review').length} changes are in review and ${CHANGES.filter(c => c.st === 'safe').length} wait in a Safe. ${CHANGES.filter(c => c.st === 'shipped').length} shipped this week.`,
        contracts: `${MAP_LIVE} of ${MAP_N} contracts are live on Base Sepolia after the 17 Nov day-0 run; the rest wait on later phases. OffersIssuer is a new deploy; the old one is retired. Three timelock batches run on 24 Nov: Earn, vault and Assurance.`,
        signing: (() => {
          const r = SG.steps.filter(s => sgState(s) === 'ready').length,
            m = SG.steps.filter(s => sgMine(s) && sgState(s) === 'ready').length;
          const d = SG.steps.filter(s => ['done', 'success'].includes(sgState(s))).length,
            w = SG.steps.length - d - r;
          return r ? `The Base Sepolia rollout has ${r} steps ready to sign${SG.wallet ? `, ${m} of them for the connected account` : ''}. Safe steps go to each Safe’s queue; everything else is signed in MetaMask.` : `Day 0 is done: ${d} of ${SG.steps.length} steps signed. The last ${w} are Safe batches that open on Tue 24 Nov, when each timelock’s 7 days end.`;
        })(),
        deploys: `Only useclear.org is in production. The contracts run on Base Sepolia and the apps run against the provider sandboxes.`,
        security: `${open.length} findings are open. The critical one is closed: AssurancePool v2 has no withdraw.`
      }[B.tab];
      const pass = REPOS.filter(r => r.main === 'pass').length;
      html(document.getElementById('hdr'), <><span className="when"><span className="dot" />Build · Wed 21 Oct · Demo data</span><p className="brief">{BR}</p><div className="strip"><div className="sc" data-btab="changes"><span className="lbl">Waiting on you</span><div className="sc-v">{m.length}{" "}<small>{m.length === 1 ? 'change' : 'changes'}</small></div><div className="mb">{m.map((c, i) => <i key={i} style={css(`left:${i * 100 / Math.max(2, m.length)}%;width:calc(${100 / Math.max(2, m.length)}% - 2px);background:${need(c) === 'sign' ? 'var(--live)' : 'var(--underway)'}`)} />)}</div><div className="sc-s">{m.filter(c => need(c) === 'sign').length}{" to sign · "}{m.filter(c => need(c) === 'review').length}{" to review"}</div></div><div className="sc" data-btab="deploys"><span className="lbl">Checks</span><div className="sc-v">{pass}{" "}<small>{"of "}{REPOS.length}{" passing"}</small></div><div className="mb">{REPOS.map((r, i) => <i key={i} style={css(`left:${i * 100 / REPOS.length}%;width:calc(${100 / REPOS.length}% - 2px);background:${CK[r.main][1]}`)} />)}</div><div className="sc-s">{fail.length ? `${fail.map(r => RSHORT[r.id]).join(', ')} failing` : 'All passing'}{REPOS.some(r => r.main === 'run') ? ' · 1 running' : ''}</div></div><div className="sc" data-btab="contracts"><span className="lbl">On testnet</span><div className="sc-v">{MAP_LIVE}{" "}<small>{"of "}{MAP_N}{" contracts"}</small></div><div className="mb"><i style={css(`width:${MAP_LIVE / MAP_N * 100}%`)} /><span className="hroom" style={css(`left:${MAP_LIVE / MAP_N * 100}%;right:0`)} /></div><div className="sc-s">Base Sepolia · nothing on mainnet yet</div></div><div className="sc" data-btab="security"><span className="lbl">Open findings</span><div className="sc-v">{open.length}{" "}<small>{crit.length}{" critical"}</small></div><div className="mb">{open.map((f, i) => <i key={i} style={css(`left:${i / Math.max(5, open.length) * 100}%;width:calc(${100 / Math.max(5, open.length)}% - 2px);background:${SEV[f.sev][1]}`)} />)}</div><div className="sc-s">No external audit yet</div></div></div></>);
    }

    /* ══ Overview ══════════════════════════════════════════════════════════════════ */
    function renderOverview() {
      if (LV) return renderOverviewLive();
      const m = mine(),
        open = INCIDENTS.filter(i => i.st === 'open');
      const NEED = [...m.map(c => [need(c) === 'sign' ? 'live' : 'underway', need(c) === 'sign' ? `Sign ${c.t}` : `Review #${c.num} · ${c.t}`, need(c) === 'sign' ? `${SAFE_OF(c.contract)} · ${who(Object.keys(c.sigs)[0])} signed · ${c.finding ? 'closes the critical finding' : 'asked for in ' + (c.from || 'Build')}` : `${RSHORT[c.repo]} · ${who(c.by)} · fixes dev`, need(c) === 'sign' ? 'Now' : ago(c.upd).replace(' ago', ''), need(c) === 'sign' ? 'Your signature' : 'Your review', `data-bopen="${c.id}"`, 1]), ...(CHG.c130.revState === 'changes' ? [['line', 'BurnerBond: OpenZeppelin v5 paths', `Protocol · #128 · you asked for changes`, '1 d', 'Waiting on Dana', 'data-bopen="c130"']] : []), ...open.map(i => ['absent', i.t, `${i.area} · ${i.note.split('.')[0]}`, ago(i.at).replace(' ago', ''), i.who === 'auto' ? 'Automatic' : who(i.who).split(' ')[0] + ' is on it', `data-binc="${i.id}"`])];
      const needs = cell('s5', 'Needs you', <span className="lbl">{NEED.length}{" things"}</span>, <div className="bd-nd">{NEED.map(([sv, t, mm, age, own, at, me], __k) => <button key={__k} className="bd-nd-r" {...attrs(at)}><i style={css(`background:${{
            underway: 'var(--underway)',
            live: 'var(--live)',
            absent: 'var(--absent)',
            line: 'var(--line)'
          }[sv]}`)} /><span className="bd-nd-k"><b>{t}</b><span>{mm}</span></span><span className="bd-nd-a"><span className={me ? 'me' : ''}>{own}</span><span className="mono">{age}</span></span></button>)}</div>, <><span>Contract changes need two signers, then 7 days</span><button data-btab="changes">All changes →</button></>);
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
      const steps = [['draft', 'In progress', cnt('draft'), 'Draft pull requests'], ['review', 'In review', cnt('review'), 'Median 0.9 days to approve'], ['safe', 'In a Safe', cnt('safe'), 'Contracts only · 2.1 days to sign, then 7 days'], ['shipped', 'Shipped', cnt('shipped'), 'Last 7 days']];
      const flow = cell('s7', 'From change to live', <span className="lbl">Every project</span>, <><div className="bd-fl">{steps.map(([k, t, n, s], i) => <button key={i} className={`bd-fs ${k}`} data-btab="changes"><div className="bd-fh"><span className="bd-fn">{i + 1}</span><b>{t}</b>{i < 3 ? <span className="bd-fa"><i />{ICO.arrow}</span> : ''}</div><span className="m-big">{n}</span><span className="bd-ft">{s}</span><div className="bd-fb">{CHANGES.filter(c => c.st === k).map((c, __k) => <i key={__k} className={need(c) ? 'me' : c.block || c.wait ? 'hx' : ''} title={c.t} />)}</div></button>)}</div><div className="bd-lw">{lbl('Longest in its stage')}{[['u-ap', 'Board Safe since 18 Oct', '3 days'], ['u-dt', 'Blocked since 16 Oct', '5 days'], ['c131', 'Draft since 19 Oct', '2 days']].map(([id, s2, d2], __k) => {
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
      const reviews = cell('s5', 'Reviews', <span className="lbl">Last 30 days</span>, <div className="bd-rv"><div className="m-big">{"5.1 h "}<small>median time to a first review</small></div><div className="led bd-rv-l">{rv.map(([k, n, w, med, done], __k) => <div key={__k}><span className="bd-rv-p">{av(k)}<span><b>{k === B.me ? 'You' : n}</b><em>{w ? `${w} waiting on ${k === B.me ? 'you' : 'them'}` : 'Nothing waiting'}{" · median "}{med}</em></span></span><span className="bd-rv-b"><i style={css(`width:${done / rmx * 100}%`)} /></span><b>{done}</b></div>)}</div><div className="bd-dist">{lbl('Time to a first review')}{[['Under 1 h', 7], ['1 to 4 h', 6], ['4 to 24 h', 8], ['Over a day', 4]].map(([t, n], __k) => <div key={__k}><span>{t}</span><span className="bd-rv-b"><i style={css(`width:${n / 8 * 100}%`)} /></span><b>{n}</b></div>)}</div><p className="bd-n">Every change to dev or main needs one review and passing checks. Contract changes then need two signers in the contract’s Safe and a 7-day timelock.</p></div>, <><span>Branch rules are set in GitHub</span><span /></>);
      html(document.getElementById('bv'), <>{band(board, 1)}{band(<>{commits}{LV ? reviewsLive() : reviews}</>)}</>);
    }

    /* ══ Contracts ═════════════════════════════════════════════════════════════════ */
    function renderContracts() {
      if (LV) return renderContractsLive();
      const map = cell('s12', 'The protocol', <span className="lbl">Base Sepolia · block 60,137,297</span>, <div className="bd-map">{protoMap()}</div>, <>{mapKey()}</>);
      const q = CHANGES.filter(c => c.st === 'safe');
      const safe = cell('s7', 'Waiting in a Safe', <span className="lbl">Two signers, then 7 days</span>, <div className="bd-q">{q.map((c, __k) => {
          const s = c.sigs || {},
            ks = ['kai', 'dana', 'bs'];
          return <button key={__k} className={`bd-q-r ${need(c) ? 'me' : ''}`} data-bopen={c.id}><span className="bd-q-k"><b>{c.t}</b><span>{ctrOf(c.contract)[1]}{" · "}{c.kind === 'upgrade' ? 'upgrade' : 'setting'}{" · "}{c.from ? 'from ' + c.from : 'Protocol #' + c.num}</span></span><span className="bd-q-s">{ks.map((k, __k) => <i key={__k} className={s[k] ? 'on' : c.need === k ? 'me' : ''} title={PPL[k].n}>{PPL[k].ini}</i>)}</span><span className={`bd-q-w ${c.block ? 'blk' : c.wait ? 'wt' : ''}`}>{c.block ? <><em className="hxw" />{c.block}</> : c.wait ? <><em className="hxw" />{"Live "}{WD(c.wait)}{" "}{hm(c.wait)}</> : need(c) ? <b>Your signature</b> : `Waiting on ${who(c.need)}`}</span></button>;
        })}</div>, <><span>Money moves are signed in Money</span><button data-bgo="money/moves">Money →</button></>);
      const signers = cell('s5', 'Signers', <span className="lbl">Signatures a week</span>, <div className="bd-sg"><div className="m-big">{"3.1 h "}<small>your median time to sign · the fastest of the three</small></div><div className="bd-sh"><div className="bd-sh-r bd-sh-x"><span />{['1 Sep', '8', '15', '22', '29', '6 Oct', '13', '20'].map((w, __k) => <span key={__k}>{w}</span>)}<span>Median</span></div>{SIGNERS.map(([k, ini, n, r, med], __k) => <div key={__k} className="bd-sh-r"><span className="bd-sh-k">{av(k)}<b>{k === B.me ? 'You' : n}</b></span>{SIGN_W[ini].map((v, __k) => <i key={__k} style={css(`--v:${v / 4}`)} className={v ? '' : 'z'}>{v || ''}</i>)}<b>{med.toFixed(1)}{" h"}</b></div>)}</div><div className="led bd-sg-l">{[['Signed since 1 Sep', `${Math.round(Object.values(SIGN_W).flat().reduce((a, b) => a + b, 0) / 2)} changes`], ['Board signer', 'Upgrades only']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div>, <><span>Each contract changes through its owner’s Safe</span><button data-btab="security">Keys →</button></>);
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
        })}</div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />Live version</span><span><i className="bd-ko" />Earlier</span><span><i className="bd-ko nx" />Next, waiting in a Safe</span></span><span>{Object.values(RELEASES).flat().length}{" releases"}</span></>);
      const R = [['Upgrade and admin', ['safe']], ['Pause', ['safe']], ['Mint credit', ['iss']], ['Set shop terms', ['safe']], ['Approve a deed', ['val']], ['Add a validator', ['safe']], ['Claim from the AssurancePool', ['bond', 'credit', 'lend']]];
      const COLS = [['safe', 'Ops Safe'], ['iss', 'Issuers'], ['bond', 'BurnerBond'], ['credit', 'ClearCredit'], ['lend', 'LendingPool'], ['val', 'Validators']];
      const roles = cell('s5', 'Who can do what', <span className="lbl">AccessManager roles</span>, <div className="bd-ro"><div className="bd-ro-r bd-ro-x"><span />{COLS.map(([, t], __k) => <span key={__k}><em>{t}</em></span>)}</div>{R.map(([t, h], __k) => <div key={__k} className="bd-ro-r"><span>{t}</span>{COLS.map(([k], __k) => <i key={__k} className={`${h.includes(k) ? 'on' : ''} ${t.startsWith('Claim') && h.includes(k) && CHG['u-ap'].st === 'safe' ? 'nx' : ''}`} />)}</div>)}<div className={`bd-ro-w ${CHG['u-ap'].st === 'safe' ? '' : 'done'}`}>{CHG['u-ap'].st === 'safe' ? <><b>Until v1.3:</b>{" anyone can claim from the AssurancePool. "}<button className="lnk3" data-bfind="F1">Finding →</button></> : 'Claims from the AssurancePool are limited to these three roles.'}</div></div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />Holds it</span><span><i className="hx" />Once v1.3 is live</span></span><span /></>);
      const aux = cell('s7', 'Timelocks and helpers', <span className="lbl">{CTR_AUX.length}{" live"}</span>, <div className="bd-xl">{CTR_AUX.map(([n, a, d, w], __k) => <div key={__k} className="bd-xr"><span className="bd-xk"><b>{n}</b><span>{d}</span></span><span className="bd-xw">{w}</span><span className="mono bd-xa">{a}</span></div>)}</div>, <><span>Every timelock waits 7 days and has no admin to shorten it</span><span /></>);
      const old = cell('s5', 'Retired', <span className="lbl">Kept on record</span>, <div className="bd-xl">{CTR_OLD.map(([n, a, d], __k) => <div key={__k} className="bd-xr two"><span className="bd-xk"><b>{n}</b><span>{d}</span></span><span className="mono bd-xa">{a}</span></div>)}<p className="bd-xn">{"And "}{CTR_OLD_N}{" earlier copies from before the audit fixes, each replaced by the address on the map. Nothing points to them."}</p></div>, <><span>Records stay in deployments/base-sepolia</span><span /></>);
      html(document.getElementById('bv'), <>{band(map, 1)}{band(<>{aux}{old}</>)}{band(<>{safe}{signers}</>)}{band(<>{rel}{roles}</>)}</>);
      flowMount();
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
      const aud = cell('s4', 'Audits', <span className="lbl">{MAP_N}{" contracts"}</span>, <div className="bd-au"><div className="m-big">{rv}{" "}<small>{"of "}{tot}{" contracts reviewed internally"}</small></div><div className="bd-au-b"><i style={css(`width:${rv / tot * 100}%`)} /><i className="hx" style={css(`width:${(tot - rv) / tot * 100}%`)} /></div><div className="led bd-au-k">{[['Reviewed', 'Credit and money · 18'], ['Not yet', 'Deeds and capital · 13']].map(([k, v], i) => <div key={i}><span><i className={i ? 'hx' : ''} />{k}</span><b>{v}</b></div>)}</div><div className="bd-au-l">{lbl('Before mainnet')}<div className="led">{[['Phase 0 fixes', '1 critical left', 'p'], ['External audit', 'Not booked', ''], ['Bug bounty', 'Not yet', ''], ['Mainnet deploy', 'After all three', '']].map(([k, v, st], __k) => <div key={__k}><span>{k}</span><b className={st ? 'wt' : ''}>{v}</b></div>)}</div></div></div>, <><span>Credit and money contracts first</span><span /></>);
      const keys = cell('s6', 'Keys and access', <span className="lbl">Who can change what</span>, <div className="led bd-ky">{KEYS.map(([k, v, s], __k) => <div key={__k}><span><b>{k}</b><em>{s}</em></span><b>{v}</b></div>)}</div>, <><span>Set in Permissions and GitHub</span><button data-bgo="team">Permissions →</button></>);
      const inc = cell('s6', 'Incidents', <span className="lbl">Last 30 days</span>, <div className="bd-il">{INCIDENTS.map((i, __k) => <button key={__k} className={`bd-ir ${i.st}`} data-binc={i.id}>{leaf(i.at)}<span><b>{i.t}</b><span>{i.area}{" · "}{i.st === 'open' ? 'open' : 'resolved in ' + i.dur}</span></span><span className={`fst ${i.st === 'open' ? 'warn2' : ''}`}>{i.st === 'open' ? 'Open' : 'Closed'}</span></button>)}</div>, <><span>None reached members</span><span /></>);
      const jobs = cell('s12', 'Automatic jobs', <span className="lbl">{AUTO.length}{" jobs · "}{AUTO.filter(j => j.w !== 'No wallet').length}{" hold a wallet"}</span>, <div className="bd-aj"><div className="bd-aj-r bd-aj-h"><span>Job</span><span>Wallet</span><span>Most it can move</span><span>Last run</span><span>Off switch</span></div>{AUTO.map((j, __k) => <div key={__k} className="bd-aj-r"><span><b>{j.t}</b><em>{j.d}</em></span><span><b>{j.w}</b><em className="mono">{j.a}</em></span><span><b>{j.lim[0]}</b><em>{j.lim[1]}</em></span><span><b><i className={`bd-aj-d ${j.st}`} />{j.run[0]}</b><em>{j.run[1]}</em></span><span><b className={j.off[0].includes('_') ? 'mono' : ''}>{j.off[0]}</b><em>{j.off[1]}</em></span></div>)}</div>, <><span>The two that move money stop on any revert until a person clears it · this app never holds their keys</span><button data-bgo="money">Money →</button></>);
      html(document.getElementById('bv'), <>{band(<>{fnd}{aud}</>, 1)}{band(<>{keys}{inc}</>)}{band(jobs)}</>);
    }

    /* ══ Signing — the plan → sign → re-check loop (tools/signing-page, brought into Command Center) ══════════════════
       A plan (format clear-signing-plan/1) is written by scripts/signing_plan.ts, which reads the chain. Each step carries its exact call data;
       Command Center never builds a call. Wallet steps are signed in MetaMask by the account the step names; Safe steps go to that Safe's
       queue for its owners. Re-reading the chain turns sent steps to done and opens the steps that waited on them. Demo data below. */
    const SG_ACCT = {
      dep: ['Deployer', '0x895d…7AAA', 'OPS'],
      ts1: ['Treasury signer 1', '0x41a9…02e7', 'CL'],
      ts2: ['Treasury signer 2', '0x9c04…77b1', 'CL'],
      agk: ['Agent Key', '0x2b7f…e119', 'AG'],
      cs2: ['Credit settings signer 2', '0x5e88…a3d0', 'CL'],
      vs1: ['Valuation signer 1', '0x13c2…9f4a', 'CL'],
      vs2: ['Valuation signer 2', '0x7af0…61c8', 'CL'],
      a3: ['Assurance signer 1 · Account 3', '0x8d55…b20e', 'CO'],
      a4: ['Assurance signer 2 · Account 4', '0xe31b…4c97', 'CO'],
      cls: ['Clear Lending Safe · 2 of 2', '0x3f90…aa12', 'CL'],
      clo: ['CL Operating · through the Clear Lending Safe', '0xfAFf…df65', 'CL'],
      cts: ['Clear Treasury Safe · 2 of 4', '0x52e6…cf50', 'CF']
    };
    const SG_STAGES = [['C1d', 'Savings vault'], ['D4', 'Credit roles'], ['E8', 'Earn changes'], ['F2', 'Fee recipient'], ['G1', 'Pool Tier'], ['SF', 'Treasury Safe'], ['I3', 'Vault timelock'], ['AS', 'Assurance'], ['TU', 'Top-ups'], ['D7', 'Day 7 runs']];
    const sgStage = k => (SG_STAGES.find(x => x[0] === k) || [k, k])[1];
    const SG = LV ? sgLiveShell() : {
      plan: {
        name: 'Base Sepolia rollout',
        chain: 84532,
        block: 60137297,
        generated: H(11, 17, 21, 2),
        sha: '70ef78b04232…',
        file: 'signing-plan.json'
      },
      f: 'all',
      wallet: null,
      sent: {},
      steps: [{
        id: 'C1d-1',
        st: 'C1d',
        kind: 'wallet',
        who: 'dep',
        to: 'esa',
        fn: 'upgradeToAndCall(address,bytes)',
        t: 'Upgrade the savings vault',
        x: 'Points the vault proxy at the audited implementation and runs its migration.',
        args: [['newImplementation', 'address', 'v1.1'], ['data', 'bytes', 'migrate()']],
        status: 'done'
      }, {
        id: 'C1d-2',
        st: 'C1d',
        kind: 'wallet',
        who: 'dep',
        to: 'esa',
        fn: 'grantRole(bytes32,address)',
        t: 'Give the Clear Treasury Safe the pilot role',
        x: 'PILOT_ROLE counts California mints for the pilot cap.',
        args: [['role', 'bytes32', 'PILOT_ROLE'], ['account', 'address', '0x52e6…cf50']],
        status: 'done'
      }, {
        id: 'C1d-3',
        st: 'C1d',
        kind: 'wallet',
        who: 'dep',
        to: 'esa',
        fn: 'revokeRole(bytes32,address)',
        t: 'Take the old role off the vault',
        x: 'After this the deployer only holds VAULT_ADMIN until the vault timelock accepts it.',
        args: [['role', 'bytes32', 'old role'], ['account', 'address', 'previous holder']],
        status: 'done'
      }, {
        id: 'D4-settings-1',
        st: 'D4',
        kind: 'wallet',
        who: 'dep',
        to: 'am',
        fn: 'grantRole(uint64,address,uint32)',
        t: 'Credit settings role, signer 1',
        x: 'One of the two people who change credit settings (spec 12).',
        args: [['role', 'uint64', 'SETTINGS'], ['account', 'address', 'from the rollout config']],
        status: 'done'
      }, {
        id: 'D4-settings-2',
        st: 'D4',
        kind: 'wallet',
        who: 'dep',
        to: 'am',
        fn: 'grantRole(uint64,address,uint32)',
        t: 'Credit settings role, signer 2',
        x: 'Every settings change needs both.',
        args: [['role', 'uint64', 'SETTINGS'], ['account', 'address', 'from the rollout config']],
        status: 'done'
      }, {
        id: 'D4-attester-1',
        st: 'D4',
        kind: 'wallet',
        who: 'dep',
        to: 'am',
        fn: 'grantRole(uint64,address,uint32)',
        t: 'Credit attester role, signer 1',
        x: 'Records cure notices, Assurance and workouts.',
        args: [['role', 'uint64', 'ATTESTER'], ['account', 'address', 'from the rollout config']],
        status: 'done'
      }, {
        id: 'D4-attester-2',
        st: 'D4',
        kind: 'wallet',
        who: 'dep',
        to: 'am',
        fn: 'grantRole(uint64,address,uint32)',
        t: 'Credit attester role, signer 2',
        x: 'The second attester.',
        args: [['role', 'uint64', 'ATTESTER'], ['account', 'address', 'from the rollout config']],
        status: 'done'
      }, {
        id: 'D4-operator',
        st: 'D4',
        kind: 'wallet',
        who: 'dep',
        to: 'am',
        fn: 'grantOperator(address)',
        t: 'Set the credit operator',
        x: 'The API wallet that opens lines and posts statements. It cannot change settings.',
        args: [['operator', 'address', 'API wallet']],
        status: 'done'
      }, {
        id: 'E8-vault-propose',
        st: 'E8',
        kind: 'wallet',
        who: 'ts1',
        to: 'ca',
        fn: 'proposeChange(bytes32,bytes)',
        t: 'Propose the Collateral Agent change for the BondVault',
        x: 'Treasury signer 1 proposes; the Agent applies it after its own 7 days.',
        args: [['what', 'bytes32', 'VAULT']],
        status: 'done'
      }, {
        id: 'E8-vault-confirm',
        st: 'E8',
        kind: 'wallet',
        who: 'ts2',
        to: 'ca',
        fn: 'confirmChange(uint256)',
        t: 'Confirm the change for the BondVault',
        x: 'Treasury signer 2 confirms the same change.',
        args: [['changeId', 'uint256', 'from the proposal']],
        status: 'done'
      }, {
        id: 'E8-vault-approve',
        st: 'E8',
        kind: 'wallet',
        who: 'agk',
        to: 'ca',
        fn: 'approveChange(uint256)',
        t: 'Agent Key co-signs the BondVault',
        x: 'The Agent Key’s only co-signature right (IV-10 Exhibit A).',
        args: [['changeId', 'uint256', 'from the proposal']],
        status: 'done'
      }, {
        id: 'E8-bondbook-propose',
        st: 'E8',
        kind: 'wallet',
        who: 'ts1',
        to: 'ca',
        fn: 'proposeChange(bytes32,bytes)',
        t: 'Propose the Collateral Agent change for the bond book',
        x: 'Treasury signer 1 proposes; the Agent applies it after its own 7 days.',
        args: [['what', 'bytes32', 'BONDBOOK']],
        status: 'done'
      }, {
        id: 'E8-bondbook-confirm',
        st: 'E8',
        kind: 'wallet',
        who: 'ts2',
        to: 'ca',
        fn: 'confirmChange(uint256)',
        t: 'Confirm the change for the bond book',
        x: 'Treasury signer 2 confirms the same change.',
        args: [['changeId', 'uint256', 'from the proposal']],
        status: 'done'
      }, {
        id: 'E8-bondbook-approve',
        st: 'E8',
        kind: 'wallet',
        who: 'agk',
        to: 'ca',
        fn: 'approveChange(uint256)',
        t: 'Agent Key co-signs the bond book',
        x: 'The Agent Key’s only co-signature right (IV-10 Exhibit A).',
        args: [['changeId', 'uint256', 'from the proposal']],
        status: 'done'
      }, {
        id: 'E8-holderdirections-propose',
        st: 'E8',
        kind: 'wallet',
        who: 'ts1',
        to: 'ca',
        fn: 'proposeChange(bytes32,bytes)',
        t: 'Propose the Collateral Agent change for Holder Directions',
        x: 'Treasury signer 1 proposes; the Agent applies it after its own 7 days.',
        args: [['what', 'bytes32', 'HOLDERDIRECTIONS']],
        status: 'done'
      }, {
        id: 'E8-holderdirections-confirm',
        st: 'E8',
        kind: 'wallet',
        who: 'ts2',
        to: 'ca',
        fn: 'confirmChange(uint256)',
        t: 'Confirm the change for Holder Directions',
        x: 'Treasury signer 2 confirms the same change.',
        args: [['changeId', 'uint256', 'from the proposal']],
        status: 'done'
      }, {
        id: 'E8-holderdirections-approve',
        st: 'E8',
        kind: 'wallet',
        who: 'agk',
        to: 'ca',
        fn: 'approveChange(uint256)',
        t: 'Agent Key co-signs Holder Directions',
        x: 'The Agent Key’s only co-signature right (IV-10 Exhibit A).',
        args: [['changeId', 'uint256', 'from the proposal']],
        status: 'done'
      }, {
        id: 'E8-pledgemodule-propose',
        st: 'E8',
        kind: 'wallet',
        who: 'ts1',
        to: 'ca',
        fn: 'proposeChange(bytes32,bytes)',
        t: 'Propose the Collateral Agent change for the pledge module',
        x: 'Treasury signer 1 proposes; the Agent applies it after its own 7 days.',
        args: [['what', 'bytes32', 'PLEDGEMODULE']],
        status: 'done'
      }, {
        id: 'E8-pledgemodule-confirm',
        st: 'E8',
        kind: 'wallet',
        who: 'ts2',
        to: 'ca',
        fn: 'confirmChange(uint256)',
        t: 'Confirm the change for the pledge module',
        x: 'Treasury signer 2 confirms the same change.',
        args: [['changeId', 'uint256', 'from the proposal']],
        status: 'done'
      }, {
        id: 'E8-pledgemodule-approve',
        st: 'E8',
        kind: 'wallet',
        who: 'agk',
        to: 'ca',
        fn: 'approveChange(uint256)',
        t: 'Agent Key co-signs the pledge module',
        x: 'The Agent Key’s only co-signature right (IV-10 Exhibit A).',
        args: [['changeId', 'uint256', 'from the proposal']],
        status: 'done'
      }, {
        id: 'E8-backstop-propose',
        st: 'E8',
        kind: 'wallet',
        who: 'ts1',
        to: 'ca',
        fn: 'proposeChange(bytes32,bytes)',
        t: 'Propose the Collateral Agent change for the old backstop link',
        x: 'Treasury signer 1 proposes; the Agent applies it after its own 7 days.',
        args: [['what', 'bytes32', 'BACKSTOP']],
        status: 'done'
      }, {
        id: 'E8-backstop-confirm',
        st: 'E8',
        kind: 'wallet',
        who: 'ts2',
        to: 'ca',
        fn: 'confirmChange(uint256)',
        t: 'Confirm the change for the old backstop link',
        x: 'Treasury signer 2 confirms the same change.',
        args: [['changeId', 'uint256', 'from the proposal']],
        status: 'done'
      }, {
        id: 'E8-backstop-approve',
        st: 'E8',
        kind: 'wallet',
        who: 'agk',
        to: 'ca',
        fn: 'approveChange(uint256)',
        t: 'Agent Key co-signs the old backstop link',
        x: 'The Agent Key’s only co-signature right (IV-10 Exhibit A).',
        args: [['changeId', 'uint256', 'from the proposal']],
        status: 'done'
      }, {
        id: 'E8-hold-1',
        st: 'E8',
        kind: 'wallet',
        who: 'dep',
        to: 'lq',
        fn: 'grantRole(bytes32,address)',
        t: 'Liquidation hold role, signer 1',
        x: 'One of the two people who can place a Liquidation Hold.',
        args: [['role', 'bytes32', 'HOLD_ROLE'], ['account', 'address', '0x41a9…02e7']],
        status: 'done'
      }, {
        id: 'E8-hold-2',
        st: 'E8',
        kind: 'wallet',
        who: 'dep',
        to: 'lq',
        fn: 'grantRole(bytes32,address)',
        t: 'Liquidation hold role, signer 2',
        x: 'The second hold signer.',
        args: [['role', 'bytes32', 'HOLD_ROLE'], ['account', 'address', '0x9c04…77b1']],
        status: 'done'
      }, {
        id: 'E8-earn-schedule',
        st: 'E8',
        kind: 'safe',
        who: 'cls',
        to: null,
        toLbl: 'Earn timelock',
        fn: 'scheduleBatch(…)',
        t: 'Schedule the Earn changes',
        x: 'A Safe batch on the Earn timelock: the EarnControls and BondVault changes, including clearing the old backstop.',
        args: [['calls', 'batch', 'setBackstops and others'], ['delay', 'uint256', '604800 (7 days)']],
        status: 'done'
      }, {
        id: 'F2-fee-approve',
        st: 'F2',
        kind: 'wallet',
        who: 'cs2',
        to: 'ti',
        fn: 'approveFeeRecipient(uint256)',
        t: 'Approve Clear Lending’s fee address',
        x: 'Deploy 25 proposed it; this second approval makes it two people (spec 12.16).',
        args: [['proposalId', 'uint256', 'from deploy 25']],
        status: 'done'
      }, {
        id: 'G1-tier-1',
        st: 'G1',
        kind: 'wallet',
        who: 'vs1',
        to: 'lp',
        fn: 'postPoolTierPrincipal(uint256)',
        t: 'Post the Pool Tier principal, signer 1',
        x: 'Both valuation signers post the same figure.',
        args: [['principal', 'uint256', '100,000.00 USDC']],
        status: 'done'
      }, {
        id: 'G1-tier-2',
        st: 'G1',
        kind: 'wallet',
        who: 'vs2',
        to: 'lp',
        fn: 'postPoolTierPrincipal(uint256)',
        t: 'Post the Pool Tier principal, signer 2',
        x: 'Matches signer 1, so it takes effect.',
        args: [['principal', 'uint256', '100,000.00 USDC']],
        status: 'done'
      }, {
        id: 'safe-owner',
        st: 'SF',
        kind: 'safe',
        who: 'cts',
        to: null,
        toLbl: 'Clear Treasury Safe',
        fn: 'changeThreshold(uint256)',
        t: 'Require two signatures on the Clear Treasury Safe',
        x: 'Every Clear Treasury transaction now needs two of its four owners. Before the handovers.',
        args: [['threshold', 'uint256', '2 of 4']],
        status: 'done'
      }, {
        id: 'I3-vault-schedule',
        st: 'I3',
        kind: 'safe',
        who: 'cts',
        to: null,
        toLbl: 'Vault timelock',
        fn: 'scheduleBatch(…)',
        t: 'Schedule the vault timelock’s acceptances',
        x: 'Clear Financial accepts the vault and ClearUSD admin through its own timelock.',
        args: [['calls', 'batch', 'vault roles · CLRUSD admin'], ['delay', 'uint256', '604800 (7 days)']],
        status: 'done'
      }, {
        id: 'AS-payer-clfees-approve-1',
        st: 'AS',
        kind: 'wallet',
        who: 'a3',
        to: 'ap',
        fn: 'approveAction(bytes32)',
        t: 'Let the CL Fees wallet pay in · signer 1',
        x: 'Both Assurance signers approve this exact call before it can be scheduled.',
        args: [['action', 'bytes32', 'payer-clfees']],
        status: 'done'
      }, {
        id: 'AS-payer-clfees-approve-2',
        st: 'AS',
        kind: 'wallet',
        who: 'a4',
        to: 'ap',
        fn: 'approveAction(bytes32)',
        t: 'Let the CL Fees wallet pay in · signer 2',
        x: 'Both Assurance signers approve this exact call before it can be scheduled.',
        args: [['action', 'bytes32', 'payer-clfees']],
        status: 'done'
      }, {
        id: 'AS-payer-treasury-approve-1',
        st: 'AS',
        kind: 'wallet',
        who: 'a3',
        to: 'ap',
        fn: 'approveAction(bytes32)',
        t: 'Let the Clear Treasury Safe pay in · signer 1',
        x: 'Both Assurance signers approve this exact call before it can be scheduled.',
        args: [['action', 'bytes32', 'payer-treasury']],
        status: 'done'
      }, {
        id: 'AS-payer-treasury-approve-2',
        st: 'AS',
        kind: 'wallet',
        who: 'a4',
        to: 'ap',
        fn: 'approveAction(bytes32)',
        t: 'Let the Clear Treasury Safe pay in · signer 2',
        x: 'Both Assurance signers approve this exact call before it can be scheduled.',
        args: [['action', 'bytes32', 'payer-treasury']],
        status: 'done'
      }, {
        id: 'AS-lendingco-approve-1',
        st: 'AS',
        kind: 'wallet',
        who: 'a3',
        to: 'ap',
        fn: 'approveAction(bytes32)',
        t: 'Name Clear Lending’s loss reserve for draws · signer 1',
        x: 'Both Assurance signers approve this exact call before it can be scheduled.',
        args: [['action', 'bytes32', 'lendingco']],
        status: 'done'
      }, {
        id: 'AS-lendingco-approve-2',
        st: 'AS',
        kind: 'wallet',
        who: 'a4',
        to: 'ap',
        fn: 'approveAction(bytes32)',
        t: 'Name Clear Lending’s loss reserve for draws · signer 2',
        x: 'Both Assurance signers approve this exact call before it can be scheduled.',
        args: [['action', 'bytes32', 'lendingco']],
        status: 'done'
      }, {
        id: 'AS-disbursement-approve-1',
        st: 'AS',
        kind: 'wallet',
        who: 'a3',
        to: 'ap',
        fn: 'approveAction(bytes32)',
        t: 'Name the Member Assurance payout wallet · signer 1',
        x: 'Both Assurance signers approve this exact call before it can be scheduled.',
        args: [['action', 'bytes32', 'disbursement']],
        status: 'done'
      }, {
        id: 'AS-disbursement-approve-2',
        st: 'AS',
        kind: 'wallet',
        who: 'a4',
        to: 'ap',
        fn: 'approveAction(bytes32)',
        t: 'Name the Member Assurance payout wallet · signer 2',
        x: 'Both Assurance signers approve this exact call before it can be scheduled.',
        args: [['action', 'bytes32', 'disbursement']],
        status: 'done'
      }, {
        id: 'AS-exposure-approve-1',
        st: 'AS',
        kind: 'wallet',
        who: 'a3',
        to: 'ap',
        fn: 'approveAction(bytes32)',
        t: 'Make CollateralRegistry the covered-loans reporter · signer 1',
        x: 'Both Assurance signers approve this exact call before it can be scheduled.',
        args: [['action', 'bytes32', 'exposure']],
        status: 'done'
      }, {
        id: 'AS-exposure-approve-2',
        st: 'AS',
        kind: 'wallet',
        who: 'a4',
        to: 'ap',
        fn: 'approveAction(bytes32)',
        t: 'Make CollateralRegistry the covered-loans reporter · signer 2',
        x: 'Both Assurance signers approve this exact call before it can be scheduled.',
        args: [['action', 'bytes32', 'exposure']],
        status: 'done'
      }, {
        id: 'AS-assurance-schedule',
        st: 'AS',
        kind: 'safe',
        who: 'cts',
        to: null,
        toLbl: 'Assurance timelock',
        fn: 'scheduleBatch(…)',
        t: 'Schedule the Assurance setup',
        x: 'The board Safe schedules the five approved calls; they apply after 7 days.',
        args: [['calls', 'batch', '5 calls'], ['delay', 'uint256', '604800 (7 days)']],
        status: 'done'
      }, {
        id: 'AS-floor-1',
        st: 'AS',
        kind: 'wallet',
        who: 'a3',
        to: 'ap',
        fn: 'setFloorInputs(…)',
        t: 'Post the floor figures, signer 1',
        x: 'Coverage cap $10,000.00 on testnet.',
        args: [['coverageCap', 'uint256', '10,000.00 USDC']],
        status: 'done'
      }, {
        id: 'AS-floor-2',
        st: 'AS',
        kind: 'wallet',
        who: 'a4',
        to: 'ap',
        fn: 'setFloorInputs(…)',
        t: 'Post the floor figures, signer 2',
        x: 'Matches signer 1.',
        args: [['coverageCap', 'uint256', '10,000.00 USDC']],
        status: 'done'
      }, {
        id: 'TU-funder',
        st: 'TU',
        kind: 'wallet',
        who: 'dep',
        to: 'pp',
        fn: 'grantRole(bytes32,address)',
        t: 'Let the top-up wallet fund the payout pool',
        x: 'FUNDER_ROLE and nothing else, on the fresh PayoutPool.',
        args: [['role', 'bytes32', 'FUNDER_ROLE'], ['account', 'address', '0xC0C4…5068']],
        status: 'done'
      }, {
        id: 'TU-safe-module',
        st: 'TU',
        kind: 'safe',
        who: 'clo',
        to: null,
        toLbl: 'CL Operating',
        fn: 'enableModule(address)',
        t: 'Turn on the AllowanceModule',
        x: 'On CL Operating; its owner, the Clear Lending Safe, signs.',
        args: [['module', 'address', 'AllowanceModule']],
        status: 'done'
      }, {
        id: 'TU-safe-delegate',
        st: 'TU',
        kind: 'safe',
        who: 'clo',
        to: null,
        toLbl: 'AllowanceModule',
        fn: 'addDelegate(address)',
        t: 'Add the top-up wallet as a delegate',
        x: 'It can only spend inside the limit set next.',
        args: [['delegate', 'address', '0xC0C4…5068']],
        status: 'done'
      }, {
        id: 'TU-safe-allowance',
        st: 'TU',
        kind: 'safe',
        who: 'clo',
        to: null,
        toLbl: 'AllowanceModule',
        fn: 'setAllowance(…)',
        t: 'Set the $5,000 weekly limit',
        x: '$5,000.00 every 7 days; $0.00 spent this period.',
        args: [['amount', 'uint96', '5,000 USDC'], ['reset', 'uint16', '10080 min']],
        status: 'done'
      }, {
        id: 'E8x-earn-execute',
        st: 'D7',
        kind: 'safe',
        who: 'cls',
        to: null,
        toLbl: 'Earn timelock',
        fn: 'executeBatch(…)',
        t: 'Run the Earn batch',
        x: 'Applies the Earn changes and the five Collateral Agent changes, and clears the old backstop.',
        args: [['batch', 'bytes32', 'E8-earn-schedule']],
        status: 'waiting',
        why: 'Opens Tue 24 Nov at 10:36 am PT, when the Earn timelock’s 7 days end.'
      }, {
        id: 'I3x-vault-execute',
        st: 'D7',
        kind: 'safe',
        who: 'cts',
        to: null,
        toLbl: 'Vault timelock',
        fn: 'executeBatch(…)',
        t: 'Run the vault batch',
        x: 'Moves the vault roles and ClearUSD’s admin to the vault timelock.',
        args: [['batch', 'bytes32', 'I3-vault-schedule']],
        status: 'waiting',
        why: 'Opens Tue 24 Nov at 1:00 pm PT. ClearUSD’s own 2-day delay ends Thu 19 Nov.'
      }, {
        id: 'ASx-assurance-execute',
        st: 'D7',
        kind: 'safe',
        who: 'cts',
        to: null,
        toLbl: 'Assurance timelock',
        fn: 'executeBatch(…)',
        t: 'Run the Assurance batch',
        x: 'Turns on deposits, draws and grants on the new AssurancePool.',
        args: [['batch', 'bytes32', 'AS-assurance-schedule']],
        status: 'waiting',
        why: 'Opens Tue 24 Nov at 10:56 am PT.'
      }],
      jobs: [['Assurance floor figures', 'Monthly · two Assurance signers', '1 Nov', 'AS'], ['Pool Tier update', 'When principal changes · both valuation signers', 'On demand', 'PT'], ['Backstop draws and grant releases', 'Per request · Assurance signers, then the 7-day wait', 'None open', 'AS'], ['Execute changes after their wait', 'Each timelock · the Safe that scheduled it', '24 Nov · 3 due', 'D7'], ['Assurance fee funding', 'Monthly · Clear Lending’s two signers, CL Operating to CL Fees', 'September · $6.87', 'AS'], ['Top-up over the weekly limit', 'When the limit runs out · CL Operating, through the Clear Lending Safe', 'None open', 'TU']]
    };
    const sgStep = id => SG.steps.find(s => s.id === id);
    const sgState = s => {
      if (LV) return SGL.stateOf(s, SG.sent, SG.byId);
      const r = SG.sent[s.id];
      return r ? r.state : s.status;
    };
    const sgMine = s => SG.wallet && s.kind === 'wallet' && s.who === SG.wallet;
    const SGW = {
      ready: ['Ready', 'rd'],
      waiting: ['Waiting', 'wt'],
      done: ['Done', 'dn'],
      pending: ['Sent, on chain soon', 'pd'],
      success: ['Confirmed', 'dn'],
      failed: ['Failed', 'bad']
    };
    const sgTag = k => {
      const a = SG_ACCT[k];
      return <i className={`bm-o o-${a[2]}`}>{a[2]}</i>;
    };
    const sgTo = s => s.to ? ctrOf(s.to)[1] : s.toLbl;
    function renderSigning() {
      if (LV && SG.load !== 'ok') return html(document.getElementById('bv'), <>{band(sgNoPlan(), 1)}</>);
      const P = SG.plan,
        S = SG.steps,
        cnt = st => S.filter(s => {
          const x = sgState(s);
          return st === 'done' ? x === 'done' || x === 'success' : x === st;
        }).length;
      const run = cell('s12', `Signing run · ${P.name}`, <span className="sn-net">Base Sepolia · test money only</span>, <div className="sn-run"><div className="sn-tr" style={css(`--n:${SG_STAGES.length}`)}>{SG_STAGES.map(([k, t], __k) => {
            const ss = S.filter(s => s.st === k),
              d = ss.filter(s => ['done', 'success'].includes(sgState(s))).length,
              r = ss.filter(s => sgState(s) === 'ready').length;
            return <button key={__k} className={`sn-tk ${d === ss.length ? 'done' : r ? 'now' : ''}${SG.f === 'st:' + k ? ' on' : ''}`} data-sgf={SG.f === 'st:' + k ? 'all' : 'st:' + k} title={SG.f === 'st:' + k ? 'Show all steps' : 'Show only ' + k}><i /><b>{k}</b><span>{t}</span><em>{d === ss.length ? 'Done' : `${d} of ${ss.length}${r ? ` · ${r} ready` : ''}`}</em></button>;
          })}</div><div className="sn-sum"><div className="sn-cnt"><div className="sn-ns">{[['done', 'done'], ['ready', 'ready to sign'], ['pending', 'sent, on chain soon'], ['waiting', LV ? 'waiting on a step or a timelock' : 'waiting on an earlier step']].filter(([k]) => k !== 'pending' || cnt('pending')).map(([k, t], __k) => <span key={__k}><span className="m-big">{cnt(k)}</span><small><i className={`sn-d ${k}`} />{t}</small></span>)}</div><div className="sn-bar">{['done', 'pending', 'ready', 'waiting'].map((k, __k) => cnt(k) ? <i key={__k} className={k} style={css(`flex:${cnt(k)}`)} /> : '')}</div></div><div className="led sn-fp">{[['Read from the chain', `block ${int(P.block)} · ${fmtD(P.generated)} ${hm(P.generated)}`], ['Plan fingerprint', <><span className="mono">{P.sha}</span>{" · checked"}</>], ['Plan file', <span className="mono">{P.file}</span>]].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div></div>, <><span>After each stage, read the chain again: sent steps turn done and the next ones open</span><span className="sn-fa"><label className="btn">Load a plan<input type="file" accept=".json,application/json" data-sgload="" hidden /></label><button className="btn p" data-sgrecheck="">Read the chain again</button></span></>);
      const F = SG.f,
        FL = [['mine', 'Ready for this wallet'], ['ready', 'All ready'], ['safe', 'Safe steps'], ['all', 'All steps'], ['done', 'Done']];
      const list = S.filter(s => {
        const x = sgState(s);
        return F === 'mine' ? sgMine(s) && x === 'ready' : F === 'ready' ? x === 'ready' : F === 'safe' ? s.kind === 'safe' : F === 'done' ? ['done', 'success'].includes(x) : F.startsWith('st:') ? s.st === F.slice(3) : true;
      });
      const steps = cell('s8', 'Steps', <span className="sn-fl">{FL.map(([k, t], __k) => <button key={__k} className={F === k ? 'on' : ''} data-sgf={k}>{t}</button>)}</span>, list.length ? <div className="sn-ls">{list.map((s, __k) => {
          const x = sgState(s),
            a = SG_ACCT[s.who];
          return <button key={__k} className={`sn-r ${SGW[x][1]} ${sgMine(s) && x === 'ready' ? 'me' : ''}`} data-sgstep={s.id}><span className="sn-id mono">{s.id}</span><span className="sn-k"><b>{s.t}</b><span>{sgTo(s)}{" · "}<span className="mono">{s.fn.split('(')[0]}</span>{s.kind === 'safe' ? ' · Safe batch' : ''}</span></span><span className="sn-w">{sgTag(s.who)}<span>{a[0].split(' · ')[0]}</span></span><span className={`sn-s ${SGW[x][1]}`}>{s.kind === 'safe' && x === 'ready' ? 'In the Safe app' : SGW[x][0]}</span></button>;
        })}</div> : <div className="sn-empty"><span>{F === 'mine' ? SG.wallet ? 'Nothing is ready for this account. Switch accounts, or see all ready steps.' : 'Connect a wallet to see the steps it signs.' : 'No steps here.'}</span></div>, <><span>{S.length}{" steps · signers from the rollout config"}</span><span>Each step carries its exact call data</span></>);
      const w = SG.wallet,
        wa = w && (SG_ACCT[w] || ['This account', LV ? SGL.shortA(w) : w, 'R']),
        mine = S.filter(s => sgMine(s) && sgState(s) === 'ready').length;
      const wal = cell('s4', 'Your wallet', w ? LV && SGL.W.chain !== SGL.BASE_SEPOLIA ? <span className="fst">Wrong network · switch to Base Sepolia</span> : <span className="fst sn-ok">Base Sepolia</span> : <span className="lbl">Not connected</span>, w ? <div className="sn-wl"><div className="sn-wa">{sgTag(w)}<span><b>{wa[0]}</b><span className="mono">{wa[1]}</span></span></div>{(() => {
          const nx = S.filter(s => sgMine(s) && sgState(s) === 'ready').slice(0, 3);
          return <div className="sn-nx">{lbl(`Next for this account · ${mine} ready`)}{nx.length ? nx.map((s, __k) => <button key={__k} className="sn-nr" data-sgstep={s.id}><span className="mono">{s.id}</span><b>{s.t}</b>{ICO.chev || '›'}</button>) : <p className="sn-p">Nothing ready for this account. Switch accounts below.</p>}</div>;
        })()}{LV ? <p className="sn-p">{SG_ACCT[w] ? 'Switch accounts in MetaMask for the other signers’ steps.' : 'The plan names this account for no step. Switch accounts in MetaMask.'}</p> : <label className="sn-sw">{lbl('Switch account in MetaMask')}<select data-sgacct="" defaultValue={w}>{Object.entries(SG_ACCT).filter(([k]) => !['cls', 'cts'].includes(k)).map(([k, a], __k) => <option key={__k} value={k}>{a[0]}{" · "}{a[1].slice(-4)}</option>)}</select></label>}</div> : <div className="sn-wl"><p className="sn-p">Connect MetaMask with the account a step names. Command Center holds no key: MetaMask shows every call for you to confirm.</p><button className="btn p" data-sgconnect="">Connect MetaMask</button><div className="led sn-ck">{[['Network', LV ? 'Base Sepolia only' : 'Base Sepolia or a local chain'], ['Plan', 'Fingerprint must match'], ['Account', 'Must be the step’s signer']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div>, <><span className="sn-g">{w ? 'Refuses other chains · checks the fingerprint' : 'Holds no key · MetaMask signs every call'}</span><span /></>);
      const tl = S.filter(s => s.st === 'D7' || s.kind === 'safe' && /schedule/.test(s.fn));
      const wait = cell('s6', 'Waiting on time', <span className="lbl">7-day timelocks</span>, <div className="sn-tl">{tl.map((s, __k) => {
          const x = sgState(s);
          return <button key={__k} className="sn-tr2" data-sgstep={s.id}><span className="mono">{s.id}</span><span><b>{s.t}</b><span>{SG_ACCT[s.who][0]}</span></span><span className="sn-tw">{x === 'done' || x === 'success' ? 'Done' : s.st === 'D7' ? <><em className="hxw" />7 days after scheduling</> : 'Schedules the wait'}</span></button>;
        })}</div>, <><span>Anyone can still pause during a wait</span><span /></>);
      const jobs = LV ? notReal('s6', 'Standing signing jobs', 'The jobs that need signers after the rollout aren’t in the plan yet.') : cell('s6', 'Standing signing jobs', <span className="lbl">After the rollout</span>, <div className="led sn-jb">{SG.jobs.map(([t, s, n], __k) => <div key={__k}><span><b>{t}</b><em>{s}</em></span><b>{n}</b></div>)}</div>, <><span>Mainnet uses the same loop, with real wallets and Safes</span><span /></>);
      html(document.getElementById('bv'), <>{band(run, 1)}{band(<>{steps}{wal}</>)}{band(<>{wait}{jobs}</>)}</>);
    }
    function sgPanel(id) {
      const s = sgStep(id),
        x = sgState(s),
        a = SG_ACCT[s.who],
        r = SG.sent[s.id],
        mine = sgMine(s);
      const T = s.kind === 'safe' ? ['Planned', 'Ready', 'Queued', 'Owners signed', 'Done'] : ['Planned', 'Ready', 'Sent', 'Confirmed'];
      const at = s.kind === 'safe' ? {
        waiting: 0,
        ready: 1,
        pending: 2,
        success: 4,
        done: 4
      }[x] : {
        waiting: 0,
        ready: 1,
        pending: 2,
        success: 3,
        done: 3,
        failed: 2
      }[x];
      const ft = x === 'ready' && s.kind === 'wallet' ? !SG.wallet ? <><span className="small quiet" style={css("margin-right:auto")}>Connect MetaMask first</span><button className="btn p" data-sgconnect="">Connect MetaMask</button></> : !mine ? <span className="small quiet sn-warn" style={css("margin-right:auto")}>{"Switch MetaMask to "}{a[0]}{" (…"}{a[1].slice(-4)})</span> : <><span className="small quiet" style={css("margin-right:auto")}>{LV && SGL.W.error ? SGL.W.error : 'MetaMask shows the call to confirm'}</span><button className="btn p" data-sgsend={s.id} {...attrs(LV && SGL.W.busy[s.id] ? 'disabled' : '')}>{LV && SGL.W.busy[s.id] ? 'Confirm in MetaMask…' : 'Sign and send'}</button></> : x === 'ready' && s.kind === 'safe' ? <><button className="btn" data-sgdl={s.id}>Download batch file</button><button className="btn p" data-sgsafe={s.id}>{LV ? 'Open in the Safe app' : 'Send to the Safe’s queue'}</button></> : <><span className="small quiet" style={css("margin-right:auto")}>{x === 'waiting' ? LV && (s.dep || []).every(d => ['done', 'success'].includes(sgState(sgStep(d)))) ? 'Waits on time, not on a step: re-run the plan once it’s due' : `Opens when ${(s.dep || []).join(' and ')} ${s.dep && s.dep.length > 1 ? 'are' : 'is'} done` : x === 'pending' ? 'Waiting for the chain' : 'Nothing to send: the chain shows this done'}</span>{x === 'waiting' ? <button className="btn" disabled style={css("opacity:.45;cursor:default")}>{s.kind === 'safe' ? LV ? 'Open in the Safe app' : 'Send to the Safe’s queue' : 'Sign and send'}</button> : ''}</>;
      const nxt = SG.steps.filter(o => o.dep && o.dep.includes(s.id));
      return <>{phd(<><span style={css("text-transform:none")}>{s.id}</span>{" · "}{sgStage(s.st)}</>, <span className={`sn-s ${SGW[x][1]}`} style={css("margin-left:10px")}>{SGW[x][0]}</span>)}<><div className="pn-b"><div><p className="bpn-t">{s.t}</p><p className="bpn-s">{s.x}</p></div><div className="bd-tk">{T.map((t, i) => <span key={i} className={i < at ? 'done' : i === at ? 'now' : ''}><i />{t}</span>)}</div>{s.why && x === 'waiting' ? <p className="bpn-n"><b>Why it waits.</b>{" "}{s.why}</p> : ''}<div className="led">{[['Who signs', <>{sgTag(s.who)}{" "}{a[0]}{" "}<span className="mono quiet">{a[1]}</span></>], ['Contract', s.to ? <><button className="lnk3" data-bctr={s.to}>{ctrOf(s.to)[1]}</button>{/^0x/.test(ctrOf(s.to)[5]) ? <span className="mono quiet">{ctrOf(s.to)[5]}</span> : ''}</> : s.toLbl], ['Function', <span className="mono">{s.fn}</span>], ...(s.dep ? [['After', s.dep.map((d, __k) => <Fragment key={__k}>{__k ? ' · ' : ''}<button className="lnk3" data-sgstep={d}>{d}</button></Fragment>)]] : []), ...(nxt.length ? [['Opens next', nxt.map((o, __k) => <Fragment key={__k}>{__k ? ' · ' : ''}<button className="lnk3" data-sgstep={o.id}>{o.id}</button></Fragment>)]] : []), ...(r && r.hash ? [['Transaction', LV ? <a className="mono" href={SGL.explorerTx(r.hash)} target="_blank" rel="noopener">{SGL.shortA(r.hash)}{" ↗"}</a> : <span className="mono">{r.hash}</span>]] : [])].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div><div>{lbl('Arguments')}<div className="sn-args">{s.args.map(([n, ty, v], __k) => <div key={__k}><span>{n}{" "}<em>{ty}</em></span><span className="mono">{v}</span></div>)}</div></div><details className="sn-cd"><summary>The exact call data</summary><p className="mono">{LV ? s.call.data || 'Not known yet: an earlier step decides it. Re-run the plan script after it.' : <>0x{(s.id + s.fn).split('').map(c => c.charCodeAt(0).toString(16)).join('').slice(0, 136)}…</>}</p></details>{s.kind === 'safe' ? <p className="bpn-w">{LV ? 'The Safe signs this, not MetaMask directly. Command Center downloads it as a Transaction Builder batch and opens the Safe app; its owners sign there.' : 'The Safe signs this, not MetaMask directly. Command Center sends it to the Safe’s queue; its owners sign there.'}</p> : ''}</div><div className="pn-ft">{ft}</div></></>;
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
        n = LV.onMap,
        pct = n ? LV.deployed / n * 100 : 0;
      const BR = {
        overview: <>{safeLine()}{" "}{!REPOS[0].full ? 'GitHub isn’t connected yet.' : open.length ? `${plural(open.length, 'change is', 'changes are')} open on ${REPOS[0].full}.` : `Nothing is open on ${REPOS[0].full}.`}</>,
        changes: `${CHANGES.filter(c => c.st === 'review').length} in review and ${CHANGES.filter(c => c.st === 'safe').length} in the Ops Safe. ${CHANGES.filter(c => c.st === 'shipped').length} shipped in the last 7 days.`,
        contracts: <>{LV.chain.network ? `${LV.deployed} of ${n} contracts are found on ${net()}.` : 'The chain isn’t indexed yet.'}{" "}{next ? <><a data-bopen={next.id}>{next.t}</a>{" is next: "}{next.state}.</> : safeLine()}</>,
        signing: sgBriefLive(),
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
      // one bar across the card, a segment a stage in order, coloured as its numbered chip, the name and count inside as Money's
      // Where it sits draws them. Widths go by the square root of each count, so a stage of one still reads beside a hundred;
      // the counts themselves are printed. A segment too narrow for the name keeps the count (live.css); an empty stage is a hairline
      const strip = <div className="bd-fz">{STAGES.map(([k, t], i) => {
          const n = cnt(k);
          return <button key={k} className={`bd-fz-s ${k}`} data-btab="changes" style={css(n ? `flex:${Math.sqrt(n).toFixed(3)} 1 0` : 'flex:0 0 2px')} title={`${i + 1} · ${t} · ${n}`}>{n ? <span><em>{t}</em><b>{n}</b></span> : ''}</button>;
        })}</div>;
      const flow = cell('s7', 'From change to live', <span className="lbl">{RSHORT.proto}{" and the Ops Safe"}</span>, <><div className="bd-fl">{steps.map(([k, t, n, s2], i) => <button key={i} className={`bd-fs ${k}`} data-btab="changes"><div className="bd-fh"><span className="bd-fn">{i + 1}</span><b>{t}</b>{i < 3 ? <span className="bd-fa"><i />{ICO.arrow}</span> : ''}</div><span className="m-big">{n}</span><span className="bd-ft">{s2}</span></button>)}</div>{strip}<div className="bd-lw">{lbl('Longest in its stage')}{long.length ? long.map(([id, s2, d2], __k) => {
            const c = CHG[id];
            return <button key={__k} className="bd-lw-r" data-bopen={id}><span><b>{c.t}</b><em>{s2}{need(c) ? ' · waiting on you' : c.block ? ' · ' + c.block.toLowerCase() : ''}</em></span><b>{d2}</b></button>;
          }) : <div className="bd-e">Nothing in flight</div>}</div></>, <><span>Contract changes go through the Ops Safe</span><span /></>);
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
      const roles = kr ? cell('s5', 'Who can do what', <span className="lbl">Every contract’s roles</span>, <div className="bd-ro"><div className="bd-ro-r bd-ro-x"><span />{kr.holders.map((t, __k) => <span key={__k} title={t}><em>{t}</em></span>)}</div>{kr.roles.map(([t, h], __k) => <div key={__k} className="bd-ro-r"><span>{t}</span>{kr.holders.map((_, j) => <i key={j} className={`${h[j] ? 'on' : ''} ${h[j] > 1 ? 'nx' : ''}`} />)}</div>)}</div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />Holds it</span><span><i className="hx" />Not yet</span></span><span /></>) : notReal('s5', 'Who can do what', 'Needs AccessManager’s roles read from the chain: who may upgrade, pause, mint credit and claim from the AssurancePool.');
      const aux = LV.CTR_AUX ? cell('s7', 'Timelocks and helpers', <span className="lbl">{`${LV.CTR_AUX.length} in the records`}</span>, <div className="bd-xl">{LV.CTR_AUX.map(([n, a, d, w], __k) => <div key={__k} className="bd-xr"><span className="bd-xk"><b>{n}</b><span>{d}</span></span><span className="bd-xw">{w}</span><span className="mono bd-xa">{a}</span></div>)}</div>, <><span>Every timelock waits 7 days and has no admin to shorten it</span><span /></>) : notReal('s7', 'Timelocks and helpers', 'Read from deployments/base-sepolia by name, once the API sends them.');
      const old = LV.CTR_OLD ? cell('s5', 'Retired', <span className="lbl">Kept on record</span>, <div className="bd-xl">{LV.CTR_OLD.map(([n, a, d], __k) => <div key={__k} className="bd-xr two"><span className="bd-xk"><b>{n}</b><span>{d}</span></span><span className="mono bd-xa">{a}</span></div>)}{LV.CTR_OLD_N ? <p className="bd-xn">{"And "}{LV.CTR_OLD_N}{" earlier copies from before the audit fixes, each replaced by the address on the map. Nothing points to them."}</p> : ''}</div>, <><span>Records stay in deployments/base-sepolia</span><span /></>) : notReal('s5', 'Retired', 'Read from deployments/base-sepolia by name, once the API sends them.');
      html(document.getElementById('bv'), <>{band(map, 1)}{band(<>{aux}{old}</>)}{band(<>{safe}{signers}</>)}{band(<>{rel}{roles}</>)}</>);
      flowMount();
    }
    /* ── Signing, live (signingLive.ts): the committed plan, checked, then sent from MetaMask or the Safe app ── */
    function sgLiveShell() {
      return { plan: null, f: 'all', wallet: null, sent: {}, steps: [], byId: {}, jobs: [], load: 'reading', err: '', raw: null };
    }
    /** A checked plan in place: its accounts, stages and steps, and what this browser already sent for it. */
    function sgAdopt(p, file) {
      const g = SGL.sgFromPlan(p, file, name => (CTR.find(c => c[1] === name) || [])[0] || null);
      for (const k of Object.keys(SG_ACCT)) delete SG_ACCT[k];
      Object.assign(SG_ACCT, g.accts);
      SG_STAGES.splice(0, SG_STAGES.length, ...g.stages);
      Object.assign(SG, { plan: g.plan, steps: g.steps, byId: Object.fromEntries(g.steps.map(x => [x.id, x])), sent: SGL.loadSent(p.stepsSha256), raw: p, load: 'ok', err: '' });
      Object.entries(SG.sent).forEach(([id, r]) => r.state === 'pending' && sgPoll(id));
    }
    /** The plan the API sends (contractsSection's SIGNING): checked here as the signing page checks it. */
    async function sgLoad() {
      const P = LV.SIGNING;
      if (!P || !P.plan) {
        SG.load = P && P.runLog ? 'runlog' : 'none';
        return;
      }
      const v = await SGL.verifyPlan(P.plan);
      if ('error' in v) Object.assign(SG, { load: 'error', err: v.error });
      else sgAdopt(v.plan, P.file || 'deployments/base-sepolia/signing-plan.json');
    }
    /** Before a plan is in place: reading, refused, only the run log, or none committed. */
    function sgNoPlan() {
      const P = LV.SIGNING;
      if (SG.load === 'reading') return cell('s12', 'Signing run', <span className="lbl">Reading the plan</span>, <div className="bk-empty">Checking the plan’s fingerprint…</div>, <span />);
      if (SG.load === 'error') return cell('s12', 'Signing run', <span className="lbl">Refused</span>, <div className="bk-empty">{SG.err}</div>, <><span>Nothing can be sent from a plan that fails its checks</span><span className="sn-fa"><label className="btn">Load a plan<input type="file" accept=".json,application/json" data-sgload="" hidden /></label></span></>);
      if (SG.load === 'runlog') {
        const R = P.runLog,
          n = k => R.steps.filter(x => x.status === k).length;
        return cell('s12', 'Signing run', <span className="lbl">{`From the run log · ${R.file}`}</span>, <div className="led sn-jb">{R.steps.map((x, __k) => <div key={__k}><span><b className="mono">{x.id}</b><em>{x.why || ''}</em></span><b>{x.status === 'done' ? 'Done' : x.status === 'ready' ? 'Ready' : 'Waiting'}</b></div>)}</div>, <><span>{`${n('done')} done · ${n('ready')} ready · ${n('waiting')} waiting. Titles and calls come with the committed plan (deployments/base-sepolia/signing-plan.json).`}</span><span className="sn-fa"><label className="btn">Load a plan<input type="file" accept=".json,application/json" data-sgload="" hidden /></label></span></>);
      }
      return notReal('s12', 'Signing run', 'No signing plan is committed yet: run scripts/signing_plan.ts and commit deployments/base-sepolia/signing-plan.json, or load a plan here.');
    }
    function sgBriefLive() {
      if (SG.load !== 'ok') return SG.load === 'error' ? 'The signing plan was refused: its checks failed.' : SG.load === 'reading' ? 'Reading the signing plan.' : 'No signing plan is committed yet.';
      const st = s => sgState(s),
        r = SG.steps.filter(s => st(s) === 'ready').length,
        m = SG.steps.filter(s => sgMine(s) && st(s) === 'ready').length,
        d = SG.steps.filter(s => ['done', 'success'].includes(st(s))).length,
        w = SG.steps.filter(s => st(s) === 'waiting');
      return r ? `The Base Sepolia rollout has ${plural(r, 'step', 'steps')} ready to sign${SG.wallet ? `, ${m} of them for the connected account` : ''}. Safe steps are signed in the Safe app; everything else in MetaMask.` : `${d} of ${SG.steps.length} steps are done.${w.length ? ` ${plural(w.length, 'step waits', 'steps wait')}: ${w.map(s => s.id).join(', ')}.` : ''}`;
    }
    /** Follows a sent step until the wallet's node has its receipt. */
    function sgPoll(id, tries = 0) {
      const r = SG.sent[id];
      if (!r || r.state !== 'pending' || !r.hash) return;
      SGL.receipt(r.hash).then(x => {
        if (!x) return setTimeout(() => sgPoll(id, tries + 1), tries < 30 ? 2000 : 6000);
        Object.assign(r, x);
        SGL.saveSent(SG.raw.stepsSha256, SG.sent);
        if (B.tab === 'signing') render();
        toast(x.state === 'success' ? `${id} confirmed on Base Sepolia` : `${id} failed on chain · nothing changed`);
      }).catch(() => setTimeout(() => sgPoll(id, tries + 1), 6000));
    }
    async function sgLiveAct(d) {
      if (d.sgconnect !== undefined) {
        await SGL.connect();
        SG.wallet = SGL.W.account;
        if (SG.wallet) SG.f = 'mine';
        render();
        return toast(SGL.W.error || (SG.wallet ? `Connected ${SG_ACCT[SG.wallet] ? SG_ACCT[SG.wallet][0] : SGL.shortA(SG.wallet)} on Base Sepolia` : 'Not connected'));
      }
      const s = SG.byId[d.sgsend || d.sgsafe || d.sgdl];
      if (d.sgsend && s) {
        if (SGL.W.busy[s.id]) return;
        SGL.W.busy[s.id] = true;
        render();
        const h = await SGL.send(s.call);
        SGL.W.busy[s.id] = false;
        if (!h) {
          render();
          return toast(SGL.W.error || 'Not sent: connect the account this step names, on Base Sepolia');
        }
        SG.sent[s.id] = { hash: h, state: 'pending', at: new Date().toISOString() };
        SGL.saveSent(SG.raw.stepsSha256, SG.sent);
        render();
        sgPoll(s.id);
        return toast(`Sent ${s.id} · waiting for the chain`);
      }
      if ((d.sgdl || d.sgsafe) && s) {
        if (!s.call.data) return toast('Its call isn’t known yet: re-run the plan script after the steps before it');
        SGL.downloadBatch(s.call, SG.raw);
        if (d.sgsafe) window.open(SGL.safeAppUrl(s.call), '_blank', 'noopener');
        return toast(d.sgsafe ? `Downloaded signing-${s.id}.json · drop it into the Safe app’s Transaction Builder; its owners sign there` : `Downloaded signing-${s.id}.json for the Safe’s Transaction Builder`);
      }
      if (d.sgrecheck !== undefined) {
        // what this browser sent, from the wallet's node; then the plan again (the API reads the committed one)
        let n = 0;
        for (const [id, r] of Object.entries(SG.sent))
          if (r.state === 'pending' && r.hash) {
            const x = await SGL.receipt(r.hash).catch(() => null);
            if (x) {
              Object.assign(r, x);
              n++;
            }
          }
        if (SG.raw) SGL.saveSent(SG.raw.stepsSha256, SG.sent);
        await reloadSection('build').catch(() => null);
        return toast(`Read again${n ? ` · ${n} sent ${n === 1 ? 'step' : 'steps'} settled` : ''} · steps turn done when the plan script is re-run and committed`);
      }
    }
    if (LV) {
      SGL.listen(() => {
        SG.wallet = SGL.W.account;
        if (B.tab === 'signing') render();
      });
      Promise.all([SGL.readWallet(), sgLoad()]).then(() => {
        SG.wallet = SGL.W.account;
        if (B.tab === 'signing') render();
      });
    }
    /** The map's heading, live: the timelocks the deployment records name. */
    function mapSafeLive() {
      const tl = LV.TIMELOCKS;
      if (!tl || !tl.length) return <><b>Timelocks</b><span>Not read from the deployment records yet</span></>;
      const N = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'][tl.length] || String(tl.length);
      return <><b>{`${N} 7-day ${tl.length === 1 ? 'timelock' : 'timelocks'}`}</b><span>{tl.map(n => n.replace(/Timelock$/, '')).join(' · ')}{" — every upgrade and setting waits 7 days, proposed by its owner’s Safe"}</span></>;
    }
    /** Security's automatic jobs, live: each job's own status, "Not on yet" until its env is set. */
    function autoCell() {
      const A = LV.AUTO;
      if (!A) return notReal('s12', 'Automatic jobs', 'Read from each job’s own status (payout top-ups, the Assurance fee payer, the payout funding keeper), once the API sends it.');
      return cell('s12', 'Automatic jobs', <span className="lbl">{A.length}{" jobs · "}{A.filter(j => j.w !== 'No wallet').length}{" hold a wallet"}</span>, <div className="bd-aj"><div className="bd-aj-r bd-aj-h"><span>Job</span><span>Wallet</span><span>Most it can move</span><span>Last run</span><span>Off switch</span></div>{A.map((j, __k) => <div key={__k} className="bd-aj-r"><span><b>{j.t}</b><em>{j.d}</em></span><span><b>{j.w}</b><em className="mono">{j.a}</em></span><span><b>{j.lim[0]}</b><em>{j.lim[1]}</em></span><span><b><i className={`bd-aj-d ${j.st}`} />{j.run[0]}</b><em>{j.run[1]}</em></span><span><b className={j.off[0].includes('_') ? 'mono' : ''}>{j.off[0]}</b><em>{j.off[1]}</em></span></div>)}</div>, <><span>The two that move money stop on any revert until a person clears it · this app never holds their keys</span><button data-bgo="money">Money →</button></>);
    }
    function renderDeploysLive() {
      const env = cell('s12', 'Where it runs', <span className="lbl">{plural(REPOS.length, 'project', 'projects')}{" · 3 environments"}</span>, <div className="bd-en"><div className="bd-en-r bd-en-x"><span />{ENVS.map(([k, t, s], __k) => <span key={__k}><b>{t}</b><em>{k === 'test' ? LV.chain.network || 'Not indexed yet' : k === 'prod' ? 'Mainnet' : s}</em></span>)}</div>{REPOS.map((r, __k) => <div key={__k} className="bd-en-r"><button className="bd-en-k" data-brepo={r.id}><b>{RSHORT[r.id]}</b><span>{r.path}{" · "}{r.lang}</span></button>{ENVS.map(([k], __k) => {
            const [v, s, st] = ENV[r.id][k];
            return <span key={__k} className={`bd-en-c ${st}`}><i /><span><b>{v}</b><em>{s}</em></span></span>;
          })}</div>)}</div>, <><span className="f-key"><span><i style={css("background:var(--settled)")} />Running</span>{LV.RUN_ON ? <><span><i style={css("background:var(--underway)")} />Building</span><span><i style={css("background:var(--absent)")} />Failed</span></> : ''}<span><i style={css("box-shadow:inset 0 0 0 1px var(--hair)")} />Not read yet</span></span><span>{LV.RUN_NOTE}</span></>);
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
      html(document.getElementById('bv'), <>{band(<>{fnd}{aud}</>, 1)}{band(<>{keys}{inc}</>)}{band(autoCell())}</>);
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
      html(pn, P.sg ? sgPanel(P.sg) : P.ch ? chPanel(CHG[P.ch]) : P.ctr ? ctrPanel(P.ctr) : P.find ? findPanel(FINDINGS.find(f => f.id === P.find)) : P.inc ? incPanel(INCIDENTS.find(i => i.id === P.inc)) : '');
    }
    const phd = (k, x = '') => <div className="pn-hd"><span className="lbl">{k}</span>{x}<button className="x" data-bclose="" aria-label="Close">{ICO.x}</button></div>;
    function track(c) {
      const T = c.kind === 'code' ? c.repo === 'proto' ? ['Draft', 'Review', 'Merged', 'Testnet'] : ['Draft', 'Review', 'Merged', 'Deployed'] : c.kind === 'upgrade' ? ['Pull request', 'Merged', SAFE_OF(c.contract), '7-day wait', 'Live'] : ['Proposed', SAFE_OF(c.contract), '7-day wait', 'Live'];
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
      return <>{phd(c.kind === 'upgrade' ? 'Contract upgrade' : c.kind === 'setting' ? 'On-chain setting' : 'Pull request', c.repo ? rtag(c.repo) : '')}<><div className="pn-b"><div><p className="bpn-t">{c.t}</p><p className={`bpn-s ${n ? 'me' : ''}`}>{stateTxt(c)}</p></div>{track(c)}{c.note ? <p className="bpn-n">{c.note}</p> : ''}<div className="led">{rows.map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{n === 'review' && B.rej ? <label>{lbl('What should change')}<textarea id="brej" className="vin" rows="3" placeholder={`Tell ${who(c.by).split(' ')[0]} what to fix`} /></label> : ''}{n === 'sign' ? <p className="bpn-w"><b>Your signature makes it 2 of 2.</b>{" Then the timelock’s 7-day wait before it goes live, so members and anyone watching can see it coming."}</p> : ''}</div><div className="pn-ft">{ft}</div></></>;
    }
    function ctrPanel(id) {
      const c = ctrOf(id),
        rel = RELEASES[id] || [],
        ins = REL.filter(r => r[1] === id),
        outs = REL.filter(r => r[0] === id),
        ch = CHANGES.filter(x => x.contract === id && x.st !== 'shipped'),
        f = FINDINGS.filter(x => x.contract === id && x.st !== 'fixed' && x.st !== 'accepted');
      return <>{phd(c[9] === 'p' ? 'Controls and rules' : LAYERS[c[3]], <span className="fst" style={css("margin-left:8px")}>{c[4] === 'live' ? 'Live' : 'Not deployed'}</span>)}<><div className="pn-b"><div><p className="bpn-t">{c[1]}{" "}<span className="mono quiet" style={css("font-size:15px")}>{c[2]}</span></p><p className="bpn-s">{c[6]}</p></div><div className="led">{[['Address', <span className="mono">{c[5]}</span>], ['Roles held by', CTRL[c[10]] || '—'], ['Changed through', TLTXT(c[0])], ...ins.map(r => [RK[r[2]], `${ctrOf(r[0])[1]} ${r[3]}`]).slice(0, 6), ...outs.map(r => [RK[r[2]], `${r[3]} → ${ctrOf(r[1])[1]}`]).slice(0, 6)].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{rel.length ? <div>{lbl('Releases')}<div className="bd-pr">{rel.slice().reverse().map(([v, t], i) => <div key={i}><span className="mono">{v}</span><span>{fmtD(t)}</span><span>{i === 0 ? 'Live' : ''}</span></div>)}</div></div> : ''}{ch.length ? <div>{lbl('In flight')}{ch.map((x, __k) => <button key={__k} className="bd-pl" data-bopen={x.id}><b>{x.t}</b><span>{stateTxt(x)}</span></button>)}</div> : ''}{f.length ? <div>{lbl('Open findings')}{f.map((x, __k) => <button key={__k} className="bd-pl" data-bfind={x.id}><b><span className={`bd-sev ${x.sev}`}>{SEV[x.sev][0]}</span>{" "}{x.t}</b><span>{FSTATE[x.st][0]}</span></button>)}</div> : ''}</div><div className="pn-ft"><span className="small quiet" style={css("margin-right:auto")}>Changes start as a pull request</span>{c[4] === 'live' && SIGNER() ? <button className="btn dz" data-bpause={id}>Propose a pause</button> : ''}</div></></>;
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
        signing: renderSigning,
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
    document.addEventListener('change', e => {
      const t = e.composedPath ? e.composedPath()[0] : e.target;
      if (!t || !t.dataset) return;
      if (t.dataset.sgacct !== undefined) {
        SG.wallet = t.value;
        render();
        return toast(`MetaMask switched to ${SG_ACCT[t.value][0]}`);
      }
      if (t.dataset.sgload !== undefined && t.files && t.files[0]) {
        const f = t.files[0],
          rd = new FileReader();
        rd.onload = async () => {
          let p;
          try {
            p = JSON.parse(String(rd.result));
          } catch (err) {
            return toast('That file is not JSON');
          }
          if (LV) {
            const v = await SGL.verifyPlan(p);
            if ('error' in v) return toast(v.error);
            sgAdopt(v.plan, f.name);
            render();
            return toast(`Loaded ${f.name} · ${p.steps.length} steps · fingerprint checked`);
          }
          if (!p || p.format !== 'clear-signing-plan/1' || !Array.isArray(p.steps)) return toast('Not a signing plan: it should come from scripts/signing_plan.ts');
          if (p.chainId !== 84532 && p.chainId !== 31337) return toast(`Refused: this plan is for chain ${p.chainId}`);
          try {
            const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(p.steps)));
            const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
            if (hex !== p.stepsSha256) return toast('Refused: the steps do not match the plan’s fingerprint. Re-run the plan script.');
          } catch (err) {}
          SG.plan.file = f.name;
          render();
          toast(`Loaded ${f.name} · ${p.steps.length} steps`);
        };
        rd.readAsText(f);
      }
    }, true);
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
      if (d.ctr && ctrOf(d.ctr)) {
        B.panel = {
          ctr: d.ctr
        };
        return render();
      }
      if (d.sgf) {
        SG.f = d.sgf;
        return render();
      }
      if (d.sgstep) {
        B.panel = {
          sg: d.sgstep
        };
        return render();
      }
      if (LV && (d.sgconnect !== undefined || d.sgsend || d.sgsafe || d.sgdl || d.sgrecheck !== undefined)) return void sgLiveAct(d);
      if (d.sgconnect !== undefined) {
        SG.wallet = 'dep';
        SG.f = 'mine';
        render();
        return toast('Connected MetaMask · Deployer on Base Sepolia (demo)');
      }
      if (d.sgsend) {
        const st = sgStep(d.sgsend),
          h = '0x' + Math.random().toString(16).slice(2, 10) + '…' + Math.random().toString(16).slice(2, 6);
        SG.sent[st.id] = {
          state: 'pending',
          hash: h
        };
        logIt(`Signed ${st.id} · ${st.t}`, `${SG_ACCT[st.who][0]} · Base Sepolia`, 'done');
        render();
        setTimeout(() => {
          SG.sent[st.id].state = 'success';
          SG.steps.filter(x => x.dep && x.dep.includes(st.id) && x.dep.every(dd => ['done', 'success'].includes(sgState(sgStep(dd))))).forEach(x => {
            x.ready_after = true;
          });
          if (B.tab === 'signing') render();
        }, 2200);
        return toast(`Sent ${st.id} · waiting for the chain`);
      }
      if (d.sgsafe) {
        const st = sgStep(d.sgsafe);
        SG.sent[st.id] = {
          state: 'pending'
        };
        closeB();
        render();
        return toast(`${st.id} sent to the ${SG_ACCT[st.who][0].split(' ·')[0]}’s queue · its owners sign in the Safe`);
      }
      if (d.sgdl) {
        const st = sgStep(d.sgdl);
        return toast(`Downloaded signing-${st.id}.json for the Safe’s Transaction Builder`);
      }
      if (d.sgrecheck !== undefined) {
        Object.values(SG.sent).forEach(r => {
          if (r.state === 'pending') r.state = 'success';
        });
        SG.steps.forEach(s => {
          if (s.status === 'waiting' && s.dep && s.dep.every(dd => ['done', 'success'].includes(sgState(sgStep(dd))))) s.status = 'ready';
        });
        SG.plan.block += 412;
        SG.plan.generated = NOW;
        render();
        return toast('Read the chain again · the plan is up to date');
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
        logIt(`Signed “${c.t}”`, 'Second of two signatures. Live after the 7-day wait.', 'approved');
        c.sigs[B.me] = NOW;
        c.wait = NOW + 7 * DAY;
        delete c.need;
        FINDINGS.filter(f => f.fix === c.id).forEach(f => {
          f.st = 'fixing';
        });
        closeB();
        render();
        return toast(`Signed · ${c.t} goes live ${WD(c.wait)} ${hm(c.wait)} after the 7-day wait · logged in Records`);
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
    const TABS = ['overview', 'changes', 'contracts', 'signing', 'deploys', 'security'],
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
