// Build, serve dist/ on http://localhost:5240, and rebuild when the docs or this app change.
// `npm run dev -w @clear/docs` (PORT=… to move it).
import { createReadStream, existsSync, statSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { buildSite, REPO } from '../src/lib/build.mjs';

const PORT = Number(process.env.PORT) || 5240;
const DIST = join(REPO, 'apps/docs/dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function rebuild() {
  const t = Date.now();
  try {
    buildSite();
    console.log(`built in ${Date.now() - t} ms`);
  } catch (e) {
    console.error(e.message || e);
  }
}
rebuild();

// The same lookups Vercel makes with cleanUrls: /a/b -> /a/b/index.html, then 404.html.
export function resolve(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const base = join(DIST, clean);
  for (const f of [base, join(base, 'index.html'), `${base}.html`]) {
    if (existsSync(f) && statSync(f).isFile()) return { file: f, status: 200 };
  }
  return { file: join(DIST, '404.html'), status: 404 };
}

createServer((req, res) => {
  const { file, status } = resolve(req.url || '/');
  if (!existsSync(file)) {
    res.writeHead(500).end('Not built');
    return;
  }
  res.writeHead(status, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Clear docs on http://localhost:${PORT}`));

let timer = null;
const later = () => {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 150);
};
for (const dir of ['docs', 'apps/member/public/docs', 'apps/docs/src', 'apps/docs/public', 'deployments']) {
  const abs = join(REPO, dir);
  if (existsSync(abs)) watch(abs, { recursive: true }, later);
}
