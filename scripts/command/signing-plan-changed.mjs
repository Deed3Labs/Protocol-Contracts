#!/usr/bin/env node
/*
 * Whether a re-run signing plan is worth committing: Command reads each step's status from the chain itself
 * (apps/api/src/services/command/signingStatus.ts), so a plan whose steps differ only in status or reason needs
 * no new commit. One is needed when the steps themselves change: a step added or gone (a new stage in
 * scripts/signing_plan.ts), or a step's call now known or different (its signer, contract or call data).
 *
 *   node scripts/command/signing-plan-changed.mjs <old plan> <new plan>
 *
 * Prints what changed; exits 0 when it's worth a commit, 1 when it isn't, 2 on bad input.
 */
import { readFileSync } from 'node:fs';

const [oldFile, newFile] = process.argv.slice(2);
if (!oldFile || !newFile) {
  console.error('usage: signing-plan-changed.mjs <old plan> <new plan>');
  process.exit(2);
}
const read = (f) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return { steps: [] };
  }
};
const before = new Map(read(oldFile).steps.map((s) => [s.id, s]));
const after = new Map(read(newFile).steps.map((s) => [s.id, s]));
const lines = [];
for (const [id, s] of after) {
  const o = before.get(id);
  if (!o) lines.push(`added ${id}: ${s.title}`);
  else {
    const changed = ['signer', 'to', 'data', 'title'].filter((k) => String(o[k] ?? '').toLowerCase() !== String(s[k] ?? '').toLowerCase());
    if (changed.length) lines.push(`changed ${id}: ${changed.join(', ')}${!o.data && s.data ? ' (its call is now known)' : ''}`);
  }
}
for (const id of before.keys()) if (!after.has(id)) lines.push(`removed ${id}`);
console.log(lines.length ? lines.join('\n') : 'Only statuses changed: Command reads those from the chain, so nothing to commit.');
process.exit(lines.length ? 0 : 1);
