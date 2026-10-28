// @ts-nocheck: reads the section data the API fills, which is untyped, as the sections are.
import { BATCH_DATE, B_ACT, B_OPEN, INBOX, MEMBERS, POSTERS, RANGE, vars } from './data';

/*
 * Members' datasets, live (members2.tsx reads these in place of the reference's when REAL): built from
 * what the API's members section sends (live/sections.ts fills ./data and vars from it). The reference's
 * people, batches, dates and staff never show: what the API doesn't have is zero, empty or absent, and
 * docs/ui-redesign-plan.md lists each gap: Social and Search as sources, who has the app or a phone,
 * notes, tags, history and nudge counts per person, which shops are live in each city, nudge history,
 * follow-ups and channels.
 *
 * Days are counted as the reference counts them, from a start (its 4 Aug, so today is its day 78).
 * Live the start is 1 Jan 2020, before Clear: every real date is a day after it, never day 0, which the
 * page reads as "not yet" (`p.act`, `p.opened`).
 */

const DAY = 864e5;
const START = [2020, 0, 1];
const WINDOW = 90;
/** A waiting person's id on the page and in the API: 1,000,000 + their waitlist id (services/command/waitlist.ts). */
const WAITING_ID = 1_000_000;

export function membersLive() {
  const now = new Date();
  const start = new Date(START[0], START[1], START[2]);
  const midnight = (t) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };
  /** A time's day, counted from the start (local days, so a date shows as the day it was here). */
  const dayOf = (t) => (t ? Math.round((midnight(t) - start) / DAY) : null);
  /** The same, with the time of day as the fraction (the reference's `jt`, for "joined at 9:41pm"). */
  const jtOf = (t) => (t ? dayOf(t) + (t - midnight(t)) / DAY : 0);

  // a poster's shop, when Growth's posters have loaded; else the poster as the API names it
  const shopOf = (poster) => {
    if (!poster) return null;
    const n = /^P-0*(\d+)$/.exec(poster);
    const p = n ? POSTERS.find((x) => x.n === +n[1]) : null;
    return p?.shop || poster;
  };
  const names = vars.memberNames ?? 'masked';
  const nameOf = (r) => [r.first, r.last].filter(Boolean).join(' ') || r.no || 'No name yet';
  const base = (r, i) => ({
    id: r.no || `#${i + 1}`,
    apiId: r.id,
    name: nameOf(r),
    shown: names === 'shown',
    f: (r.first || r.no || '?')[0],
    l: (r.last || '?')[0],
    city: r.city || 'Unknown',
    src: r.src,
    poster: r.poster ?? null,
    shop: r.src === 'Poster' ? shopOf(r.poster) || 'Unknown poster' : null,
    joined: dayOf(r.joined),
    jt: jtOf(r.joined),
    // no source says who has the app, a phone, notes, tags or a history yet
    app: false,
    phone: false,
    notes: [],
    tags: [],
    log: [],
    nudges: 0,
  });

  const TODAY = dayOf(now.getTime());
  const members = MEMBERS.map((m, i) => {
    const spent = !!(m.spend || m.spentAt);
    const stage = m.status === 'active' ? (spent ? 'spent' : 'active') : m.status;
    // at Totals the rows carry no dates: the window's days left still come, so the invite day is worked back from them
    const invited = m.invited ? dayOf(m.invited) : TODAY - (WINDOW - (m.left ?? WINDOW));
    return {
      ...base(m, i),
      stage,
      batch: m.batch,
      invited,
      opened: m.opened ? dayOf(m.opened) : stage !== 'invited' && !m.invited ? invited : null,
      act: m.activeAt ? dayOf(m.activeAt) : stage === 'active' || stage === 'spent' ? (m.invited ? null : invited) : null,
      fund: m.fund ?? null,
      // the page's spentAt is the shop of the first spend; its day is spentDay
      spentAt: m.spend ?? null,
      spentDay: m.spentAt ? dayOf(m.spentAt) : null,
      // at Totals nobody's last visit comes: none of them is called quiet
      lastSeen: m.last_ ? dayOf(m.last_) : TODAY,
    };
  });

  // the batch waiting for a second person, and who it would take (no one at Totals)
  const nb = vars.NEXT_BATCH ?? null;
  const take = new Set(nb?.ids ?? []);
  const waiting = (vars.WAITLIST ?? []).map((w, i) => ({
    ...base(w, MEMBERS.length + i),
    stage: 'waiting',
    pos: w.pos,
    b13: take.has(w.id),
    batch: null,
    invited: null,
    opened: null,
    act: null,
    fund: null,
    spentAt: null,
    lastSeen: null,
  }));
  const PEOPLE = [...members, ...waiting];

  // every batch that went out: the API's counts, or (an older answer) its dates and stage counts
  const sent = vars.BATCHES?.length
    ? vars.BATCHES.map((b) => [b.number, dayOf(b.sentAt), b.size, b.opened, b.active, b.spent])
    : BATCH_DATE.map((t, i) => [i + 1, t])
        .filter(([, t]) => t > 0)
        .map(([n, t], i) => {
          const ppl = members.filter((p) => p.batch === n);
          return [n, dayOf(t), ppl.length, (B_ACT[i] ?? 0) + (B_OPEN[i] ?? 0), B_ACT[i] ?? 0, ppl.filter((p) => p.stage === 'spent').length];
        });
  const fig = vars.membersFigures ?? {};
  const nextNo = fig['members.next_batch.number'] ?? Math.max(0, ...sent.map((b) => b[0])) + 1 + (nb ? 1 : 0);
  const NEXT = nb
    ? {
        number: nb.number,
        size: nb.size,
        proposedBy: nb.proposedBy || 'Someone',
        proposedAt: nb.proposedAt ? dayOf(nb.proposedAt) : null,
        order: nb.order ?? 'oldest',
        joinedFrom: dayOf(nb.joinedFrom),
        windowEnds: dayOf(nb.windowEnds),
        fromPosters: nb.fromPosters ?? 0,
        fromWebsite: nb.fromWebsite ?? 0,
      }
    : null;

  // cities and poster shops as the people have them, most first
  const tally = (list, key) => [...list.reduce((m, p) => (key(p) ? m.set(key(p), (m.get(key(p)) ?? 0) + 1) : m), new Map())].sort((a, b) => b[1] - a[1]);
  const CITIES = tally(PEOPLE, (p) => p.city).map(([c, n]) => [c, PEOPLE.length ? n / PEOPLE.length : 0]);
  // a shop is a poster's: someone who came from a poster nobody recorded can't be picked by it
  const withPoster = PEOPLE.filter((p) => p.poster);
  const SHOPS = tally(withPoster, (p) => p.shop).map(([s]) => [
    s,
    tally(
      withPoster.filter((p) => p.shop === s),
      (p) => p.city,
    )[0]?.[0] ?? '',
  ]);

  // the join form: the members section's own rows (the last 30 days), else Growth's if it loaded
  const form = vars.joinForm ?? INBOX.filter((x) => x.type === 'Waitlist');
  const today = midnight(now.getTime()).getTime();
  const when = (x) => {
    if (!x.at) return x.when;
    const d = new Date(x.at);
    // today's by the time here (the API's hh:mm is UTC), older ones by their day
    if (x.at >= today) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
  };
  // a part of a name the form left blank isn't drawn (the page masks each part)
  const FORMS = form.map((x) => ({ ...x, who: (x.who ?? []).filter(Boolean), when: when(x) }));
  const formsMonth = fig['members.forms.month'] ?? (vars.joinForm ? vars.joinForm.length : (RANGE.month?.forms?.[0] ?? 0));

  return {
    TODAY,
    D0: [...START],
    CITIES,
    SHOPS,
    PEOPLE,
    BATCH: sent,
    NEXT,
    /** The batch after the one waiting (or the next, when none is). */
    B14N: nextNo,
    FORMS,
    formsMonth,
    names,
    WAITING_ID,
  };
}
