// `npm test -w @clear/docs`: slugs, link resolution, the nav-completeness check, and a full build
// checked page by page.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { assertNavComplete, buildSite, builtPaths, NavError, REPO } from '../src/lib/build.mjs';
import { COUNSEL, renderMarkdown } from '../src/lib/markdown.mjs';
import { checkNav, entriesOf, resolveLink, slug, slugger } from '../src/lib/site.mjs';
import { NAV, SIGN_IN } from '../src/nav.mjs';

const GH = 'https://github.com/Deed3Labs/Protocol-Contracts/';

describe('slugs match GitHub', () => {
  test('punctuation is dropped, each space is a hyphen', () => {
    assert.equal(slug("The co-op's structure"), 'the-co-ops-structure');
    assert.equal(slug('Going live: environments, providers, webhooks'), 'going-live-environments-providers-webhooks');
    assert.equal(slug('1. Mint'), '1-mint');
    assert.equal(slug('DeedNFT roles'), 'deednft-roles');
    assert.equal(slug('Owed and held'), 'owed-and-held');
    assert.equal(slug('Pay now — or over time'), 'pay-now--or-over-time');
    assert.equal(slug('snake_case stays'), 'snake_case-stays');
  });
  test('repeats are numbered', () => {
    const s = slugger();
    assert.deepEqual(['Roles', 'Roles', 'Roles', 'Roles-1'].map(s), ['roles', 'roles-1', 'roles-2', 'roles-1-1']);
  });
  test('rendered headings carry the slug the docs link to', () => {
    const r = renderMarkdown('# Title\n\nLede.\n\n## How the `DeedNFT` connects\n\nText.\n\n### Step 1: mint\n', { file: 'docs/x.md', byFile: {} });
    assert.equal(r.title, 'Title');
    assert.deepEqual(r.toc, [{ id: 'how-the-deednft-connects', label: 'How the DeedNFT connects' }]);
    assert.ok(r.blocks.some((b) => b.html.startsWith('<h3 id="step-1-mint">')));
  });
});

describe('links resolve', () => {
  const entries = entriesOf(NAV);
  const byFile = Object.fromEntries(entries.filter((e) => e.file).map((e) => [e.file, e]));
  const from = 'docs/members/credit.md';
  test('a doc in the nav becomes its site URL, anchor kept', () => {
    assert.equal(resolveLink('./getting-started.md#face-id-for-payments', from, byFile, REPO).href, '/members/getting-started#face-id-for-payments');
    assert.equal(resolveLink('../governance/structure.md', from, byFile, REPO).href, '/governance/structure');
  });
  test('a README or its folder is the section page', () => {
    assert.equal(resolveLink('../protocol/README.md#the-deed-track', from, byFile, REPO).href, '/protocol#the-deed-track');
    assert.equal(resolveLink('../governance/', from, byFile, REPO).href, '/governance');
  });
  test('the Pay with Clear docs live under /pay', () => {
    assert.equal(resolveLink('../../apps/member/public/docs/api.md', 'docs/developers/README.md', byFile, REPO).href, '/pay/api');
  });
  test('repo files outside the site go to GitHub', () => {
    assert.equal(resolveLink('../../README.md#deployed-addresses', from, byFile, REPO).href, `${GH}blob/dev/README.md#deployed-addresses`);
    assert.equal(resolveLink('../../contracts/', from, byFile, REPO).href, `${GH}tree/dev/contracts`);
    assert.equal(resolveLink('../archive/README.md', from, byFile, REPO).href, `${GH}blob/dev/docs/archive/README.md`);
  });
  test('the docs index is the home page; URLs and same-page anchors are left alone', () => {
    assert.equal(resolveLink('../README.md', from, byFile, REPO).href, '/');
    assert.equal(resolveLink('https://useclear.org/coop', from, byFile, REPO).href, 'https://useclear.org/coop');
    assert.equal(resolveLink('#repaying', from, byFile, REPO).href, '#repaying');
  });
  test('a target that does not exist is flagged', () => {
    assert.equal(resolveLink('./nope.md', from, byFile, REPO).missing, true);
  });
});

describe('the nav is complete', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'clear-docs-nav-'));
    mkdirSync(join(dir, 'docs/a'), { recursive: true });
    writeFileSync(join(dir, 'docs/a/README.md'), '# A\n');
    writeFileSync(join(dir, 'docs/a/listed.md'), '# Listed\n');
    writeFileSync(join(dir, 'docs/a/forgotten.md'), '# Forgotten\n');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));
  const nav = [{ id: 'a', name: 'A', icon: '', groups: [['G', ['docs/a/README.md', 'docs/a/listed.md', 'docs/a/gone.md']]] }];

  test('reports files the nav names that do not exist, and published files it leaves out', () => {
    const r = checkNav(dir, nav, ['docs/a']);
    assert.deepEqual(r.missing, ['docs/a/gone.md']);
    assert.deepEqual(r.unlisted, ['docs/a/forgotten.md']);
  });
  test('fails the build with the list', () => {
    assert.throws(() => assertNavComplete(dir, nav, ['docs/a']), (e) => e instanceof NavError && /gone\.md/.test(e.message) && /forgotten\.md/.test(e.message));
  });
  test('the real nav names every published page and nothing that is missing', () => {
    assert.deepEqual(checkNav(REPO, NAV), { missing: [], unlisted: [], duplicates: [] });
  });
  test('Contracts lists exactly docs/protocol/contracts', () => {
    const group = NAV.find((s) => s.id === 'protocol').groups.find(([g]) => g === 'Contracts')[1];
    const files = readdirSync(join(REPO, 'docs/protocol/contracts')).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => `docs/protocol/contracts/${f}`);
    assert.deepEqual([...group].sort(), files.sort());
    assert.equal(group.length, 36);
  });
});

describe('the built site', () => {
  let out;
  let result;
  const pages = new Map();
  before(() => {
    out = mkdtempSync(join(tmpdir(), 'clear-docs-dist-'));
    result = buildSite({ out, log: () => {} });
    for (const p of builtPaths(out)) pages.set(p, readFileSync(join(out, p === '/' ? '' : p, 'index.html'), 'utf8'));
  });
  after(() => rmSync(out, { recursive: true, force: true }));

  test('every nav page is built, and nothing else', () => {
    const want = ['/', ...entriesOf(NAV).filter((e) => e.kind !== 'L').map((e) => `/${e.id}`)].sort();
    assert.deepEqual([...pages.keys()], want);
  });
  test(`no page contains "${COUNSEL}"`, () => {
    for (const [p, html] of pages) assert.ok(!html.includes(COUNSEL), p);
    const r = renderMarkdown(`# T\n\nLede.\n\nA term ${COUNSEL} here.\n`, { file: 'docs/x.md', byFile: {} });
    assert.ok(!r.blocks.map((b) => b.html).join('').includes(COUNSEL));
    assert.match(r.blocks[0].html, /class="i-flag">Counsel to review</);
  });
  test('every link inside the site lands on a built page and an existing heading', () => {
    const ids = (html) => new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    const broken = [];
    for (const [p, html] of pages) {
      for (const [, href] of html.matchAll(/href="(\/[^"]*)"/g)) {
        if (/^\/(assets|brand)\//.test(href)) continue;
        const [path, anchor] = href.split('#');
        const target = pages.get(path);
        if (!target) broken.push(`${p} -> ${href}`);
        else if (anchor && !ids(target).has(decodeURIComponent(anchor))) broken.push(`${p} -> ${href} (no heading)`);
      }
      for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) if (anchor !== 'main' && !ids(html).has(decodeURIComponent(anchor))) broken.push(`${p} -> #${anchor}`);
    }
    assert.deepEqual(broken, []);
    assert.deepEqual(result.warnings, { anchors: [], unresolved: [] });
  });
  test('pages have their title, source link and date line', () => {
    assert.match(pages.get('/governance/structure'), /<title>The co-op's structure · Clear docs<\/title>/);
    assert.match(pages.get('/protocol/contracts/LendingPool'), /<title>LendingPool · Clear docs<\/title>/);
    assert.match(pages.get('/protocol/contract-map'), /<title>Contract map · Clear docs<\/title>/);
    assert.match(pages.get('/governance/structure'), /href="https:\/\/github\.com\/Deed3Labs\/Protocol-Contracts\/blob\/dev\/docs\/governance\/structure\.md">View source/);
    assert.match(pages.get('/governance/structure'), /aria-label="Pages that point here"/);
    assert.match(pages.get('/governance/structure'), /class="cd-orgf"/);
    assert.match(pages.get('/protocol/deed-track/protocol-overview'), /data-map="deed"/);
  });
  test('locked areas link to the sign-in and publish nothing', () => {
    const home = pages.get('/');
    assert.ok(home.includes(`class="cd-door-staff" href="${SIGN_IN}"`));
    for (const [p, html] of pages) {
      assert.ok(!/poster route|Sign up a shop|Fix a Clear Point|Two-person approvals/i.test(html), p);
      assert.ok(!/Did this help/.test(html), p);
    }
    assert.ok(!pages.has('/data-room') && !pages.has('/terms-room') && !pages.has('/staff'));
    assert.match(pages.get('/investors'), new RegExp(`href="${SIGN_IN}" data-locked>Data room`));
  });
});
