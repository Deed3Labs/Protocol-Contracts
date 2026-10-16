/**
 * A shop's web app manifest, on the page's own origin (browsers ignore a manifest whose start URL is
 * on another host). `vercel.json` rewrites `/s/:slug/manifest.webmanifest` here; the API builds it
 * from the shop's config (`GET /api/s/:slug/manifest.webmanifest`).
 */
export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const slug = new URL(req.url).searchParams.get('slug') ?? '';
  const api = (process.env.REWARDS_API_URL ?? '').replace(/\/+$/, '');
  if (!/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(slug) || !api) return new Response('Not found', { status: 404 });
  const upstream = await fetch(`${api}/api/s/${slug}/manifest.webmanifest`);
  if (!upstream.ok) return new Response('Not found', { status: upstream.status === 404 ? 404 : 502 });
  return new Response(await upstream.text(), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=300, s-maxage=300' },
  });
}
