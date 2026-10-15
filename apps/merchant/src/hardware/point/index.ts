import type { ClaimedPoint, MerchantApi } from '@clear/merchant-contracts';
import { currentPlatform } from '@/reader/platform';
import { capacitorCentral } from '../ble/central';
import { blePoints } from './ble';

/**
 * Adding a Point (terminal reference, section 2): claim it on the server by its code, then hand it
 * the Wi-Fi and its one-time secret over Bluetooth, so nobody types a password on an e-ink screen.
 * Sending to a Point is the API (`showOnPoint`): only the Point listens to the server.
 */

export * from './types';
import { PointUnavailable, type PointService } from './types';

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

/** A browser with no Bluetooth (Safari, Firefox): set it up from the app. */
export function unavailablePoints(): PointService {
  const no = async (): Promise<never> => {
    throw new PointUnavailable('Setting up a Point needs the Clear app on this tablet');
  };
  return { find: no, networks: no, provision: no };
}

let live: PointService | null = null;

/** The preview's Point; everywhere else Bluetooth (the app's, or Chrome's Web Bluetooth). */
export function pointService(opts: { preview?: boolean } = {}): PointService {
  if (opts.preview) return mockPoints();
  return (live ??= blePoints(() => capacitorCentral(currentPlatform())));
}

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
