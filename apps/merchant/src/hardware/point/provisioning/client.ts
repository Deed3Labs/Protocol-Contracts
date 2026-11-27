import { sameBytes, text, utf8 } from '../../ble/bytes';
import {
  AuthMode,
  ConfigPayload,
  ConnectedState,
  FailReason,
  RespGetStatus,
  RespScanResult,
  RespScanStatus,
  ScanPayload,
  ScanResult,
  SessionResp0,
  SessionResp1,
  Sec1Payload,
  StationState,
  cmdApplyConfig,
  cmdGetStatus,
  cmdScanResult,
  cmdScanStart,
  cmdScanStatus,
  cmdSetConfig,
  sec1Of,
  sessionCmd0,
  sessionCmd1,
  statusName,
} from './messages';
import { Fields } from './proto';
import { CtrStream, newKeyPair, sharedSecret } from './sec1';

/**
 * The tablet's side of ESP32 provisioning, over any transport that can send a request to a named
 * endpoint and hand back the answer (`ble.ts` over Bluetooth; the fake Point in memory). Endpoints:
 *
 *   proto-ver     plain JSON: the firmware's version and, under `clear`, the Point's code, firmware
 *                 and battery
 *   prov-session  Security 1's handshake
 *   prov-scan     the networks the Point can see
 *   prov-config   the Wi-Fi, apply it, and how joining went
 *   clear-claim   Clear's own: the setup secret and the API to activate with (JSON, encrypted)
 *   clear-reach   Clear's own: once on the network, whether it reaches Clear or a sign-in page
 */
export interface EndpointTransport {
  call(endpoint: string, request: Uint8Array): Promise<Uint8Array>;
}

export interface PointVersion {
  prov?: { ver?: string; sec_ver?: number; cap?: string[] };
  clear?: { code?: string; firmware?: string; battery?: number };
}

export interface SeenNetwork {
  ssid: string;
  rssi: number;
  auth: number;
}

export type JoinStatus =
  | { state: 'connected'; ip: string }
  | { state: 'connecting' }
  | { state: 'disconnected' }
  | { state: 'failed'; reason: 'auth' | 'not_found' | 'other' };

export class ProvisioningError extends Error {}

export class ProvisioningClient {
  private stream: CtrStream | null = null;
  private readonly t: EndpointTransport;
  private readonly pop: string;

  constructor(t: EndpointTransport, pop: string) {
    this.t = t;
    this.pop = pop;
  }

  async version(): Promise<PointVersion> {
    const raw = text(await this.t.call('proto-ver', utf8('---')));
    try {
      return JSON.parse(raw) as PointVersion;
    } catch {
      return { prov: { ver: raw } };
    }
  }

  /** Security 1's two steps. After it, every request and answer is encrypted. */
  async session(): Promise<void> {
    if (this.stream) return;
    const ours = newKeyPair();
    const r0 = sec1Of(await this.t.call('prov-session', sessionCmd0(ours.pub)));
    const sr0 = r0.message(Sec1Payload.sr0);
    if (sr0.uint(SessionResp0.status) !== 0) throw new ProvisioningError(`The Point refused the session (${statusName(sr0.uint(SessionResp0.status))})`);
    const devicePub = sr0.bytes(SessionResp0.devicePubkey);
    const stream = new CtrStream(await sharedSecret(ours.priv, devicePub, this.pop), sr0.bytes(SessionResp0.deviceRandom));
    const r1 = sec1Of(await this.t.call('prov-session', sessionCmd1(await stream.xor(devicePub))));
    const sr1 = r1.message(Sec1Payload.sr1);
    // A wrong proof of possession shows here: the Point can't read what we sent, and says so.
    if (sr1.uint(SessionResp1.status) !== 0) throw new ProvisioningError('That isn’t this Point’s code');
    if (!sameBytes(await stream.xor(sr1.bytes(SessionResp1.deviceVerifyData)), ours.pub)) throw new ProvisioningError('The Point didn’t prove it’s the one with that code');
    this.stream = stream;
  }

  /** One encrypted request and its answer. */
  async call(endpoint: string, request: Uint8Array): Promise<Uint8Array> {
    if (!this.stream) await this.session();
    const answer = await this.t.call(endpoint, await this.stream!.xor(request));
    return this.stream!.xor(answer);
  }

  async json<T>(endpoint: string, body: unknown): Promise<T> {
    return JSON.parse(text(await this.call(endpoint, utf8(JSON.stringify(body))))) as T;
  }

  async scan(): Promise<SeenNetwork[]> {
    await this.call('prov-scan', cmdScanStart());
    let count = 0;
    for (let i = 0; i < 20; i += 1) {
      const st = new Fields(await this.call('prov-scan', cmdScanStatus())).message(ScanPayload.respScanStatus);
      if (st.bool(RespScanStatus.scanFinished)) {
        count = st.uint(RespScanStatus.resultCount);
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    const out: SeenNetwork[] = [];
    // Four at a time, as Espressif's own apps ask: an answer has to fit what Bluetooth carries.
    for (let start = 0; start < count; start += 4) {
      const res = new Fields(await this.call('prov-scan', cmdScanResult(start, Math.min(4, count - start)))).message(ScanPayload.respScanResult);
      for (const e of res.all(RespScanResult.entries)) {
        const f = new Fields(e);
        out.push({ ssid: text(f.bytes(ScanResult.ssid)), rssi: f.int32(ScanResult.rssi), auth: f.uint(ScanResult.auth) });
      }
    }
    return out;
  }

  async setWifi(ssid: string, password: string): Promise<void> {
    const r = new Fields(await this.call('prov-config', cmdSetConfig(ssid, password))).message(ConfigPayload.respSetConfig);
    if (r.uint(1) !== 0) throw new ProvisioningError(`The Point didn’t take the network (${statusName(r.uint(1))})`);
  }

  async apply(): Promise<void> {
    const r = new Fields(await this.call('prov-config', cmdApplyConfig())).message(ConfigPayload.respApplyConfig);
    if (r.uint(1) !== 0) throw new ProvisioningError(`The Point couldn’t join (${statusName(r.uint(1))})`);
  }

  async status(): Promise<JoinStatus> {
    const r = new Fields(await this.call('prov-config', cmdGetStatus())).message(ConfigPayload.respGetStatus);
    const state = r.uint(RespGetStatus.staState);
    if (state === StationState.Connected) return { state: 'connected', ip: text(r.message(RespGetStatus.connected).bytes(ConnectedState.ip4Addr)) };
    if (state === StationState.Connecting) return { state: 'connecting' };
    if (state === StationState.Disconnected) return { state: 'disconnected' };
    const reason = r.uint(RespGetStatus.failReason);
    return { state: 'failed', reason: reason === FailReason.AuthError ? 'auth' : reason === FailReason.NetworkNotFound ? 'not_found' : 'other' };
  }
}

export const isEnterprise = (auth: number) => auth === AuthMode.WPA2_ENTERPRISE;
