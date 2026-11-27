import { renderApiMd } from './api';
import { llmsTxt, mcpMd, quickstartMd, serverMd, webhooksMd } from './pages';

/**
 * @clear/pay-docs: Pay with Clear's docs for AI (pay spec §7), served by apps/member at useclear.org.
 * `bun run write` puts them in apps/member/public; `docs.test.ts` fails if the committed files differ.
 */
export const renderDocs = (): Record<string, string> => ({
  'llms.txt': llmsTxt(),
  'docs/quickstart.md': quickstartMd(),
  'docs/server.md': serverMd(),
  'docs/webhooks.md': webhooksMd(),
  'docs/mcp.md': mcpMd(),
  'docs/api.md': renderApiMd(),
});

export { renderApiMd } from './api';
export * from './snippets';
