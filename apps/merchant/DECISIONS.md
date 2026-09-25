
### Smart readers are driven from the server (2026-09-24)

Stripe recommends the server-driven integration for smart readers (S700/S710, WisePOS E): its
browser SDK needs the counter device and the reader on the same local network. So the app no longer
loads `@stripe/terminal-js` at all. For a smart reader, on the web and in the installed app alike, it
asks the API to start the card tender and send it to the reader (`POST /api/merchant/tenders/:id/present`),
then follows the tender (`/sync`) to approved or declined. The M2 and Tap to Pay still collect on
the device through the Capacitor plugin, then the server catches up. **Nothing in the app captures:**
the server captures at Close the day. See `src/reader/server.ts`.
