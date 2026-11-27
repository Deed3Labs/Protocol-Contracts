/**
 * Starting the server: check the key, then serve on stdio. stdout is the protocol, so everything said to
 * a person goes to stderr. Kept apart from cli.ts so a test can call it without it running on import.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import Clear from '@useclear/node';
import { readSecretKey } from './key';
import { createServer } from './server';

export async function main(argv: string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env): Promise<number> {
  if (argv.length) {
    // No flags at all, --key above all: a key on the command line stays in shell history and in the config.
    console.error('useclear-mcp takes no arguments. Put your secret key in the environment as CLEAR_SECRET_KEY.');
    return 1;
  }
  const key = readSecretKey(env);
  if (!key.ok) {
    console.error(`useclear-mcp: ${key.message}`);
    return 1;
  }
  const server = createServer(new Clear(key.key), { livemode: key.livemode });
  await server.connect(new StdioServerTransport());
  console.error(`useclear-mcp: ready (${key.livemode ? 'live' : 'test'} mode)`);
  return 0;
}
