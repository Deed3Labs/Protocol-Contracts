// @ts-nocheck: answers the live app's untyped API calls from a saved file.
import { ApiError } from './api';
import { ROLES, VSEC } from '../sections/data';
import { ANSWERS } from './env';

/*
 * Dev only (`?answers=<file>`): the live app's API calls answered from a saved file, so a page can be
 * checked against the API's real answers through the live code paths, signed in as an admin, with no
 * network and no Privy. The file holds what GET /sections/<name> returned for each section, by name;
 * anything else answers as an admin's empty account would.
 */

let saved: Promise<Record<string, unknown>> | null = null;
// a failed load isn't kept: the next call tries again
const file = () =>
  (saved ??= fetch(ANSWERS!, { cache: 'no-store' })
    .then((r) => r.json())
    .catch((e) => {
      saved = null;
      throw e;
    }));

const ALL = Object.fromEntries(['home', 'growth', 'field', 'members', 'merchants', 'shop', 'money', 'contracts', 'community', 'governance', 'records', 'access', 'settings'].map((k) => [k, 4]));
const ME = { id: 'answers', name: 'Saved answers', email: 'answers@localhost', levels: ALL, group: { key: 'admin', name: 'Admin', description: 'Runs the co-op day to day' }, terms: { required: false }, expiresAt: null };

export async function answer(method: string, path: string): Promise<unknown> {
  const f = await file();
  if (method !== 'GET') throw new ApiError(400, 'SAVED_ANSWERS', 'Saved answers only: nothing changes here');
  const sec = /^\/sections\/(\w+)/.exec(path);
  if (sec) {
    const d = f[sec[1]];
    if (!d) throw new ApiError(404, 'NOT_SAVED', `No saved answer for ${sec[1]}`);
    if (d.__error) throw new ApiError(500, 'ERROR', d.__error);
    return d;
  }
  if (path === '/me') return { me: f.me ?? ME };
  if (path === '/groups')
    return (
      f.groups ?? {
        // the app's own groups, the seven the API keeps, as GET /groups shapes them
        groups: Object.entries(ROLES).map(([key, [name, description, levels, auto]]) => ({
          key,
          name,
          description,
          auto: !!auto,
          levels: Object.fromEntries(VSEC.map((k, i) => [k === 'team' ? 'access' : k, levels[i]])),
        })),
      }
    );
  if (path === '/people') return f.people ?? { people: [{ id: ME.id, name: ME.name, email: ME.email, group: 'admin', since: new Date().toISOString(), lastSignIn: new Date().toISOString(), signIns: [], devices: [], passkey: true }] };
  if (path.startsWith('/proposals')) return { proposals: [] };
  if (path === '/feeds') return f.feeds ?? { feeds: [], line: null };
  throw new ApiError(404, 'NOT_SAVED', `No saved answer for ${path}`);
}
