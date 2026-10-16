import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENDPOINTS, ERROR_CODE_LIST } from '@clear/public-api-contracts';
import { renderDocs } from './index';
import { NO_SERVER_SNIPPET, SERVER_SNIPPET, WEBHOOK_SNIPPET } from './snippets';

const PUBLIC_DIR = join(import.meta.dir, '..', '..', '..', 'apps', 'member', 'public');
const docs = renderDocs();

describe('what useclear.org serves', () => {
  test.each(Object.keys(docs))('%s is exactly what the contracts and snippets render (run `bun run write`)', (path) => {
    expect(readFileSync(join(PUBLIC_DIR, path), 'utf8')).toBe(docs[path]!);
  });
});

describe('llms.txt (§7)', () => {
  test('as drawn, then the MCP page under Optional', () => {
    expect(docs['llms.txt']!.startsWith(`# Clear
> Pay with Clear: online payments from Clear members (pay now or
> over time), with card on the shop's own Stripe as the fallback.

## Docs
- [Quickstart: no server](https://useclear.org/docs/quickstart.md)
- [Quickstart: with a server](https://useclear.org/docs/server.md)
- [Webhooks](https://useclear.org/docs/webhooks.md)
- [API reference](https://useclear.org/docs/api.md)
`)).toBe(true);
    expect(docs['llms.txt']).toContain('## Optional\n- [MCP server');
  });
});

describe('every example is the spec’s snippet (§1)', () => {
  test('no server, with a server, the webhook', () => {
    expect(docs['docs/quickstart.md']).toContain(NO_SERVER_SNIPPET);
    expect(docs['docs/server.md']).toContain(SERVER_SNIPPET);
    expect(docs['docs/server.md']).toContain(WEBHOOK_SNIPPET);
    expect(docs['docs/webhooks.md']).toContain(WEBHOOK_SNIPPET);
  });
  test('keys only in the approved form, and never the other product’s name', () => {
    for (const [path, body] of Object.entries(docs)) {
      expect({ path, old: /(?<!clear_)\b(pk|sk)_(live|test)_/.test(body) }).toEqual({ path, old: false });
      expect({ path, name: /clearpay/i.test(body) }).toEqual({ path, name: false });
    }
  });
});

describe('api.md is the contracts', () => {
  test('every route and every error code', () => {
    for (const e of ENDPOINTS) expect(docs['docs/api.md']).toContain(`\`${e.method} ${e.path}\``);
    for (const c of ERROR_CODE_LIST) expect(docs['docs/api.md']).toContain(`| \`${c}\` |`);
  });
});
