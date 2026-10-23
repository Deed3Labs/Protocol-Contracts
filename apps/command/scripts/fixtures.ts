/**
 * Writes the prototype's rows into packages/command-types/src/fixtures, for the API's seed:
 * `bun scripts/fixtures.ts`. The rows come from src/sections/data.tsx, which is the prototype's own
 * data, so the seeded database holds exactly what the design draws.
 */
import { writeFileSync } from 'node:fs';
import { SEED_NEXT_BATCH } from '@clear/command-types';

const d = await import('../src/sections/data.tsx');
const out = new URL('../../../packages/command-types/src/fixtures/', import.meta.url);
const write = (name: string, value: unknown) => writeFileSync(new URL(name, out), JSON.stringify(value, null, 1) + '\n');

// Members: the 300 invited, their 12 batches, and batch 13, which Marcus Lee proposed (drawn in the
// prototype's Waitlist and batches pane).
write('members.json', {
  // as the prototype draws them, `left` and `quiet` (counted as of its day) included: the seed
  // ignores those, and the API's tests check its own counting against them
  members: d.MEMBERS,
  batches: d.BATCH_DATE.map((sentAt: number, i: number) => ({ number: i + 1, size: 25, sentAt })),
  proposed: SEED_NEXT_BATCH,
  check: { B_ACT: d.B_ACT, B_OPEN: d.B_OPEN },
});
console.log('fixtures written');
