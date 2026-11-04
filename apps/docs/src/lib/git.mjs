// When each docs file last changed, from git. One `git log` for every file rather than one per file.
//
// A shallow clone (Vercel's) only has the last few commits, and its oldest commit looks as if it
// changed every file. Those boundary commits are skipped, so a file last changed before the clone's
// history began gets no date rather than a wrong one. No git at all: no dates.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

/** Map of repo-relative path -> { iso: 'YYYY-MM-DD', ts: unix seconds } for files under `paths`. */
export function lastChanged(root, paths) {
  const out = new Map();
  let log;
  let boundary = new Set();
  try {
    const shallowFile = git(root, ['rev-parse', '--git-path', 'shallow']).trim();
    const abs = isAbsolute(shallowFile) ? shallowFile : join(root, shallowFile);
    if (existsSync(abs)) boundary = new Set(readFileSync(abs, 'utf8').split('\n').filter(Boolean));
    log = git(root, ['log', '--no-renames', '--format=%x00%H %ct %cs', '--name-only', '--', ...paths]);
  } catch {
    return out;
  }
  for (const chunk of log.split('\0')) {
    if (!chunk.trim()) continue;
    const [head, ...files] = chunk.split('\n');
    const [sha, ts, iso] = head.trim().split(' ');
    if (boundary.has(sha)) continue;
    for (const f of files) {
      const file = f.trim();
      if (file && !out.has(file)) out.set(file, { iso, ts: Number(ts) });
    }
  }
  return out;
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tue 3 Nov", with the year when it isn't `thisYear`. */
export function niceDate(iso, thisYear = new Date().getUTCFullYear()) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  const s = `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === thisYear ? s : `${s} ${d.getUTCFullYear()}`;
}
