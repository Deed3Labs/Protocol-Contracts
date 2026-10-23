/** Members → the rows the section draws, as the API serves them (GET /api/command/sections/members). */

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
}

export interface MembersPayload {
  MEMBERS: MemberRow[];
  /** Per sent batch, oldest first: when it went, how many are active, how many opened but not funded. */
  BATCH_DATE: number[];
  B_ACT: number[];
  B_OPEN: number[];
  NEXT_BATCH: NextBatch | null;
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
