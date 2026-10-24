import { vars } from '../sections/data';
import { api } from './api';

/*
 * The feeds' health from the API (Phase 6a): the menu's line, each figure's freshness label and
 * Home's sources. Read with every section load and every 5 minutes while the app is open.
 */

type Health = 'synced' | 'behind' | 'failing' | 'off' | 'never';
interface FeedStatus {
  id: string;
  name: string;
  health: Health;
  behindMs: number | null;
  error: string | null;
  offReason: string | null;
}
interface Feeds {
  feeds: FeedStatus[];
  line: { headline: string; rest: string; worst: string | null };
}

const feeds = () => (vars as { feeds?: Feeds }).feeds;
let timer: ReturnType<typeof setInterval> | null = null;

export async function loadFeeds(): Promise<void> {
  (vars as { feeds?: Feeds }).feeds = await api<Feeds>('GET', '/feeds');
  drawFeedLine();
  timer ??= setInterval(() => void loadFeeds().catch(() => undefined), 5 * 60_000);
}

export const hasFeeds = () => !!feeds();
export const feedOf = (id: string) => feeds()?.feeds.find((f) => f.id === id);

export const ago = (ms: number) =>
  ms < 90_000
    ? `${Math.max(1, Math.round(ms / 1000))} s`
    : ms < 90 * 60_000
      ? `${Math.round(ms / 60_000)} min`
      : ms < 36 * 3600e3
        ? `${Math.round(ms / 3600e3)} h`
        : `${Math.round(ms / 86_400e3)} days`;

/** "Plaid · 3 h": how old a source's figures are, as the prototype's labels say it. */
export function feedLabel(id: string): string {
  const f = feedOf(id);
  if (!f) return '';
  if (f.health === 'off') return `${f.name} · off`;
  if (f.behindMs == null) return `${f.name} · not synced yet`;
  return `${f.name} · ${ago(f.behindMs)}`;
}

/** Whether a source's figures are late enough to say so. */
export const feedLate = (id: string) => ['behind', 'failing'].includes(feedOf(id)?.health ?? '');

/** A source's chip: its class and words. */
export function feedChip(f: FeedStatus): [string, string] {
  return f.health === 'synced'
    ? ['settled', 'Synced']
    : f.health === 'behind'
      ? ['underway', `${ago(f.behindMs ?? 0)} behind`]
      : f.health === 'failing'
        ? ['absent', 'Not reached']
        : f.health === 'off'
          ? ['plain', 'Off']
          : ['plain', 'Not synced yet'];
}

export const feedList = () => feeds()?.feeds ?? [];
export const feedLine = () => feeds()?.line;

/** The menu's foot: the worst feed, then how the others are. */
function drawFeedLine() {
  const line = feedLine();
  const b = document.querySelector<HTMLButtonElement>('.rail-ft button[data-go]');
  if (!line || !b) return;
  const words = b.querySelector(':scope > span:last-child');
  const head = words?.querySelector(':scope > span');
  b.title = line.rest ? `${line.headline} · ${line.rest}` : line.headline;
  b.classList.toggle('ok', !line.worst);
  if (head) head.textContent = line.headline;
  if (words) {
    for (const n of [...words.childNodes].slice(1)) n.remove();
    if (line.rest) words.append(document.createElement('br'), line.rest);
  }
}
