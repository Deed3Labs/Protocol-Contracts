// @ts-nocheck: works on the sections' untyped data (src/sections/data.tsx) until Phase 3 types it.
import { FEED_FROM, INVITES, NEED, PEOPLE_T, ROLES, S, SG, SIGNIN, UPD_FROM, VSEC, W_ICON, W_VIZ, vars } from '../sections/data';
import { go, render, setWho, toast } from '../sections/shell';
import { hideLogin, showLogin, sgnDraw, sgnIn, sgnStep } from '../sections/signin';
import { ApiError, api, city, deviceKey, forgetSession, keepSession, sessionId, whenSessionEnds } from './api';
import { privy, privyReady } from './privy';
import { forgetSections } from './sections';
export { loadSection } from './sections';

/*
 * The live app's side of sign-in, the view and the Permissions page. The sections call these where
 * the prototype simulated them; with ?preview=1 they don't run at all.
 */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMon = (iso) => {
  const d = new Date(iso);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
};
/** The API calls the Permissions section "access"; the prototype's views call it "team". */
const apiKey = (k) => (k === 'team' ? 'access' : k);
const levelsArray = (levels) => VSEC.map((k) => levels[apiKey(k)] ?? 0);
const levelsObject = (arr) => Object.fromEntries(VSEC.map((k, i) => [apiKey(k), arr[i]]));

// ── who's signed in ─────────────────────────────────────────────────────────

/** Who's signed in, from GET /me, and the view the prototype's code draws from it. */
export function applyMe(me) {
  vars.me = me;
  const levels = levelsArray(me.levels);
  const full = levels.every((v) => v === 4);
  const g = me.group?.key ?? 'members';
  if (!ROLES[g] && me.group) ROLES[g] = [me.group.name, me.group.description, levels];
  const first = (me.name || me.email || 'there').split(/[ @]/)[0];
  const who = first.charAt(0).toUpperCase() + first.slice(1);
  SG.name = who;
  SG.until = me.expiresAt ? dayMon(me.expiresAt) : null;
  SG.view = full ? null : { g, who, levels, person: vars.meId ?? null, terms: me.terms.required };
  SG.who = SG.view ? who : null;
}

/** Starts a Command Center session once Privy has signed someone in, then opens their view. */
export async function startSession(method) {
  try {
    const out = await api('POST', '/sessions', { deviceKey: deviceKey(), keep: !!SG.keep, method, city: (await city()) ?? undefined, invite: takeInvite() ?? undefined });
    keepSession(out.session.id, !!SG.keep);
    applyMe(out.me);
    if (out.me.levels.access >= 2) await loadTeam().catch(() => undefined);
    else await loadWaiting().catch(() => undefined);
    applyMe(out.me);
    if (out.me.terms.required) return sgnStep('terms');
    sgnIn();
  } catch (e) {
    await privy.logout().catch(() => undefined);
    signInError(e instanceof ApiError ? e.message : 'Couldn’t sign you in. Try again.');
  }
}

/** Back to the sign-in page with a line under the email box: the prototype's own error style. */
export function signInError(message) {
  sgnStep('start');
  const l = document.getElementById('sgnIn');
  if (!l) return;
  l.classList.add('bad');
  l.querySelector('.sgn-err').textContent = message;
}

export async function livePasskey() {
  SG.who = null;
  SG.view = null;
  sgnStep('passkey');
  try {
    if (!privy.authenticated) await privy.passkey();
    if (SG.step === 'passkey') await startSession('passkey');
  } catch {
    if (SG.step === 'passkey') signInError('No passkey was used. Try again, or use a code by email.');
  }
}

export async function liveSendCode(email) {
  try {
    await privy.sendCode(email);
    sgnStep('code');
  } catch {
    signInError('We couldn’t send a code to that address. Check it and try again.');
  }
}

export async function liveCode(code) {
  sgnStep('verify');
  try {
    await privy.loginWithCode(code);
  } catch {
    sgnStep('code');
    toast('That code didn’t work. Check the email and try again.');
    return;
  }
  await startSession('email');
}

export async function liveResend() {
  try {
    await privy.sendCode(SG.email);
    toast('Sent a new code');
  } catch {
    toast('Couldn’t send a new code. Try again in a moment.');
  }
}

export async function liveOther() {
  try {
    if (!privy.authenticated) await privy.other();
    await startSession('other');
  } catch {
    // they closed Privy's window: stay where they were
  }
}

export async function liveTerms() {
  try {
    const out = await api('POST', '/terms', { version: vars.me.terms.version });
    applyMe(out.me);
    sgnIn();
  } catch (e) {
    toast(e.message);
  }
}

export async function liveSignOut() {
  try {
    if (sessionId()) await api('DELETE', '/sessions/current');
  } catch {
    // ended already: nothing to undo
  }
  forgetSession();
  forgetSections();
  vars.me = null;
  await privy.logout().catch(() => undefined);
}

/** An invite link (`#invite=…`) is kept until the sign-in it's for. */
function takeInvite() {
  try {
    const t = sessionStorage.getItem('cc-invite');
    sessionStorage.removeItem('cc-invite');
    return t;
  } catch {
    return null;
  }
}

/**
 * The first draw: the sign-in page, unless this browser still has a live session. A browser with a
 * Privy login but no Command Center session signs in again from the start (that's what "don't keep
 * me signed in" promised).
 */
export async function liveBoot(start) {
  const inv = /^invite=([\w-]+)$/.exec(start);
  if (inv) {
    try {
      sessionStorage.setItem('cc-invite', inv[1]);
    } catch {
      // the invite still works by signing in with the invited email
    }
    start = '';
  }
  whenSessionEnds(() => {
    forgetSession();
    vars.me = null;
    showLogin();
    toast('Your session ended. Sign in again.');
  });
  showLogin();
  await privyReady();
  if (sessionId() && privy.authenticated) {
    try {
      const { me } = await api('GET', '/me');
      applyMe(me);
      if (me.levels.access >= 2) await loadTeam().catch(() => undefined);
      else await loadWaiting().catch(() => undefined);
      applyMe(me);
      if (me.terms.required) {
        sgnStep('terms');
        return;
      }
      SG.step = 'start';
      document.body.classList.remove('signed-out');
      sgnDraw();
      hideLogin();
      S.view = SG.view ? Object.assign({ preview: false }, SG.view) : null;
      setWho(SG.view ? SG.view.who : SG.name, SG.view ? ROLES[SG.view.g][0].replace(/s$/, '') : 'Admin');
      go(start || 'home');
      return;
    } catch {
      forgetSession();
    }
  }
  if (privy.authenticated) await privy.logout().catch(() => undefined);
}

// ── the team, for the Permissions page ─────────────────────────────────────

const idOf = new Map(); // short id → person uuid
const shortOf = new Map(); // person uuid → short id

/** A person's short key, as Team, Records and the log show them: initials, numbered when two share them. */
export function shortId(p) {
  if (shortOf.has(p.id)) return shortOf.get(p.id);
  const parts = (p.name || p.email || '?').split(/[ @.]+/).filter(Boolean);
  let base = (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
  let s = base;
  for (let n = 2; idOf.has(s); n++) s = base + n;
  idOf.set(s, p.id);
  shortOf.set(p.id, s);
  return s;
}
export const personUuid = (short) => idOf.get(short);

const ago = (iso) => {
  if (!iso) return 'Not yet';
  const d = new Date(iso),
    days = Math.floor((Date.now() - d.getTime()) / 86400_000);
  const hm = d.toTimeString().slice(0, 5);
  return days <= 0 ? `Today ${hm}` : days === 1 ? 'Yesterday' : `${days} days ago`;
};

/**
 * The team from the API, written into the arrays the Permissions page draws from, so every panel
 * and flow shows real people. Demo rows elsewhere (Records, Contracts) stay until Phase 3.
 */
export async function loadTeam() {
  const [{ groups }, { people }] = await Promise.all([api('GET', '/groups'), api('GET', '/people')]);
  for (const k of Object.keys(ROLES)) delete ROLES[k];
  for (const g of groups) ROLES[g.key] = g.auto ? [g.name, g.description, levelsArray(g.levels), 1] : [g.name, g.description, levelsArray(g.levels)];
  vars.TEAMG = groups.filter((g) => !g.auto).map((g) => g.key);

  const signedIn = people.filter((p) => p.lastSignIn || !p.invited);
  const invited = people.filter((p) => !p.lastSignIn && p.invited);
  PEOPLE_T.splice(
    0,
    PEOPLE_T.length,
    ...signedIn.map((p) => {
      const deviceCity = (label) => p.signIns.find((s) => s.device === label)?.city;
      return {
        id: shortId(p),
        uid: p.id,
        email: p.email,
        n: p.name || p.email,
        role: p.group ?? 'members',
        title: p.title || (p.group ? ROLES[p.group]?.[0] : 'Custom access'),
        since: new Date(p.since).getTime(),
        last: ago(p.lastSignIn),
        dev: p.devices.map((d) => [d.label, deviceCity(d.label)].filter(Boolean).join(' · ')),
        passkey: p.passkey ? 1 : 0,
        // Ops Safe signers arrive with the Safe in Phase 4
        signer: 0,
        off: p.off ? 1 : 0,
        custom: p.custom ? levelsArray(p.custom) : undefined,
        terms: p.termsAccepted ? 1 : 0,
        expires: p.expiresAt,
      };
    }),
  );
  INVITES.splice(0, INVITES.length, ...invited.map((p) => [shortId(p), p.name || p.email, p.group ?? 'members', `Sent ${dayMon(p.since)} · expires ${dayMon(p.invited.expiresAt)}`]));
  const week = [...Array(7)].map((_, i) => new Date(Date.now() - (6 - i) * 86400_000).toDateString());
  SIGNIN.splice(
    0,
    SIGNIN.length,
    ...signedIn.map((p) => {
      const last = p.signIns[0];
      const fresh = p.signIns.find((s) => s.newDevice);
      return [
        shortId(p),
        p.name || p.email,
        last ? [last.device, last.city].filter(Boolean).join(' · ') : '—',
        week.map((d) => p.signIns.filter((s) => new Date(s.at).toDateString() === d).length),
        ago(p.lastSignIn),
        fresh ? `New device ${dayMon(fresh.at)}` : '',
      ];
    }),
  );
  if (vars.me) vars.meId = shortOf.get(vars.me.id) ?? null;
  await loadWaiting().catch(() => undefined);
}

// ── changes from the Permissions page ──────────────────────────────────────

/**
 * Runs a change, then reloads the team from the server. When it needs a second admin the server
 * answers 202, and the flow's closing words say so instead.
 */
export async function teamChange(f, run) {
  const out = await run();
  if (out?.proposal) f.done = ['Sent for a second approval.', 'It takes effect when another admin approves it in Needs you.'];
  await loadTeam();
}

export const invite = (b) => api('POST', '/invites', b);
export const resendInvite = (short) => api('POST', `/invites/${personUuid(short)}/resend`);
export const setAccess = (short, b) => api('PATCH', `/people/${personUuid(short)}/access`, b);
export const signOutEverywhere = (short) => api('POST', `/people/${personUuid(short)}/sign-out`);
export const newGroup = (name, description, levels) => api('POST', '/groups', { name, description, levels: levelsObject(levels) });
export const editGroup = (key, levels) => api('PATCH', `/groups/${key}`, { levels: levelsObject(levels) });
export const customLevels = (levels) => (levels ? levelsObject(levels) : null);

// ── waiting on a second admin ───────────────────────────────────────────────

const AREA_NAME = { access: 'Access', growth: 'Growth', field: 'Field', members: 'Members', merchants: 'Merchants', shop: 'Shop', money: 'Money', contracts: 'Contracts', governance: 'Governance', records: 'Records' };
const AREA_ICON = { access: 'team', shop: 'shop', money: 'money', merchants: 'merchants', contracts: 'contracts', governance: 'governance', members: 'members', growth: 'growth', field: 'field', records: 'records' };

/** Everything waiting for a second person, in every area you can see, as Needs-you items the prototype's modal already draws. */
export async function loadWaiting() {
  if (!vars.me || !Object.values(vars.me.levels).some((v) => v >= 2)) return;
  const { proposals } = await api('GET', '/proposals?area=all');
  // live, Needs you is only what's really waiting: the prototype's sample items go
  S.waiting = [];
  proposals.forEach((p, i) => {
    const mine = p.proposedBy === vars.me.id;
    const by = shortOf.get(p.proposedBy) ? PEOPLE_T.find((x) => x.uid === p.proposedBy)?.n : 'Someone';
    const area = AREA_NAME[p.area] ?? 'Change',
      id = `${p.area}-${p.id}`;
    // the tables Home looks a waiting item up in, by its id
    NEED[id] = { order: 10 + i, verb: mine ? 'Waiting' : 'Approve', meta: `${area} · ${mine ? 'you' : by} proposed`, fig: '' };
    W_ICON[id] = AREA_ICON[p.area] ?? 'team';
    W_VIZ[id] = () => '';
    FEED_FROM[id] = `Approved: ${p.summary}`;
    UPD_FROM[id] = [p.area === 'access' ? 'access changed' : 'approved', p.area === 'access' ? 'team' : p.area];
    S.waiting.push({
      id,
      live: true,
      kind: area,
      tag: 'Two-person',
      title: p.summary,
      fig: '',
      figSub: mine ? 'waiting on a second person' : `${by} proposed`,
      meta: [mine ? 'You proposed' : `${by} proposed`],
      cta: mine ? 'Waiting' : 'Review',
      mode: 'approve',
      ledger: [['Change', p.summary], ['Proposed', `${by} · ${dayMon(p.createdAt)}`], ['Needs', mine ? 'Someone else' : 'You, as the second person', 1]],
      rule: [by, area],
      primary: mine ? 'Only someone else can approve' : 'Approve',
      steps: ['Checked the two-person rule', 'Recorded your approval', 'Applied the change'],
      done: ['Approved.', 'The change is live and logged.'],
      // once approved, every section loads afresh, so what it changed shows
      api: mine
        ? () => Promise.reject(new Error('Someone else has to approve what you proposed'))
        : () => api('POST', `/proposals/${p.id}/approve`).then((r) => import('./sections').then((m) => (m.forgetSections(), r))),
    });
  });
  render();
}

// ── the data room's log ─────────────────────────────────────────────────────

let lastView = '';
/** After each draw: the page, its tab and any open panel, when an investor is looking. Repeats are skipped. */
export function logView() {
  if (vars.me?.group?.key !== 'investors') return;
  const pane = document.querySelector('#main .ptabs [aria-current="page"]')?.textContent?.trim() || null;
  const panel = document.querySelector('#main .pane[aria-label], #modalRoot .pane[aria-label]')?.getAttribute('aria-label') || document.querySelector('#modalRoot #mt')?.textContent?.trim() || null;
  const key = [S.route, pane, panel].join('|');
  if (key === lastView) return;
  lastView = key;
  api('POST', '/views', { route: S.route, pane, panel }).catch(() => undefined);
}
