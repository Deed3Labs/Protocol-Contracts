// @ts-nocheck: reads the section data the API fills, which is untyped, as the sections are.
import { CH, CH_DONE, CHAIN, CODE, CTR, CTR_NOTE, DAY, KEY_ROLES, REL, RELEASES, SIGNERS, SIGN_W, TODAY, vars } from './data';

/*
 * Build's datasets, live (build2.tsx reads these in place of the reference's when REAL): built from what
 * the API's contracts section sends (live/sections.ts fills ./data from it: the map and its releases from
 * the indexer, the code changes and the Code tab's commits and pull requests from the GitHub poller) and
 * the Ops Safe (GET /safe, GET /safe/outbox, loaded with the section). People are only who the data names:
 * you, the Safe's owners, and the GitHub authors. What nothing records yet is empty, never the
 * reference's: check runs, the apps' deploys and review state (docs/ui-redesign-plan.md, gaps). Incidents,
 * findings and audits are Command's own records (migration 0066), written from Build itself.
 */

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
// the first and last word's first letters; quotes and other marks aren't words (Isaiah "KyngKai" Litt is IL)
const initials = (n) => {
  const w = (n || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return (w.length > 1 ? [w[0], w.at(-1)] : w).map((x) => x[0].toUpperCase()).join('') || '?';
};
/** The section an on-chain act was asked for in, as the page names it. */
/** A layer the map has a column for. */
const LAYER_OK = (l) => Number.isInteger(l) && l >= 0 && l <= 4;
const FROM = { merchants: 'Merchants', money: 'Money', contracts: 'Build', governance: 'Governance' };

export function buildLive() {
  const NOW = vars.contractsNow ?? Date.now();
  const me = vars.me;
  const meKey = me?.id ?? 'viewer';
  const safe = vars.safe?.configured ? vars.safe : null;
  const mine = safe?.owners.find((o) => o.you)?.address ?? null;

  /* people: you, the Safe's owners, the GitHub authors; nobody else */
  const PPL = {
    [meKey]: me ? { n: me.name || me.email, ini: initials(me.name || me.email), role: 'You', eng: true, signer: !!mine } : { n: 'Viewer', ini: 'VW', role: 'Read-only' },
    anon: { n: 'Someone', ini: '·' },
  };
  const byAddr = {};
  const SIGNER_KEYS = (safe?.owners ?? []).map((o) => {
    const k = o.you ? meKey : (o.person?.id ?? o.address);
    if (!o.you) PPL[k] = { n: o.person?.name || short(o.address), ini: o.person ? initials(o.person.name) : '0x', role: o.person ? 'Signer' : 'Not linked to anyone here', signer: true };
    byAddr[o.address.toLowerCase()] = k;
    return k;
  });
  /** An address as a person: an owner's key, else the address itself. */
  const addrKey = (a) => {
    if (!a) return 'anon';
    const k = byAddr[a.toLowerCase()];
    if (k) return k;
    PPL[a] ??= { n: short(a), ini: '0x' };
    return a;
  };
  /** A name the data gives (a GitHub login, a commit's author, an outbox row's asker) as a person. */
  const named = (n, login = '') => {
    if (!n && !login) return 'anon';
    if (me && (n === me.name || n === me.email)) return meKey;
    const k = 'gh:' + (login || n);
    PPL[k] ??= { n: n || login, ini: initials(n || login), role: 'GitHub', eng: true };
    return k;
  };
  // a GitHub login's name, from the contributors (the poller keeps the commit's name beside its login)
  const nameOf = Object.fromEntries((CODE.contributors ?? []).map((c) => [c.who, c.name]));

  /* the map's contracts: the API's, live when the indexer found them deployed */
  const dep = Array.isArray(vars.contractsDeployed) ? new Set(vars.contractsDeployed) : new Set();
  // a contract the indexer hasn't found has no version or address of its own (the map's are the structure's)
  const CT = CTR.map((c) => (dep.has(c[0]) ? [c[0], c[1], c[2], c[3], 'live', c[5], c[6], c[7], c[8], c[9]] : [c[0], c[1], '—', c[3], 'later', '—', c[6], c[7], c[8], c[9]]));
  const byId = Object.fromEntries(CT.map((c) => [c[0], c]));
  const known = new Set(Object.keys(byId));
  const placed = (c) => !!c && Number.isFinite(c[7]) && Number.isFinite(c[8]) && c[7] > 0 && c[8] > 0 && LAYER_OK(c[3]);
  const idOf = (name) => {
    if (!name) return null;
    const c = CTR.find((x) => x[1] === name) ?? CTR.find((x) => name.startsWith(x[1]) || x[1].startsWith(name));
    return c ? c[0] : null;
  };
  /** The map contract at an address: the map keeps addresses shortened, so first six and last four. */
  const atAddr = (a) => {
    if (!a) return null;
    const c = CTR.find((x) => x[5] && x[5].length > 8 && x[5].slice(0, 6).toLowerCase() === a.slice(0, 6).toLowerCase() && x[5].slice(-4).toLowerCase() === a.slice(-4).toLowerCase());
    return c ? c[0] : null;
  };

  /* the monorepo's projects the poller watches (the API's PROJECTS); an API that sends none watches the contracts only */
  const [org = '', repoName = ''] = (CODE.repo || '').split('/');
  const live = CT.filter((c) => c[4] === 'live').length;
  const PROJ = CODE.projects?.length
    ? CODE.projects
    : [{ id: 'proto', name: 'Protocol', tiny: 'Contracts', what: 'Smart contracts', lang: 'Solidity · Hardhat', path: CODE.path || 'contracts', lastAt: CODE.commits[0]?.at ?? null }];
  const REPOS = PROJ.map((p) => ({
    id: p.id,
    name: repoName || 'GitHub isn’t connected',
    org,
    full: CODE.repo || '',
    path: p.path,
    what: p.what,
    lang: p.lang,
    branch: CODE.poller?.branches?.[0] || 'dev',
    main: 'none',
    last: p.lastAt ?? null,
    live: p.id === 'proto' ? (CHAIN.network ? `${CHAIN.network} · ${live} of ${CT.length}` : 'Not indexed yet') : 'Not read yet',
    url: CODE.repo ? `https://github.com/${CODE.repo}` : '',
  }));
  const RSHORT = Object.fromEntries(PROJ.map((p) => [p.id, p.name]));
  const RTINY = Object.fromEntries(PROJ.map((p) => [p.id, p.tiny]));
  // a commit or PR is shown under its first project, the others beside it; one in none (docs only) isn't a project's
  const projIds = new Set(PROJ.map((p) => p.id));
  const inProjects = (x) => (x.projects?.length ? x.projects : x.contracts?.length || !CODE.projects?.length ? ['proto'] : []).filter((id) => projIds.has(id));

  /* changes: pull requests, commits since a release, the Safe's queue, what shipped in 7 days */
  const CHANGES = [];
  const week = NOW - 7 * DAY;
  for (const p of CODE.pulls ?? []) {
    if (p.state === 'closed') continue;
    if (p.state === 'merged' && (p.mergedAt ?? 0) < week) continue;
    const [repo, ...also] = inProjects(p);
    if (!repo) continue;
    CHANGES.push({
      id: 'pr' + p.number,
      repo,
      also,
      num: p.number,
      kind: 'code',
      t: p.title,
      by: named(nameOf[p.login] || p.login, p.login),
      st: p.state === 'merged' ? 'shipped' : p.draft ? 'draft' : 'review',
      checks: 'none',
      files: p.files,
      opened: p.createdAt,
      upd: p.updatedAt,
      live: p.mergedAt ?? undefined,
      contract: (p.contracts ?? []).map(idOf).find(Boolean) ?? null,
      head: p.head,
      base: p.base,
      url: p.url,
    });
  }
  const evAt = (c, k) => c.ev?.find((e) => e[0] === k)?.[1];
  // commits on the branch since a contract's last release: its next version, in progress
  for (const c of CH.filter((x) => String(x.id).startsWith('code:')))
    CHANGES.push({
      id: c.id,
      repo: 'proto',
      kind: 'upgrade',
      t: c.t,
      by: named(c.by),
      st: 'draft',
      checks: 'none',
      opened: evAt(c, 'draft') ?? NOW,
      upd: c.commits?.at(-1)?.at ?? evAt(c, 'draft') ?? NOW,
      contract: idOf(c.c),
      note: c.d,
      commits: c.commits ?? [],
      state: c.state,
      url: c.commits?.at(-1)?.url ?? '',
    });
  // released in the last 7 days (the indexer's upgrades, with the commits they shipped)
  for (const c of CH_DONE.filter((x) => String(x.id).startsWith('rel:'))) {
    const at = c.ev?.at(-1)?.[1] ?? 0;
    if (at < week) continue;
    CHANGES.push({ id: c.id, repo: 'proto', kind: 'upgrade', t: c.t, by: named(c.by === '—' ? '' : c.by), st: 'shipped', checks: 'none', opened: evAt(c, 'draft') ?? at, live: at, contract: idOf(c.c), note: c.d, commits: c.commits ?? [], released: 1 });
  }
  const outbox = vars.safeOutbox ?? [];
  if (safe) {
    const summaryOf = (h) => outbox.find((o) => o.safe_tx_hash === h)?.summary;
    const nameIn = (s) => /on ([A-Z]\w+)\s*$/.exec(s || '')?.[1];
    // asked for here, waiting for its first signature: any owner signs it and sends it to the Safe
    for (const o of outbox.filter((x) => x.status === 'queued'))
      CHANGES.push({
        id: 'ob:' + o.id,
        kind: 'setting',
        t: o.summary,
        by: named(o.requested_by),
        st: 'safe',
        outbox: o.id,
        from: FROM[o.section] ?? o.section,
        opened: Date.parse(o.created_at),
        contract: idOf(nameIn(o.summary)),
        sigs: {},
        req: safe.threshold,
        need: mine && me?.wallet ? meKey : null,
      });
    const tx = (t, st) => {
      const sigs = Object.fromEntries(t.confirmations.map((c) => [addrKey(c.owner), Date.parse(c.at)]));
      const ready = t.confirmations.length >= t.confirmationsRequired;
      const signed = !!mine && t.confirmations.some((c) => c.owner.toLowerCase() === mine.toLowerCase());
      const s = summaryOf(t.safeTxHash);
      return {
        id: 'tx:' + t.safeTxHash,
        kind: 'setting',
        t: s || t.method || 'A transaction',
        by: t.proposer ? addrKey(t.proposer) : 'anon',
        st,
        hash: t.safeTxHash,
        nonce: t.nonce,
        to: t.to,
        method: t.method,
        sigs,
        req: t.confirmationsRequired,
        ready: st === 'safe' && ready,
        need: st === 'safe' && !ready && mine && !signed ? meKey : null,
        opened: Date.parse(t.submittedAt),
        live: t.executedAt ? Date.parse(t.executedAt) : undefined,
        contract: atAddr(t.to) ?? idOf(nameIn(s)),
        from: s ? FROM[outbox.find((o) => o.safe_tx_hash === t.safeTxHash)?.section] : undefined,
      };
    };
    for (const t of safe.pending) CHANGES.push(tx(t, 'safe'));
    for (const t of safe.executed) if (t.executedAt && Date.parse(t.executedAt) >= week) CHANGES.push(tx(t, 'shipped'));
  } else
    // no Ops Safe yet: what was proposed here waits for one
    for (const c of CH.filter((x) => !String(x.id).startsWith('code:')))
      CHANGES.push({ id: c.id, kind: 'setting', t: c.t, by: named(c.by), st: 'safe', from: 'Build', opened: evAt(c, 'draft') ?? NOW, contract: idOf(c.c), note: c.d !== c.t ? c.d : '', sigs: {}, block: 'Waits for an Ops Safe' });

  /* commits, newest first; and how many a day, the last four weeks */
  const COMMITS = (CODE.commits ?? []).flatMap((c) => {
    const [repo] = inProjects(c);
    return repo ? [[c.at, repo, named(c.author, c.login), c.message, c.sha, c.url]] : [];
  });
  // a commit counts in every project it touches
  const ACT = Object.fromEntries(PROJ.map((p) => [p.id, Array(28).fill(0)]));
  for (const c of CODE.commits ?? []) {
    const d = 27 - Math.floor((TODAY - Math.floor(c.at / DAY) * DAY) / DAY);
    if (d >= 0 && d < 28) for (const id of inProjects(c)) ACT[id][d]++;
  }

  /* where the contracts run, and their releases as deploys, newest first */
  const ENV = Object.fromEntries(
    PROJ.map((p) => [
      p.id,
      {
        preview: ['—', 'Not read yet', 'na'],
        test: p.id === 'proto' ? [CHAIN.network || 'Not indexed yet', `${live} of ${CT.length} contracts found on-chain`, live ? 'ok' : 'na'] : ['—', 'Not read yet', 'na'],
        prod: ['—', 'Not read yet', 'na'],
      },
    ]),
  );
  const nameById = Object.fromEntries(CT.map((c) => [c[0], c[1]]));
  const DEPLOYS = Object.entries(RELEASES)
    .flatMap(([id, list]) => (list ?? []).map(([ver, at, impl]) => [at, 'proto', 'test', `${nameById[id] ?? id} ${ver}`, 'Read from the chain', 'ok', impl ? `Implementation ${short(impl)}` : 'Upgraded']))
    .sort((a, b) => b[0] - a[0]);

  /* the Ops Safe's signers: their signatures a week (loadSafe counts them) and median hours to sign */
  const SIGN_ROWS = safe
    ? safe.owners.map((o, i) => {
        const row = SIGNERS[i] ?? [];
        const k = SIGNER_KEYS[i];
        return [k, row[0] ?? k, PPL[k].n, o.you ? 'You' : PPL[k].role, Number(row[3]) || 0];
      })
    : [];
  const weekStart = (i) => TODAY + DAY - (8 - i) * 7 * DAY;

  const thr = safe?.threshold ?? 0;
  const KEYS = [
    ['Ops Safe', safe ? `${thr} of ${safe.owners.length} · ${SIGNER_KEYS.map((k) => PPL[k].n).join(', ')}` : 'Not connected', safe ? 'Where contract changes are signed' : 'No Ops Safe is set for this app yet'],
    [
      'GitHub',
      CODE.repo || 'Not connected',
      CODE.repo
        ? `Watching ${CODE.projects?.length ? (CODE.watch ? `${CODE.watch}/` : 'every project') : `${CODE.path || 'contracts'}/`} on ${(CODE.poller?.branches ?? []).join(' and ') || 'dev'}`
        : 'The poller hasn’t read a repo yet',
    ],
    ['Keys in this app', 'None', 'Each signer signs with their own wallet'],
  ];

  /* Build's own records (migration 0066): incidents, findings and audits, in the reference's shapes */
  const rec = vars.buildRecords ?? { incidents: [], findings: [], audits: [], team: [] };
  /** A team member the records name, as a person (the key is their id, as yours is). */
  const teamKey = (p) => {
    if (!p) return 'none';
    PPL[p.id] ??= { n: p.name, ini: initials(p.name), role: 'Build', eng: true };
    return p.id;
  };
  const TEAM = rec.team.map((p) => [teamKey(p), p.name]);
  const span = (ms) => {
    const m = Math.max(1, Math.round(ms / 6e4));
    if (m < 60) return `${m} min`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} ${h === 1 ? 'hour' : 'hours'}`;
    return `${Math.round(h / 24)} days`;
  };
  const INCIDENTS = rec.incidents.map((i) => ({
    id: 'I' + i.id,
    n: i.id,
    t: i.t,
    st: i.resolved == null ? 'open' : 'closed',
    sev: i.sev,
    at: i.at,
    opened: i.opened,
    resolved: i.resolved,
    area: [i.area, i.contract ? (nameById[i.contract] ?? i.contract) : ''].filter(Boolean).join(' · ') || 'No area given',
    contract: i.contract,
    who: teamKey(i.owner),
    dur: i.resolved != null ? span(i.resolved - i.at) : '',
    note: i.note,
    resolution: i.resolution,
    reached: !!i.reached,
    ev: i.ev,
  }));
  const CHG_IDS = new Set(CHANGES.map((c) => c.id));
  const FINDINGS = rec.findings.map((f) => {
    // its fix: a pull request (shown as the change when Build lists it) or a change on Build
    const fix = f.pr ? (CHG_IDS.has('pr' + f.pr) ? 'pr' + f.pr : null) : f.change && CHG_IDS.has(f.change) ? f.change : null;
    const waiting = f.st === 'fixing' && fix && CHANGES.find((c) => c.id === fix)?.st === 'safe';
    return {
      id: 'F' + f.id,
      n: f.id,
      sev: f.sev,
      t: f.t,
      contract: f.contract && byId[f.contract] ? f.contract : null,
      where: f.where || (f.contract ? (nameById[f.contract] ?? f.contract) : '') || 'Not placed',
      found: f.found,
      by: f.by,
      st: waiting ? 'waiting' : f.st,
      state: f.st,
      stAt: f.stAt,
      stNote: f.stNote,
      fixedAt: f.st === 'fixed' ? f.stAt : undefined,
      fix,
      pr: f.pr,
      change: f.change,
      prUrl: f.pr && CODE.repo ? `https://github.com/${CODE.repo}/pull/${f.pr}` : '',
      note: f.note,
    };
  });
  // which contracts have been reviewed (an audit's day has come), and by whom
  const AUDITS = rec.audits.map((a) => ({ ...a, id: 'A' + a.id, done: a.on <= NOW, names: a.contracts.map((c) => nameById[c] ?? c) }));
  const reviewed = { internal: new Set(), external: new Set() };
  for (const a of AUDITS) if (a.done) for (const c of a.contracts) if (byId[c]) reviewed[a.kind].add(c);

  return {
    NOW,
    TODAY,
    me: meKey,
    PPL,
    SIGNER_KEYS,
    REPOS,
    CHANGES,
    COMMITS,
    ACT,
    RSHORT,
    RTINY,
    ENV,
    DEPLOYS,
    FINDINGS,
    INCIDENTS,
    AUDITS,
    /** The contracts an audit has covered: internally, by an outside auditor, either. */
    reviewed: { internal: reviewed.internal, external: reviewed.external, any: new Set([...reviewed.internal, ...reviewed.external]) },
    /** Who can be given an incident: [key, name], the team at Propose or more on Build. */
    TEAM,
    SIGNERS: SIGN_ROWS,
    SIGN_W: { ...SIGN_W },
    /** The signers' eight weeks, each labelled by the day it starts. */
    weekStart,
    CTR: CT,
    /** The contracts with a place on the map (one the indexer knows that the map doesn't place is listed, not drawn). */
    MAPPED: CT.filter(placed),
    REL: REL.filter((r) => known.has(r[0]) && known.has(r[1])),
    EDGES: REL.filter((r) => r[4] !== null && placed(byId[r[0]]) && placed(byId[r[1]])),
    RELEASES,
    CTR_NOTE: { ...CTR_NOTE },
    KEYS,
    /** Who holds each AccessManager role, when it's been read (a figure nothing writes yet). */
    roles: KEY_ROLES.roles?.length ? KEY_ROLES : null,
    chain: { network: CHAIN.network || '', block: Number(CHAIN.block) || 0 },
    deployed: live,
    safe,
    threshold: thr,
    wallet: me?.wallet ?? null,
  };
}
