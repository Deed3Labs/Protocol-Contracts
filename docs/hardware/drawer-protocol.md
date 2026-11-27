# Clear Drawer: the Bluetooth protocol

The contract the cash drawer's firmware is built from. The drawer never talks to the server: **the
tablet opens it directly**, with or without a connection, and logs what happened to the server
afterwards (`POST /api/merchant/drawer/events`, queued while offline).

The tablet's side is `apps/merchant/src/hardware/drawer/` (`protocol.ts`, `ble.ts`). A drawer that
follows this file is `apps/merchant/src/hardware/fakes/fakeDrawer.ts`, which the tablet's code runs
against in `drawer/ble.test.ts`; `apps/merchant/scripts/fake-drawer.ts` speaks the same messages as
hex lines, for checking a firmware by hand.

## 1. Advertising

| | |
| --- | --- |
| Name | `Clear Drawer` |
| Advertised service | `6c3a0001-7b52-4c1f-9d3e-5c6c65617201` |
| Bluetooth id | Its address; the tablet shows the last four (`4F2A`) |

It advertises whenever powered, keyed or not, and takes one connection at a time. A new connection
from the paired tablet replaces an old one (the tablet reconnects after a restart).

## 2. The service

| Characteristic | UUID | Properties | |
| --- | --- | --- | --- |
| Command | `6c3a0002-7b52-4c1f-9d3e-5c6c65617201` | write | A signed `open` (4) |
| State | `6c3a0003-7b52-4c1f-9d3e-5c6c65617201` | read, notify | `0x00` shut, `0x01` open (5) |
| Pair | `6c3a0004-7b52-4c1f-9d3e-5c6c65617201` | write | The drawer's id and key, once (3) |

There is **no way to read the key back** and no other characteristic. All integers are big-endian.
Writes can be longer than one ATT MTU (a pairing message is up to 106 bytes, a command 29): the
drawer must accept long (queued) writes, or negotiate an MTU of at least 109.

## 3. Pairing

Add a device › Cash drawer finds the drawer, and its **Test open** adds it to the shop, fetches its
key from the server (`GET /api/merchant/drawers/:id/key`), writes the pairing message, then opens it
with a signed command.

```
offset  size  field
0       1     0x02  (pair)
1       8     the tablet's time, seconds since 1970
9       1     n, the length of the drawer's id
10      n     the drawer's id, UTF-8: Clear's id for it (hw_…), at most 64 bytes
10+n    32    the key
```

- A drawer **with no key** takes it: it stores the id, the key and a counter of 0 in encrypted
  flash, and sets its clock from the time. The write succeeds.
- A drawer **with a key** refuses: the write fails with ATT error `0x03` (Write Not Permitted). The
  tablet says "That drawer is paired to another shop. Hold its button for 10 seconds to reset it,
  then try again".
- **Reset:** the button held for ten seconds forgets the id, the key and the counter, and the drawer
  takes a pairing again. Nothing else forgets them, power loss included.
- A malformed message (wrong opcode, key not 32 bytes) fails the write the same way and changes
  nothing.

## 4. Opening

```
offset  size  field
0       1     0x01  (open)
1       4     counter
5       8     the tablet's time, seconds since 1970
13      16    MAC
```

**MAC** = the first 16 bytes of HMAC-SHA256(key, UTF-8(drawer id) ‖ bytes 0–12).

The drawer opens only when **all** of these hold, checked in this order:

1. It has a key.
2. The message is 29 bytes and starts with `0x01`.
3. The MAC matches, compared in constant time.
4. The counter is **greater than** the last counter it accepted.
5. Its clock is set and the time is within **300 seconds** of it, or its clock is unset (6).

Then it, in this order: stores the counter in flash, sets its clock to the command's time (a signed
command's time is trusted), fires the latch (7), and notifies `0x01` on State.

**Anything else does nothing.** No open, no notification, and the write still succeeds, so a
replayed, stale, forged or unsigned command looks to its sender the same as one that was heard. The
tablet treats "no `0x01` within two seconds" as the drawer not opening, and its change screen offers
the key ("Drawer didn't open").

The tablet's counter is `max(last + 1, the time in seconds)`, so a tablet that lost its count still
sends a counter ahead of anything the drawer has seen.

## 5. State: open and shut

The drawer reads its own position from a switch on the till, not from what it was told.

- **Notify** `0x01` when the till opens (by a command, a printer pulse, or the key) and `0x00` when
  it is pushed shut. Debounce 50 ms.
- **Read** answers the position now.

The tablet logs a shut as a `shut` drawer event; an open is logged by whatever opened it (the sale,
a No sale, or "I used the key"), so the drawer's notifications are never a second record of an open.

## 6. The clock

The drawer has no network, so its clock comes from the tablet: set at pairing, and set again by
every open it accepts. The counter already refuses any command that was sent; the 300-second window
bounds how long one captured and never sent (held back by someone between the tablet and the drawer)
stays good.

- An RTC drift of a few seconds a day stays inside the window as long as the drawer opens now and
  then.
- **After a power loss** the clock is unset until the next accepted open. Until then the drawer
  checks everything but the time: the counter, kept in flash, still refuses any command it has
  seen, and any command older than the last it accepted.

## 7. The latch and the printer port

- **The latch:** a pulse of 100 ms to the solenoid on an accepted open.
- **RJ12, from a receipt printer** (a drawer "cabled to the printer", Settings › Devices): the
  standard drawer-kick port. Pin 2 (kick 1) or pin 5 (kick 2) against pin 4 (+24 V): a pulse of
  12–24 V for at least 30 ms fires the latch, with no key, because the cable is the trust. Pin 3 is
  the open/shut switch back to the printer, pin 6 ground. The tablet sends ESC/POS `ESC p 0 25 250`
  (`1B 70 00 19 FA`: pin 2, 50 ms on, 500 ms off) to the printer. A pulse-opened drawer notifies
  State over Bluetooth like any other open.

## 8. Timings

| | |
| --- | --- |
| Tablet waits for `0x01` | 2 seconds (`DRAWER_ANSWER_MS`) |
| Clock window | 300 seconds (`DRAWER_CLOCK_SKEW_S`) |
| Reset | Button held 10 seconds |
| Latch pulse | 100 ms |
| Printer kick accepted | 12–24 V, ≥ 30 ms |

## 9. Checking a firmware against this

```bash
bun apps/merchant/scripts/fake-drawer.ts --sign --id hw_1 --key <base64> --counter 7
```

prints the 29-byte `open` a tablet would send for that drawer, as hex, to write to a real drawer.

```bash
printf "pair <hex>\nopen <hex>\nopen <hex>\nshut\n" | bun apps/merchant/scripts/fake-drawer.ts
```

answers each message as the drawer should (`{"ok":true,"state":"open"}`, then
`{"ok":false,"refused":"replay"}` for the repeat).
