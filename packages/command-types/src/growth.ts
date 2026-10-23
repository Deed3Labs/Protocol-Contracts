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
  kind: 'poster' | 'device';
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
  asOf: number;
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
