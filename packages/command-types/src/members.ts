/** Members → the rows the section draws, as the API serves them (GET /api/command/sections/members). */
import type { FormRow } from './growth';

export type MemberStatus = 'invited' | 'opened' | 'active';

/** One invited member, in the prototype's shape. Dates are epoch milliseconds. */
export interface MemberRow {
  id: number;
  no: string;
  /** Masked (`P••••`) unless names were asked for; null at Totals, where names are never sent. */
  first: string | null;
  last: string | null;
  batch: number;
  invited: number;
  joined: number;
  city: string;
  src: 'Poster' | 'Website';
  status: MemberStatus;
  poster: string | null;
  opened?: number;
  fund?: string;
  activeAt?: number;
  spend?: string;
  spentAt?: number;
  last_: number;
  /** Days left of the 90-day activation window, as of the day the section is read for. */
  left: number;
  /** Invited three weeks ago or more and still not opened. */
  quiet: boolean;
}

/**
 * Someone on the waitlist, not invited yet. Never sent at Totals; masked unless names were asked for.
 * `id` is the one their row keeps once a batch invites them (1,000,000 + their waitlist id), and `no`
 * their waitlist number (W-0012), until they sign up and get a member number.
 */
export interface WaitingRow {
  id: number;
  no: string;
  first: string | null;
  last: string | null;
  /** Place in line: 1 is the next one a batch takes, oldest first. */
  pos: number;
  joined: number;
  city: string;
  src: 'Poster' | 'Website';
  poster: string | null;
}

/** A batch that went out, and how far its people got (counts only: sent at every level). */
export interface BatchRow {
  number: number;
  sentAt: number;
  size: number;
  /** Opened the app (an account), funded (active) and made a first spend, each counted once. */
  opened: number;
  active: number;
  spent: number;
}

/** The batch waiting for a second approval, if any. */
export interface NextBatch {
  number: number;
  size: number;
  proposedBy: string;
  joinedFrom: number;
  joinedTo: number;
  fromPosters: number;
  fromWebsite: number;
  windowEnds: number;
  /** Live only: when it was proposed, who goes first, and who it would take (their ids; none at Totals). */
  proposedAt?: number;
  order?: string;
  ids?: number[];
}

/** A note on a person: what it says, who wrote it (their name on the team) and when. */
export interface PersonNote {
  t: string;
  by: string;
  at: number;
}

export interface MembersPayload {
  MEMBERS: MemberRow[];
  /** Per sent batch, oldest first: when it went, how many are active, how many opened but not funded. */
  BATCH_DATE: number[];
  B_ACT: number[];
  B_OPEN: number[];
  NEXT_BATCH: NextBatch | null;
  /** The waitlist's people, in line order: null at Totals. */
  WAITLIST: WaitingRow[] | null;
  /** Every batch sent, oldest first. */
  BATCHES: BatchRow[];
  /** The join form's last 30 days (the newest 20), masked unless names were asked for: null at Totals. */
  FORMS: FormRow[] | null;
  /** Command's notes and tags on a person, by their masked number (M-0001, W-0001): null at Totals. */
  NOTES?: Record<string, PersonNote[]> | null;
  TAGS?: Record<string, string[]> | null;
  figures: Record<string, unknown>;
  /** The day it was read for (epoch ms), and whether names are in it. */
  asOf: number;
  names: 'none' | 'masked' | 'shown';
}

/** Batch 13 as the prototype draws it: proposed by Marcus Lee, waiting for a second approval. */
export const SEED_NEXT_BATCH: NextBatch = {
  number: 13,
  size: 25,
  proposedBy: 'Marcus Lee',
  joinedFrom: Date.UTC(2026, 8, 12),
  joinedTo: Date.UTC(2026, 8, 20),
  fromPosters: 19,
  fromWebsite: 6,
  windowEnds: Date.UTC(2027, 0, 19),
};
