/**
 * The city Vercel places this request in, for the sign-in log ("Mac · Redlands"). A city, never an
 * address or an IP. Empty off Vercel (local dev).
 */
export const config = { runtime: 'edge' };

export default function handler(req: Request): Response {
  const raw = req.headers.get('x-vercel-ip-city') ?? '';
  let city = '';
  try {
    city = decodeURIComponent(raw);
  } catch {
    city = '';
  }
  return new Response(JSON.stringify({ city }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
