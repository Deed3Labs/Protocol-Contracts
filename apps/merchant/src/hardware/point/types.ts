import type { ClaimedPoint } from '@clear/merchant-contracts';

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
