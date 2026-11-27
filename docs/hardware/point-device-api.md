# Clear Point: the device API

The contract the Point firmware is built from. The firmware lives in its own repository; this file
fixes everything it talks to: the tablet that sets it up over Bluetooth, and the Clear API it
follows afterwards.

The schemas named here are in `packages/merchant-contracts/src` (`devices.ts`, `public.ts`); they are
the source when this file and they disagree. `apps/merchant/scripts/fake-point.ts` is a Point that
follows this contract, and the API's route test runs it against the real routes.

## The one rule

The tablet talks to the drawer, the printer and the card reader directly. **Only the Point listens
to the server.** A Point never talks to the tablet after setup, never talks to a card reader (the M2
in a Pay case is driven by the tablet), and never decides what to show: the server does, and the
Point draws it.

## 1. Identity

| What | Value |
| --- | --- |
| Code | Four characters, Crockford base32 (`0-9 A-Z` without `I L O U`): `A7K2`. Printed under the QR on the back and on the box. |
| QR and printed URL | `useclear.org/p/<code>`. The same URL the screen's `url` field carries. |
| Bluetooth name | `CLEAR-<code>`, advertised while unprovisioned. |
| Device key | 32+ characters, from activation. The only credential after setup. |
| Models | `point` (battery, e-ink) and `point_large` (the counter's, plugged in). |

The factory adds each Point's code to `merchant.point_keys` before it ships; a code that isn't there
can't be claimed.

## 2. Setup

Setup is three parties in order: the **tablet claims** the Point on the server, **hands it** the
Wi-Fi and a one-time secret over Bluetooth, and the **Point activates** with that secret.

```
tablet                         Point                          Clear API
  │ POST /api/merchant/points/claim {code} ─────────────────────▶ │  binds it to the shop
  │ ◀──────────────── {device, provisioning:{secret, apiBase, expiresAt}}
  │ ── BLE: session (code as proof) ──▶ │
  │ ── BLE: clear-claim {code, secret, apiBase} ──▶ │
  │ ── BLE: Wi-Fi, apply ─────────────▶ │ joins the network
  │ ── BLE: status, clear-reach ──────▶ │ ── reaches apiBase
  │                                     │ POST /api/device/point/activate {code, secret} ──▶ │
  │                                     │ ◀─────────────────────────────── {deviceKey}
```

The secret is good for **ten minutes and once**. A Point claimed but never activated can be claimed
again by the same shop, which issues a fresh secret.

### 2.1 Bluetooth provisioning

Points use **ESP32 unified provisioning** (ESP-IDF `wifi_provisioning`, protocomm over BLE) so the
firmware can run Espressif's component unchanged, plus two endpoints of Clear's own registered with
`wifi_prov_mgr_endpoint_create` / `_register`.

| | |
| --- | --- |
| Service | `6c3a1001-7b52-4c1f-9d3e-5c6c65617201` |
| Security | **Security 1** (`WIFI_PROV_SECURITY_1`) |
| Proof of possession | The Point's code, upper case: `A7K2` |
| Scheme | `wifi_prov_scheme_ble` |

Each endpoint is a characteristic of the service with a **user description descriptor (0x2901)
naming it**. The tablet finds endpoints by that name, never by UUID, so the firmware may use
Espressif's derived UUIDs. A request is a write; its answer is the read that follows. Writes can
exceed one MTU: the firmware must accept long (queued) writes, as protocomm does.

| Endpoint | Encrypted | Request → answer |
| --- | --- | --- |
| `proto-ver` | no | anything → JSON (below) |
| `prov-session` | no (it is the handshake) | `SessionData` (Security 1) |
| `prov-scan` | yes | `WiFiScanPayload` |
| `prov-config` | yes | `WiFiConfigPayload` |
| `clear-claim` | yes | JSON → JSON |
| `clear-reach` | yes | JSON → JSON |

The message field numbers are ESP-IDF's (`components/protocomm/proto`, `components/wifi_provisioning/proto`);
`apps/merchant/src/hardware/point/provisioning/messages.ts` lists the ones the tablet uses.

**`proto-ver`** answers Espressif's version JSON with Clear's block added (`wifi_prov_mgr_set_app_info`):

```json
{
  "prov": { "ver": "v1.1", "sec_ver": 1, "cap": ["wifi_scan"] },
  "clear": { "code": "A7K2", "firmware": "1.0.3", "battery": 100 }
}
```

The tablet's Add a Point shows "Found it · Point A7K2 New · firmware 1.0.3 · battery 100%" from it.

**Security 1.** X25519; the shared secret XORed with SHA-256 of the proof of possession is the
AES-256-CTR key; the device's 16 random bytes are the counter block. **One CTR stream runs through
the whole session in both directions**, in the order messages are sent: the client's verify data,
the device's verify data, then each request and each answer. A wrong code fails at the second
handshake step (`Status: CryptoError`), and nothing else can be asked without a session.

**`prov-scan`.** Blocking scan (`blocking: true`, `period_ms: 120`); the tablet reads results four
at a time. It lists each network name once at its strongest, and marks `WPA2_ENTERPRISE` networks as
unusable.

**`prov-config`.** Set config (SSID, passphrase), apply, then get status, which the tablet asks every
half second for up to 30 seconds. `ConnectionFailed` with `AuthError` reads "That password didn't
work"; with `NetworkNotFound`, "The Point can't see that network".

**`clear-claim`** (before the Wi-Fi is applied):

```json
{ "code": "A7K2", "secret": "<from the claim>", "apiBase": "https://api.useclear.org" }
```

The Point keeps all three in encrypted NVS and answers `{"ok": true}`, or
`{"ok": false, "error": "That setup isn't for this Point"}` when the code isn't its own. Once on the
network it activates (2.2) with them.

**`clear-reach`** (after `Connected`): the Point checks it can reach `apiBase` over HTTPS. The tablet
asks every half second for up to 15 seconds.

```json
{ "server": "checking" }   // still trying
{ "server": "ok" }         // reached Clear
{ "server": "portal" }     // got a sign-in page instead: "Has a sign-in page, so a Point can't use it"
{ "server": "offline" }    // the network has no internet
```

A portal shows as an HTTP redirect or a 200 that isn't Clear's answer from
`GET <apiBase>/health`. On `portal` or `offline` the Point forgets that Wi-Fi and stays in setup.

### 2.2 Activation

```
POST /api/device/point/activate
{ "code": "A7K2", "secret": "<from clear-claim>" }
→ 200 { "deviceKey": "<32+ characters>" }
```

| Status | Meaning | The Point |
| --- | --- | --- |
| 200 | Activated | Stores the key in encrypted NVS, wipes the secret, leaves setup |
| 403 | Wrong secret | Stays in setup |
| 410 | Ten minutes passed | Stays in setup ("Add the Point again" on the tablet) |
| 422 | Not a code and a secret | Stays in setup |
| 429 | More than 10 tries a minute from one address | Waits a minute, tries again |

Only hashes of the secret and the key are kept on the server.

## 3. Every request after setup

```
Authorization: Bearer <deviceKey>
```

| Status | Meaning | The Point |
| --- | --- | --- |
| 401 | The key isn't known: **the Point was unpaired** (or removed) | Wipes its key and Wi-Fi, goes back to its setup screen (Settings › Devices: "Unpairing wipes its Wi-Fi and it goes back to its setup screen") |
| 503 | The server can't answer now | Keeps what it shows, retries (5) |
| 5xx, timeouts, no network | Can't reach Clear | See 5 |

Any authenticated request counts as the Point being heard from. The merchant app shows a Point
**Online while heard from in the last ten minutes**, so a Point must make at least one request every
ten minutes, asleep or not.

## 4. Following what to show

### 4.1 On battery: long poll

```
GET /api/device/point/state
If-None-Match: "<last ETag>"
```

- **200** with an `ETag` header and the screen JSON (4.3): draw it, keep the ETag.
- **304** after about 25 seconds when nothing changed: nothing to draw.
- The server **holds the request** until something changes (a bill sent, a party seated, a Call
  answered) or until what's shown lapses by itself (a paid bill after three minutes, a hold after
  fifteen, a Call after ten), so a Point holding a request sees a change at once.

Between requests a battery Point sleeps **`pollSeconds`** (the field in the screen JSON; 30 now),
then asks again. The first request after waking carries the last ETag.

### 4.2 Plugged in: the stream

```
GET /api/device/point/stream
Accept: text/event-stream
```

```
event: state
id: "<etag>"
data: {…the screen JSON…}

: keep-alive
```

An event is sent at once on connecting, then on every change. A comment line every 20 seconds keeps
proxies from closing it. On a dropped stream, reconnect after 1, 2, 4… seconds, up to 60. A Point on
`pluggedIn: true` (its health) should hold the stream; one on battery should long-poll.

### 4.3 The screen JSON (`PointScreen`)

```json
{
  "code": "A7K2",
  "shop": { "name": "Mi Casa Tacos" },
  "table": "Table 12",
  "tableNumber": 12,
  "placement": "table",
  "view": "bill",
  "state": { "kind": "bill", "orderId": "ord_…", "since": "2026-10-15T19:42:00-07:00" },
  "lit": false,
  "bill": {
    "orderNumber": 141,
    "lines": [
      { "name": "Al pastor", "quantity": 4, "lineCents": 1800 },
      { "name": "Horchata", "quantity": 2, "lineCents": 700 },
      { "name": "Nachos grande", "quantity": 1, "lineCents": 1950 }
    ],
    "discountCents": 0, "taxCents": 370, "tipCents": 0, "totalCents": 4820, "remainingCents": 4820,
    "sentAt": "2026-10-15T19:42:00-07:00"
  },
  "paid": null,
  "waitlist": null,
  "pay": { "clear": true, "card": true },
  "alert": null,
  "showcase": null,
  "url": "useclear.org/p/A7K2",
  "pollSeconds": 30
}
```

What to draw is decided by `state.kind`, then `state.mode` when idle. The drawings are the
terminal reference's, built as React components in `apps/merchant/src/terminal/drawings.tsx`, which
the firmware's layouts follow:

| `state.kind` | Draws | Drawing |
| --- | --- | --- |
| `idle`, mode `number` | The table's number large, "Scan for the menu · Pay here too", the QR | `PointNumber` |
| `idle`, mode `menu` | The menu by category (`GET /api/p/:code/menu`, public) | (the phone menu's rows) |
| `idle`, mode `showcase` | `showcase` groups, a page at a time | `PointShowcase` |
| `idle`, mode `pay` | Pay here and the QR | (the counter's) |
| `idle`, mode `waitlist` | The wait list's join QR and `waitlist.quotedMinutes` | (the door's) |
| `held` | Inverted: `partyName`, or **Reserved** when null; party size; table | `PointHeld` |
| `bill` | `bill`'s lines, tax, total, the QR | `PointBill`, `PointCounterBill` at the counter |
| `paid` | Paid, until it lapses | (the phone's Paid) |
| `called`, `bill_asked` | The Call or Bill was pressed and staff are told | `PointCalled` |
| `alert` | Inverted: `alert.label` ("27 · ORDER Ready.", "Your table is ready") | `PointReady` |
| `test` | The test screen from its pane | |

**`lit`** drives the screen's front light **and the Pay case's ring light** (they share the ready
light's pin): on for `held`, `called` and `bill_asked`.

Unknown `state.kind` values from a newer server: draw the idle mode the Point last had.

## 5. When it can't reach Clear

**Proposed; the terminal reference doesn't draw it.** The firmware follows this unless the reference
adds a drawing.

- E-ink keeps the last screen with no power, so **a Point keeps what it shows** while it retries.
- After **ten minutes** without an answer (the merchant app already shows it Offline by then), a
  `bill`, `paid`, `called`, `bill_asked` or `alert` screen gives way to the **idle screen it last
  had** (its number and QR, or Pay here), so nobody pays from a bill that may be stale. The QR still
  works: the phone page reads the server, not the Point.
- A `held` screen keeps the name until its `expiresAt`, then the number.
- Retries: 5, 10, 20, 40 seconds, then every 60 while plugged in, or every `pollSeconds` on battery.
- Button presses made offline are kept with their time and sent when the connection is back (6).
- No new text appears on the screen for being offline.

## 6. Health and buttons

### 6.1 Health

```
POST /api/device/point/health        → 204
{
  "batteryPercent": 82,
  "pluggedIn": false,
  "rssi": -61,
  "ssid": "MiCasa-Staff",
  "firmware": "1.0.3",
  "case": { "kind": "pay", "buttons": "ok" }
}
```

`PointHealthReport`: `batteryPercent` 0–100, `rssi` dBm (−127 to 0), `case` null with no Pay case
on the pogo pins, `buttons: "fault"` when a button doesn't answer its self-test. Send it after
activation, on every wake where battery moved 5 points or more, when the case is fitted or removed,
when plugged in or out, and at least every 30 minutes. Settings › Devices shows it as Health
(battery and its estimate, signal, last heard from, firmware).

### 6.2 Pay case buttons

```
POST /api/device/point/event
{ "kind": "button", "button": "call", "at": "2026-10-15T20:00:12.400Z" }
→ 200 { "request": { "id": "treq_…", "kind": "call", "state": "open", … } }   or   { "request": null }
```

- Debounce 50 ms on the device. A second press **within three seconds** of the first is the same
  press; a **later** Call press while one is open **cancels** it (the screen says "Press it again to
  cancel").
- `at` is when it was pressed. A press made offline is sent when the connection returns if it is
  **under two minutes old**, otherwise dropped.
- `request: null` means the press did nothing: the Point isn't at a table, the Call button is off in
  its pane, or the press was stale.
- **Bill** with "Send the bill to the Point" sends the table's tab to this Point (its state becomes
  `bill`); with "Just tell staff" it opens a `bill_asked` request. Either way the next screen comes
  through 4.

## 7. Firmware updates

```
GET /api/device/point/firmware
Authorization: Bearer <deviceKey>
→ 200 { …PointFirmware… }   or   204 (nothing published for its model)
```

```json
{
  "model": "point",
  "version": "1.0.4",
  "url": "https://<store>.public.blob.vercel-storage.com/point/point-1.0.4.bin",
  "sha256": "<hex of the image>",
  "sizeBytes": 1048576,
  "minBattery": 40,
  "keyId": "clear-2026",
  "signature": "<base64 Ed25519>"
}
```

**What is signed** (`firmwareSigningPayload`): these fields, one per line, in this order, UTF-8,
no trailing newline:

```
clear-point-firmware/v1
<model>
<version>
<url>
<sha256>
<sizeBytes>
<minBattery>
<keyId>
```

**The firmware:**

- Carries **two Ed25519 public keys**, the release key and a backup kept offline, by key id. A
  manifest whose `keyId` isn't one of them, or whose signature doesn't verify over the lines above,
  is ignored. So is one whose `model` isn't its own, or whose `version` isn't newer than its own
  (compared as three numbers: 1.0.10 is newer than 1.0.9).
- Asks at most once a day, and installs only when it has shown idle for 30 minutes and is plugged
  in or above `minBattery`.
- Downloads `url` into the inactive OTA slot (ESP-IDF OTA), refusing it if its size or SHA-256
  doesn't match, then boots it. A new image that can't reach `/state` within five minutes of booting
  rolls back.
- Reports its new `firmware` in its next health report. Settings › Devices shows "up to date" when it
  matches the newest published release for its model.

**The server** never holds a private key. It publishes only a manifest that verifies against the
public keys in `POINT_FIRMWARE_KEYS` (`keyId:base64,…`, the same keys the firmware carries) and is
newer than any already published for that model. A server that was broken into can withdraw an
update but can't forge one: the Point checks the signature again itself. `POINT_FIRMWARE_LATEST` is
only a fallback for "up to date" before any release is published.

**Releasing** (`apps/api/scripts/point-firmware.ts`):

1. **Once:** `bun scripts/point-firmware.ts keygen clear-2026` on the key holder's own machine.
   The private half goes in a password manager and nowhere else. The public line
   (`clear-2026:<base64>`) goes into the firmware's trusted keys and into `POINT_FIRMWARE_KEYS` on
   the API. Do it twice: the second key is the backup, its private half kept offline.
2. **Upload** the image to Vercel Blob (public, served from Vercel's CDN, no build) under
   `point/<model>-<version>.bin`, and copy its URL. Any HTTPS host works: the manifest carries the
   hash, so the host is never trusted.
3. **Sign**, on the key holder's machine:
   `CLEAR_FIRMWARE_KEY=<private> bun scripts/point-firmware.ts sign clear-2026 point 1.0.4 <url> point-1.0.4.bin > point-1.0.4.json`.
4. **Publish:** `railway run … bun scripts/point-firmware.ts publish point-1.0.4.json`. Points of that
   model are offered it from their next daily check.
5. **Withdraw** a bad release with `… withdraw point 1.0.4`. It's never offered again, and Points still
   on the one before stay there. The fix is published as a newer version.

Later, signing can move into the firmware repo's release job: a GitHub Actions environment holding
the private key, with the key holder as its required reviewer.

## 8. Errors

Every refusal is JSON: `{ "error": "<code>", "message": "<a sentence>" }`.

| Status | `error` |
| --- | --- |
| 401 | `Unauthorized` (unknown key) |
| 403 | `forbidden` |
| 404 | `not_found` |
| 409 | `conflict`, `taken` |
| 410 | `expired` |
| 422 | `invalid` |
| 429 | rate limited |
| 503 | `Unavailable` |

## 9. Checking a firmware against this

```bash
bun apps/merchant/scripts/fake-point.ts --api http://localhost:3001 --code A7K2 --secret <secret> --health --press call --screens 2
```

prints one JSON line per step (`activated`, `health`, `state`, `pressed`) and checks each answer
against `PointScreen`. A firmware build can be run against the same server and compared screen for
screen. The provisioning side is in `apps/merchant/src/hardware/fakes/fakePointRadio.ts`, which the
tablet's setup runs against in `hardware/point/ble.test.ts`.
