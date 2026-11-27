import type { BleCentral, BleLink } from '../ble/central';
import { bleEndpoints } from './provisioning/ble';
import { isEnterprise, ProvisioningClient, ProvisioningError } from './provisioning/client';
import { PointUnavailable, type NearbyPoint, type PointService, type WifiNetwork } from './types';

/**
 * Setting up a Point over Bluetooth (terminal reference, section 2), with ESP32 unified provisioning
 * so the firmware runs Espressif's own component. The Point advertises as `CLEAR-<code>` with
 * Clear's provisioning service; its code is the proof of possession, so only someone holding the
 * Point (or its box) can set it up.
 */
export const POINT_PROV_SERVICE = '6c3a1001-7b52-4c1f-9d3e-5c6c65617201';
export const pointName = (code: string) => `CLEAR-${code.toUpperCase()}`;

/** How long joining may take, and reaching Clear after it. */
const JOIN_MS = 30_000;
const REACH_MS = 15_000;

export function blePoints(central: () => BleCentral, opts: { pollMs?: number } = {}): PointService {
  const open = new Map<string, { link: BleLink; client: ProvisioningClient }>();
  const poll = opts.pollMs ?? 500;

  async function reach(code: string) {
    const known = open.get(code);
    if (known) return known;
    const found = await central()
      .request({ namePrefix: pointName(code), optionalServices: [POINT_PROV_SERVICE] })
      .catch(() => {
        throw new PointUnavailable(`Point ${code} isn’t nearby. Hold it close and check it’s on`);
      });
    const link = await central().connect(found.id, () => open.delete(code));
    const client = new ProvisioningClient(await bleEndpoints(link, POINT_PROV_SERVICE), code.toUpperCase());
    open.set(code, { link, client });
    return open.get(code)!;
  }

  const done = async (code: string) => {
    await open.get(code)?.link.disconnect().catch(() => undefined);
    open.delete(code);
  };

  return {
    find: async (code): Promise<NearbyPoint> => {
      const { client } = await reach(code);
      const v = await client.version();
      await client.session();
      return { code: v.clear?.code ?? code.toUpperCase(), firmware: v.clear?.firmware ?? v.prov?.ver ?? '', battery: v.clear?.battery ?? 0 };
    },
    networks: async (code): Promise<WifiNetwork[]> => {
      const { client } = await reach(code);
      const strongest = new Map<string, { rssi: number; auth: number }>();
      for (const n of await client.scan()) {
        if (!n.ssid) continue;
        const had = strongest.get(n.ssid);
        if (!had || n.rssi > had.rssi) strongest.set(n.ssid, { rssi: n.rssi, auth: n.auth });
      }
      return [...strongest]
        .sort((a, b) => b[1].rssi - a[1].rssi)
        .map(([ssid, n]) =>
          isEnterprise(n.auth)
            ? { ssid, det: 'Asks for a username, so a Point can’t use it', usable: false }
            : { ssid, det: n.rssi >= -60 ? 'Strong signal' : n.rssi >= -72 ? 'Good signal' : 'Weak signal', usable: true },
        );
    },
    provision: async (code, input) => {
      const { client } = await reach(code);
      try {
        const claimed = await client.json<{ ok?: boolean; error?: string }>('clear-claim', {
          code: code.toUpperCase(),
          secret: input.claimed.provisioning.secret,
          apiBase: input.claimed.provisioning.apiBase,
        });
        if (!claimed.ok) throw new ProvisioningError(claimed.error ?? 'The Point didn’t take its setup');
        await client.setWifi(input.ssid, input.password);
        await client.apply();
        const until = Date.now() + JOIN_MS;
        for (;;) {
          const s = await client.status();
          if (s.state === 'connected') break;
          if (s.state === 'failed') throw new ProvisioningError(s.reason === 'auth' ? 'That password didn’t work' : s.reason === 'not_found' ? 'The Point can’t see that network' : 'The Point couldn’t join that network');
          if (Date.now() > until) throw new ProvisioningError('The Point is taking too long to join. Check the password and try again');
          await new Promise((r) => setTimeout(r, poll));
        }
        const reachUntil = Date.now() + REACH_MS;
        for (;;) {
          const r = await client.json<{ server: 'ok' | 'checking' | 'portal' | 'offline' }>('clear-reach', {});
          if (r.server === 'ok') break;
          if (r.server === 'portal') throw new ProvisioningError('Has a sign-in page, so a Point can’t use it');
          if (r.server === 'offline' || Date.now() > reachUntil) throw new ProvisioningError('The Point joined but can’t reach Clear. Check this network has internet');
          await new Promise((res) => setTimeout(res, poll));
        }
      } finally {
        await done(code);
      }
    },
  };
}
