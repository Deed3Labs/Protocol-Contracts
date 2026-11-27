/*
 * Point firmware releases (docs/hardware/point-device-api.md, 7). The private key never comes near
 * the server: `keygen` and `sign` run on the key holder's own machine; `publish` and `withdraw` run
 * against the database and need only the public keys.
 *
 *   bun scripts/point-firmware.ts keygen clear-2026
 *       a new key: keep the private half in your password manager; the public half goes into the
 *       firmware's trusted keys and the API's POINT_FIRMWARE_KEYS (`clear-2026:<public>`)
 *
 *   CLEAR_FIRMWARE_KEY=<private> bun scripts/point-firmware.ts sign clear-2026 point 1.0.4 \
 *       https://<blob>.public.blob.vercel-storage.com/point/point-1.0.4.bin point-1.0.4.bin [--min-battery 40] > point-1.0.4.json
 *       the signed manifest for an image already uploaded to that URL
 *
 *   railway run -s Protocol-Contracts -e dev bun scripts/point-firmware.ts publish point-1.0.4.json
 *   railway run -s Protocol-Contracts -e dev bun scripts/point-firmware.ts withdraw point 1.0.4
 *   railway run -s Protocol-Contracts -e dev bun scripts/point-firmware.ts latest point
 */
import { readFileSync } from 'node:fs';
import { merchantDb } from '../src/config/merchantDb.js';
import { latestFirmware, newSigningKey, publishFirmware, signFirmware, withdrawFirmware, type PointModel } from '../src/services/merchant/terminal/firmware.js';

const usage = `usage:
  bun scripts/point-firmware.ts keygen <key-id>
  CLEAR_FIRMWARE_KEY=<private> bun scripts/point-firmware.ts sign <key-id> <point|point_large> <version> <https-url> <image-file> [--min-battery N]
  bun scripts/point-firmware.ts publish <manifest.json>
  bun scripts/point-firmware.ts withdraw <point|point_large> <version>
  bun scripts/point-firmware.ts latest <point|point_large>`;

const fail = (m: string) => {
  console.error(m);
  process.exit(1);
};
const model = (m: string | undefined): PointModel => (m === 'point' || m === 'point_large' ? m : fail(`A model: point or point_large\n${usage}`)!);
const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === 'keygen') {
    const k = newSigningKey(args[0] ?? fail(usage)!);
    console.log(`private (keep it in your password manager; never commit it, never put it on a server):\n${k.privateKey}\n`);
    console.log(`public (into the firmware's trusted keys, and POINT_FIRMWARE_KEYS on the API):\n${k.keyId}:${k.publicKey}`);
    process.exit(0);
  }
  if (cmd === 'sign') {
    const [keyId, m, version, url, file] = args;
    if (!keyId || !version || !url || !file) fail(usage);
    const privateKey = process.env.CLEAR_FIRMWARE_KEY ?? fail('Set CLEAR_FIRMWARE_KEY to the private key (from your password manager), for this command only.')!;
    const at = args.indexOf('--min-battery');
    const manifest = signFirmware({ privateKey, keyId: keyId!, model: model(m), version: version!, url: url!, image: readFileSync(file!), minBattery: at >= 0 ? Number(args[at + 1]) : undefined });
    console.log(JSON.stringify(manifest, null, 2));
    process.exit(0);
  }
  const db = (await merchantDb()) ?? fail('No merchant database (DATABASE_URL or MERCHANT_DATABASE_URL).')!;
  if (cmd === 'publish') {
    const m = await publishFirmware(db, { manifest: JSON.parse(readFileSync(args[0] ?? fail(usage)!, 'utf8')) });
    console.log(`published ${m.model} ${m.version}, signed by ${m.keyId}; Points of that model are offered it from now`);
  } else if (cmd === 'withdraw') {
    const done = await withdrawFirmware(db, { model: model(args[0]), version: args[1] ?? fail(usage)! });
    console.log(done ? `withdrew ${args[0]} ${args[1]}` : `no published ${args[0]} ${args[1]} to withdraw`);
  } else if (cmd === 'latest') {
    const m = await latestFirmware(db, model(args[0]));
    console.log(m ? JSON.stringify(m, null, 2) : `no ${args[0]} firmware published`);
  } else fail(usage);
  process.exit(0);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
