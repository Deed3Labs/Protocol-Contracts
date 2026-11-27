/** `npx @useclear/mcp`: the MCP server on stdio, with the shop's secret key from CLEAR_SECRET_KEY. */
import { main } from './main';

main().then(
  (code) => {
    if (code) process.exit(code);
  },
  (err: unknown) => {
    console.error('useclear-mcp: could not start:', err instanceof Error ? err.name : 'error');
    process.exit(1);
  },
);
