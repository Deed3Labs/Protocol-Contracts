/*
 * The map's style, from env (Phase 7d): MapLibre on OpenFreeMap's positron unless VITE_MAP_STYLE_URL
 * says otherwise, so moving to Mapbox later is configuration, not code. A Mapbox style needs its
 * public token (VITE_MAPBOX_TOKEN, a pk.…: a secret sk.… is never put in the page), which goes only on
 * requests to Mapbox; and the `mapbox://` addresses inside a Mapbox style are turned into the API's,
 * as Mapbox's own library does. When tiles fail, the drawn map takes over, as before.
 *
 * Mapbox's terms say which map libraries may draw its tiles: check them before pointing this at a
 * Mapbox style.
 */

export const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/positron';
type Env = Record<string, string | undefined>;
const env = (): Env => (import.meta as unknown as { env?: Env }).env ?? {};

export const mapStyle = (e: Env = env()) => e.VITE_MAP_STYLE_URL?.trim() || DEFAULT_STYLE;

/** The public token, only if it's a public one. */
export const mapToken = (e: Env = env()) => {
  const t = e.VITE_MAPBOX_TOKEN?.trim();
  return t && /^pk\./.test(t) ? t : null;
};

const API = 'https://api.mapbox.com';
const withToken = (u: string, token: string) => `${u}${u.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;

/** A Mapbox address as the API's: styles, sprites, fonts and tilesets. */
export function mapboxUrl(url: string): string {
  const m = /^mapbox:\/\/(styles|sprites|fonts)\/(.+)$/.exec(url);
  if (m) {
    const [, kind, rest] = m;
    if (kind === 'styles') return `${API}/styles/v1/${rest}`;
    if (kind === 'fonts') return `${API}/fonts/v1/${rest}`;
    // mapbox://sprites/user/id@2x.json → /styles/v1/user/id/sprite@2x.json
    const s = /^([^/]+)\/([^@.]+)(.*)$/.exec(rest);
    return s ? `${API}/styles/v1/${s[1]}/${s[2]}/sprite${s[3]}` : url;
  }
  const t = /^mapbox:\/\/([^?]+)(\?.*)?$/.exec(url);
  return t ? `${API}/v4/${t[1]}.json${t[2] ? `${t[2]}&secure` : '?secure'}` : url;
}

/** MapLibre's transformRequest: the token on Mapbox's requests, and nothing on anyone else's. */
export function mapRequest(url: string, e: Env = env()): { url: string } {
  const token = mapToken(e);
  const u = url.startsWith('mapbox://') ? mapboxUrl(url) : url;
  if (!token || !u.startsWith(`${API}/`) || /[?&]access_token=/.test(u)) return { url: u };
  return { url: withToken(u, token) };
}
