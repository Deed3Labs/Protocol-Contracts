import type { ClaimedPoint, MerchantApi } from '@clear/merchant-contracts';

/**
 * Adding a Point (terminal reference, section 2): claim it on the server by its code, then hand it
 * the Wi-Fi and its one-time secret over Bluetooth, so nobody types a password on an e-ink screen.
 * Sending to a Point is the API (`showOnPoint`): only the Point listens to the server.
 */

export interface NearbyPoint {
  code: string;
  firmware: string;
  battery: number;
}

export interface WifiNetwork {
  ssid: string;
  /** "This tablet's network · strong" */
  det: string;
  /** A network with a sign-in page can't take a Point. */
  usable: boolean;
}

export interface PointService {
  /** The Point with this code, over Bluetooth, once claimed. */
  find(code: string): Promise<NearbyPoint>;
  /** Networks the Point can see. */
  networks(code: string): Promise<WifiNetwork[]>;
  /** The Wi-Fi and the secret, over Bluetooth (ESP32 unified provisioning). Resolves when it's online. */
  provision(code: string, input: { ssid: string; password: string; claimed: ClaimedPoint }): Promise<void>;
}

export class PointUnavailable extends Error {}

/** The preview's Point A7K2, fresh out of the box. */
export function mockPoints(): PointService {
  return {
    find: async (code) => ({ code, firmware: '1.0.3', battery: 100 }),
    networks: async () => [
      {
        ssid: 'MiCasa-Staff',
        det: 'This tablet’s network · strong',
        usable: true,
      },
      {
        ssid: 'MiCasa-Guest',
        det: 'Has a sign-in page, so a Point can’t use it',
        usable: false,
      },
    ],
    provision: async () => undefined,
  };
}

/** Bluetooth provisioning needs the installed app's plugin (Phase 6). */
export function unavailablePoints(): PointService {
  const no = async (): Promise<never> => {
    throw new PointUnavailable('Setting up a Point needs the Clear app on this tablet');
  };
  return { find: no, networks: no, provision: no };
}

export const pointService = (opts: { preview?: boolean } = {}): PointService => (opts.preview ? mockPoints() : unavailablePoints());

/** Claim, then provision: the whole of steps 1 and 2. */
export async function addPoint(api: MerchantApi, points: PointService, input: { code: string; ssid: string; password: string }): Promise<ClaimedPoint> {
  const claimed = await api.claimPoint({ code: input.code });
  await points.provision(claimed.device.code, {
    ssid: input.ssid,
    password: input.password,
    claimed,
  });
  return claimed;
}
