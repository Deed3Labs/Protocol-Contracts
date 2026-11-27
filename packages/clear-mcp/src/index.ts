/**
 * @useclear/mcp: an MCP server that lets a shop's AI agent act on its Clear account. Run it with
 * `npx @useclear/mcp` and CLEAR_SECRET_KEY in the environment; or build your own over these.
 */
export { readSecretKey, redactKeys, type KeyCheck } from './key';
export { formatUsd } from './money';
export { createServer, TOOL_NAMES } from './server';
export {
  createPaymentLink,
  getPayment,
  listPayments,
  listWebhookDeliveries,
  refundPayment,
  REFUND_IN_APP,
  REFUND_WAITING,
  toTimestamp,
  type ClearClient,
  type ToolResult,
} from './tools';
export { MCP_VERSION } from './version';
