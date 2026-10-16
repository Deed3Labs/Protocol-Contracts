/**
 * The MCP wiring: the five tools from tools.ts, registered on an McpServer over a Clear client. The
 * transport is the caller's (stdio in cli.ts, in-memory in the tests).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { redactKeys } from './key';
import {
  createPaymentLink,
  createPaymentLinkInput,
  errorResult,
  getPayment,
  getPaymentInput,
  listPayments,
  listPaymentsInput,
  listWebhookDeliveries,
  listWebhookDeliveriesInput,
  refundPayment,
  refundPaymentInput,
  type ClearClient,
  type ToolResult,
} from './tools';
import { MCP_VERSION } from './version';

export const TOOL_NAMES = ['create_payment_link', 'get_payment', 'list_payments', 'refund_payment', 'list_webhook_deliveries'] as const;

const instructions = (livemode: boolean) =>
  [
    `Pay with Clear, for one shop, with its secret key (${livemode ? 'live mode: real money' : 'test mode: nothing moves money'}).`,
    'Amounts are integer cents, and every result also gives them as dollars ("$185.32"): read those rather than working them out.',
    'refund_payment never refunds by itself: an owner or manager approves each refund in the merchant app, under Charges.',
  ].join(' ');

/** Every result leaves through here: a key-shaped string never reaches the agent, whoever wrote it. */
const safe = (result: ToolResult): ToolResult => ({ ...result, content: result.content.map((c) => ({ ...c, text: redactKeys(c.text) })) });

/** A handler that throws anyway (a bug) still answers with a tool result, not a crashed call. */
const guarded =
  <I>(handler: (clear: ClearClient, input: I) => Promise<ToolResult>, clear: ClearClient) =>
  async (input: I): Promise<ToolResult> => {
    try {
      return safe(await handler(clear, input));
    } catch (err) {
      console.error('useclear-mcp:', redactKeys(String(err)));
      return safe(errorResult(err));
    }
  };

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

export function createServer(clear: ClearClient, options: { livemode: boolean }): McpServer {
  const server = new McpServer({ name: 'useclear-mcp', version: MCP_VERSION }, { instructions: instructions(options.livemode) });

  server.registerTool(
    'create_payment_link',
    {
      title: 'Make a payment link',
      description: 'Make a Clear payment link to text, email or print: for an amount in cents, or for a price from Inventory and a quantity. Returns its URL.',
      inputSchema: createPaymentLinkInput,
      annotations: WRITE,
    },
    guarded(createPaymentLink, clear),
  );

  server.registerTool(
    'get_payment',
    {
      title: 'Look up a payment',
      description: "One payment, by its id (pay_…) or the shop's reference: its amount, lines, status, how it was paid and what's been refunded.",
      inputSchema: getPaymentInput,
      annotations: READ,
    },
    guarded(getPayment, clear),
  );

  server.registerTool(
    'list_payments',
    {
      title: 'List payments',
      description: 'Payments in a date range, newest first: id, reference, amount, status, method and when. hasMore says there are more than the limit.',
      inputSchema: listPaymentsInput,
      annotations: READ,
    },
    guarded(listPayments, clear),
  );

  server.registerTool(
    'refund_payment',
    {
      title: 'Ask for a refund',
      description:
        "Ask for a refund of a card payment, whole or in part. It never refunds by itself: it waits for an owner or manager to approve it in Clear's merchant app, under Charges. A Clear payment is refunded there instead.",
      inputSchema: refundPaymentInput,
      annotations: WRITE,
    },
    guarded(refundPayment, clear),
  );

  server.registerTool(
    'list_webhook_deliveries',
    {
      title: 'List webhook deliveries',
      description: "Events Clear sent to the shop's webhook endpoints, newest first: event type, status, attempts, the endpoint's last HTTP status and the next retry.",
      inputSchema: listWebhookDeliveriesInput,
      annotations: READ,
    },
    guarded(listWebhookDeliveries, clear),
  );

  return server;
}
