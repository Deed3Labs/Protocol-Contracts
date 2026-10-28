/** Growth and Field → what the API serves (GET /api/command/sections/growth and /field). */

/** A poster, in the prototype's shape. Dates are epoch milliseconds. */
export interface PosterRow {
  n: number;
  shop: string;
  shopId: string;
  city: string;
  scans: number;
  design: string;
  hung: number;
  checked: number;
  status: 'up' | 'due' | 'faded' | 'missing';
  swap: number;
  board?: boolean;
}

/** A form from the website. Names and emails are masked unless asked for; never sent at Totals. */
export interface FormRow {
  who: [string, string];
  mail: string;
  type: string;
  city: string;
  src: string;
  when: string;
  st: string;
  /** When it came in (epoch ms), where the page shows more than the time of day. */
  at?: number;
}

/** How many of the invited are at each step, for Growth's cohorts (counted from the members). */
export interface MemberSummary {
  invited: number;
  opened: number;
  active: number;
  funded: Record<string, number>;
}

export interface GrowthPayload {
  POSTERS: PosterRow[];
  DESIGNS: Record<string, { name: string; posters: number; scans: number; joined: number }>;
  /** Not sent at Totals: a list of people. */
  INBOX: FormRow[] | null;
  NEXT_BATCH: { number: number } | null;
  MEMBER_SUMMARY: MemberSummary;
  figures: Record<string, unknown>;
  asOf: number;
  names: 'none' | 'masked' | 'shown';
}

export interface RouteTask {
  /** A visit is a planned stop with nothing to scan: a merchant visit, a first poster (migration 0069). */
  kind: 'poster' | 'device' | 'visit';
  n?: number;
  t: string;
  note?: string;
  done?: string;
  out?: string;
  photo?: number;
  shop?: string;
}

export interface FieldPayload {
  ROUTE: { staff: string; staffKey: string; day: number; loaded: string; started: string; miles: number; backBy: string; minutesPerStop: number };
  STOPS: Array<{ id: string; name: string; city: string; where: string; eta: string; tasks: RouteTask[] }>;
  LATER: string[][];
  SHOP_INFO: Record<string, [string, string, string]>;
  POSTERS: PosterRow[];
  DESIGNS: GrowthPayload['DESIGNS'];
  /** Routes planned for the days after today, each one person's stops in order (Plan). */
  PLANS?: PlannedRoute[];
  /** What went in the van today, once it's recorded. */
  VAN?: { day: number; loaded: string; posters: Record<string, number>; batteries: number; rolls: number; note: string | null; by: string | null } | null;
  /** Shops that said yes to a poster: waiting for one, or put up in the last 30 days (`placed`, with the poster `n`). */
  POSTER_YES?: Array<{ id: number; shop: string; city: string; card: string | null; source: 'visit' | 'pipeline' | 'hand'; agreed: number; by: string | null; design: string | null; note: string | null; placed: number | null; n: number | null }>;
  asOf: number;
}

export interface PlannedRoute {
  id: number;
  day: number;
  /** The person whose route it is, and who planned it (team people's ids). */
  who: string;
  whoName: string;
  by: string;
  byName: string;
  start: string;
  status: 'draft' | 'sent' | 'accepted';
  changed: boolean;
  miles: number;
  minutes: number;
  backBy: string | null;
  note: string | null;
  sentAt: number | null;
  okAt: number | null;
  stops: Array<{ ref: string; kind: 'poster' | 'new' | 'merchant' | 'device' | 'visit'; shop: string; city: string; what: string; why: string; mins: number; n: number | null; design: string | null; eta: string | null }>;
}

/** Marcus Lee's route on the prototype's day, as Field draws it. */
export const SEED_ROUTE: FieldPayload['ROUTE'] = {
  staff: 'Marcus Lee',
  staffKey: 'marcus',
  day: Date.UTC(2026, 9, 21),
  loaded: '08:40',
  started: '08:50',
  miles: 31,
  backBy: '14:00',
  minutesPerStop: 34,
};
