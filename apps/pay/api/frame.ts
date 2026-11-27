import { frameHeaders, lookupOrigin } from './_frameHeaders.js';

/**
 * `/m/:session`, the modal: the app's page with a `frame-ancestors` for that session's website alone.
 * `vercel.json` rewrites `/m/:session` here.
 */
declare const process: { env: Record<string, string | undefined> };

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const session = url.searchParams.get('session') ?? '';
  const api = (process.env.PAY_API_URL ?? process.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
  const [origin, page] = await Promise.all([lookupOrigin(api, session), fetch(new URL('/index.html', url))]);
  if (!page.ok) return new Response('Not found', { status: 404, headers: frameHeaders(null) });
  return new Response(await page.text(), { status: 200, headers: frameHeaders(origin) });
}
