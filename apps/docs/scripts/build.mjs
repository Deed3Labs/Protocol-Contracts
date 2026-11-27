// Build the docs site into apps/docs/dist: `npm run build -w @clear/docs`.
import { buildSite, NavError } from '../src/lib/build.mjs';

try {
  buildSite();
} catch (e) {
  console.error(e instanceof NavError ? `apps/docs: the nav and the docs disagree.\n${e.message}` : e);
  process.exit(1);
}
