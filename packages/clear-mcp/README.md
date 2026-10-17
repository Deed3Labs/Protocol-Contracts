# @useclear/mcp

Let your shop's AI agent work with your Clear account: make payment links, look up payments, ask for
refunds, and check your webhooks. It's an [MCP](https://modelcontextprotocol.io) server, so it works with
Claude Desktop, Claude Code, Cursor and other MCP clients. Node 18 or later.

It isn't on npm yet. When published, you run it with `npx @useclear/mcp`.

## Add it to your agent

It runs with your secret key from Developers in the merchant app, in the environment as
`CLEAR_SECRET_KEY`. It takes no flags, so the key is never typed on a command line.

When published, add this to your client's MCP config:

```json
{
  "mcpServers": {
    "clear": {
      "command": "npx",
      "args": ["-y", "@useclear/mcp"],
      "env": { "CLEAR_SECRET_KEY": "clear_sk_live_…" }
    }
  }
}
```

- **Claude Desktop**: Settings → Developer → Edit Config (`claude_desktop_config.json`), then restart it.
- **Claude Code**: `.mcp.json` in your project. To keep the key out of git, write `"CLEAR_SECRET_KEY": "${CLEAR_SECRET_KEY}"` and Claude Code fills it in from your environment.
- **Cursor**: `~/.cursor/mcp.json`, or `.cursor/mcp.json` in your project (keep that one out of git).

It won't start without a key, with a key that isn't `clear_sk_test_…` or `clear_sk_live_…`, or with a
publishable key (`clear_pk_…`, which belongs in the browser). It never shows the key to the agent.

## Tools

- `create_payment_link`: a link to text, email or print, for an amount in cents or a price from Inventory and a quantity, with an optional note and expiry.
- `get_payment`: one payment, by its id (`pay_…`) or your reference.
- `list_payments`: payments in a date range, newest first (a bare date like `2026-10-15` is that whole day in UTC).
- `refund_payment`: asks for a refund of a card payment, whole or in part. It never refunds by itself (below).
- `list_webhook_deliveries`: what Clear sent your webhook endpoints, and whether it got there.

Money comes back in cents and as dollars (`"$185.32"`), so the agent reads amounts instead of working them out.

## Refunds wait for you

`refund_payment` always asks for approval. The refund waits until an owner or manager approves it in the
merchant app, under Charges; nothing goes back to the customer before that. A Clear payment is refunded from
Charges too, where the owner approves it: the agent is told so, and nothing is changed.

## Test mode

Use a `clear_sk_test_…` key to try it. Test keys only see test payments, and nothing moves money.

## Errors

When Clear refuses a request, the tool answers with Clear's `code` and `message` (and `param`, `requestId`
when there is one), marked as an error, so the agent can say what went wrong. `connection_error` means Clear
never answered.
