# Measuring the M2

The Pay case addendum asks for one figure before Pay cases ship: **how long the tablet takes to
connect to a table's Stripe Reader M2, and to let it go.** Stripe's SDK holds one reader at a time,
so a table's M2 is connected only while that table pays (`apps/merchant/src/reader/tables.ts`). If
connecting is slow, the customer could tap before the reader is ready.

The app times every step itself (`reader/timings.ts`): finding the reader, letting the current one
go, connecting, letting go, and the counter's reader coming back. It keeps the last 200 on the
tablet. This page is how to read them.

## What you need

- The Clear app **installed** on the tablet from Xcode or Android Studio. A browser can't drive an
  M2.
- A Stripe Reader M2, charged, linked to the shop in Settings › Payments.
- A Mac connected to the tablet by cable:
  - **iPad:** Safari › Settings › Advanced › Show features for web developers. On the iPad,
    Settings › Apps › Safari › Advanced › Web Inspector on. A debug build allows inspection.
  - **Android:** Developer options › USB debugging on, then `chrome://inspect` in Chrome on the Mac.

## Run it

1. Open the Clear app on the tablet and sign in to a shift.
2. On the Mac, open the inspector for the app's page (Safari › Develop › the iPad › Clear, or
   `chrome://inspect` › inspect).
3. In its console:

   ```js
   clearReaderTimings.clear()
   await clearReaderTimings.measure('STRM26…', 10)   // the M2's serial, from Settings › Payments
   ```

   That finds the M2, connects, waits two seconds, and lets go, ten times. Nothing is charged and
   no payment starts. It answers with the summary.

4. Do it three ways, clearing in between:
   - the M2 on the counter, a metre from the tablet;
   - the M2 in a Pay case at the farthest table;
   - the same table at a busy hour (other Bluetooth and Wi-Fi about).

5. `clearReaderTimings.summary()` gives, per step: how many ran, how many failed, and the median,
   90th percentile and longest time in milliseconds. `clearReaderTimings.list()` has every one.

Real tables add their own figures as they're used. Run `clearReaderTimings.summary()` after a
service to see them.

## What the figures decide

Add them to DECISIONS.md under "Terminal addendum 2: the Pay case", replacing "Measured on a real
M2: not yet".

| `connect`, 90th percentile | Then |
| --- | --- |
| Under 10 seconds | Keep it as built: connect when the bill is sent to the Point. Customers read a bill for longer than that. |
| 10 to 30 seconds | Connect when the table's Bill button is pressed or the tab gets its last item, not only when the bill is sent. |
| Over 30 seconds, or `failed` above 1 in 10 | Stop and rethink: a reader per table may need its own tablet or phone, or the M2 stays at the counter. |

`disconnect` plus `counter` is how long the counter waits to get its own reader back. Over five
seconds, the counter's card screen should say it's waiting for the reader.
