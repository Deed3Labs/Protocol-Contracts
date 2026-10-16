# Pay with Clear: the MCP server

`@useclear/mcp` lets an AI agent (Claude, Cursor and others) act on a shop's Clear account: make payment
links, look up payments, and ask for refunds. It runs on the shop's own computer with the shop's secret
key from the environment; the agent never sees the key.

## Set up

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

Use a `clear_sk_test_…` key to try it without moving money.

## Tools

- `create_payment_link`: for an amount or a price. Returns the link to send.
- `get_payment`: by id (`pay_…`) or by the shop's reference.
- `list_payments`: in a date range.
- `refund_payment`: asks the owner first. It never refunds by itself: it makes a refund request that an
  owner or manager approves in the merchant app, under Charges. A Clear payment is refunded from Charges.
- `list_webhook_deliveries`: what was sent to the shop's webhooks, and how each endpoint answered.

The publishable key in examples, `clear_pk_live_mc8Q2v`, is the spec's; use the shop's own.
