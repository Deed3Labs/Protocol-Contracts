import { sameBytes, text, utf8 } from '../ble/bytes';
import { POINT_PROV_SERVICE, pointName } from '../point/ble';
import {
  ConfigMsg,
  ConfigPayload,
  ConnectedState,
  FailReason,
  RespGetStatus,
  RespScanResult,
  RespScanStatus,
  ScanMsg,
  ScanPayload,
  ScanResult,
  SEC_SCHEME_1,
  Sec1Msg,
  Sec1Payload,
  SessionCmd0,
  SessionCmd1,
  SessionData,
  SessionResp0,
  SessionResp1,
  StationState,
  AuthMode,
  CmdScanResult,
  CmdSetConfig,
  sec1Of,
} from '../point/provisioning/messages';
import { Fields, Writer } from '../point/provisioning/proto';
import { CtrStream, newKeyPair, sharedSecret } from '../point/provisioning/sec1';
import { FakePeripheral } from './peripheral';

/**
 * A Point's Bluetooth side while it's being set up, as Espressif's provisioning component and
 * Clear's two endpoints behave (docs/hardware/point-device-api.md): Security 1 with the Point's code
 * as proof of possession, a Wi-Fi scan, the network to join, and the setup secret.
 */
export interface FakeNetwork {
  ssid: string;
  password: string;
  rssi: number;
  auth?: number;
  /** Joining works, but the internet is behind a sign-in page. */
  portal?: boolean;
}

export interface FakePointRadio {
  peripheral: FakePeripheral;
  /** What `clear-claim` was given. */
  claim: { code: string; secret: string; apiBase: string } | null;
  joined: string | null;
}

export function fakePointRadio(opts: { code: string; firmware?: string; battery?: number; networks: FakeNetwork[]; joinSteps?: number }): FakePointRadio {
  const code = opts.code.toUpperCase();
  const peripheral = new FakePeripheral(`ble-${code}`, pointName(code), [POINT_PROV_SERVICE], 512);
  const radio: FakePointRadio = { peripheral, claim: null, joined: null };
  let stream: CtrStream | null = null;
  let pending: { ours: ReturnType<typeof newKeyPair>; clientPub: Uint8Array; stream: CtrStream } | null = null;
  let config: { ssid: string; password: string } | null = null;
  let joining = 0;
  let joinResult: 'connected' | 'auth' | 'not_found' | null = null;

  const answers = new Map<string, Uint8Array>();
  const endpoint = (name: string, uuid: string, handle: (req: Uint8Array) => Promise<Uint8Array>, encrypted = true) =>
    peripheral.add(POINT_PROV_SERVICE, {
      uuid,
      description: name,
      write: async (v) => {
        if (encrypted && !stream) throw new Error('No session');
        const req = encrypted ? await stream!.xor(v) : v;
        const res = await handle(req);
        answers.set(name, encrypted ? await stream!.xor(res) : res);
      },
      read: () => answers.get(name) ?? new Uint8Array(),
    });

  endpoint(
    'proto-ver',
    '6c3a1002-7b52-4c1f-9d3e-5c6c65617201',
    async () => utf8(JSON.stringify({ prov: { ver: 'v1.1', sec_ver: 1, cap: ['wifi_scan'] }, clear: { code, firmware: opts.firmware ?? '1.0.3', battery: opts.battery ?? 100 } })),
    false,
  );

  endpoint(
    'prov-session',
    '6c3a1003-7b52-4c1f-9d3e-5c6c65617201',
    async (req) => {
      const sec1 = sec1Of(req);
      const out = (msg: number, field: number, body: Writer) =>
        new Writer().varint(SessionData.secVer, SEC_SCHEME_1).message(SessionData.sec1, new Writer().varint(Sec1Payload.msg, msg).message(field, body)).done();
      if (sec1.uint(Sec1Payload.msg) === Sec1Msg.Command0) {
        const clientPub = sec1.message(Sec1Payload.sc0).bytes(SessionCmd0.clientPubkey);
        const ours = newKeyPair();
        const random = crypto.getRandomValues(new Uint8Array(16));
        pending = { ours, clientPub, stream: new CtrStream(await sharedSecret(ours.priv, clientPub, code), random) };
        stream = null;
        return out(Sec1Msg.Response0, Sec1Payload.sr0, new Writer().bytes(SessionResp0.devicePubkey, ours.pub).bytes(SessionResp0.deviceRandom, random));
      }
      if (!pending) return out(Sec1Msg.Response1, Sec1Payload.sr1, new Writer().varint(SessionResp1.status, 7));
      const verify = await pending.stream.xor(sec1.message(Sec1Payload.sc1).bytes(SessionCmd1.clientVerifyData));
      // The wrong code: the client's proof doesn't decrypt to our key. CryptoError, no session.
      if (!sameBytes(verify, pending.ours.pub)) {
        pending = null;
        return out(Sec1Msg.Response1, Sec1Payload.sr1, new Writer().varint(SessionResp1.status, 6));
      }
      const deviceVerify = await pending.stream.xor(pending.clientPub);
      stream = pending.stream;
      pending = null;
      return out(Sec1Msg.Response1, Sec1Payload.sr1, new Writer().bytes(SessionResp1.deviceVerifyData, deviceVerify));
    },
    false,
  );

  endpoint('prov-scan', '6c3a1004-7b52-4c1f-9d3e-5c6c65617201', async (req) => {
    const f = new Fields(req);
    const msg = f.uint(ScanPayload.msg);
    const w = new Writer();
    if (msg === ScanMsg.CmdScanStart) return w.varint(ScanPayload.msg, ScanMsg.RespScanStart).message(ScanPayload.respScanStart, new Writer()).done();
    if (msg === ScanMsg.CmdScanStatus)
      return w
        .varint(ScanPayload.msg, ScanMsg.RespScanStatus)
        .message(ScanPayload.respScanStatus, new Writer().varint(RespScanStatus.scanFinished, true).varint(RespScanStatus.resultCount, opts.networks.length))
        .done();
    const ask = f.message(ScanPayload.cmdScanResult);
    const start = ask.uint(CmdScanResult.startIndex);
    const entries = new Writer();
    for (const n of opts.networks.slice(start, start + ask.uint(CmdScanResult.count)))
      entries.message(RespScanResult.entries, new Writer().bytes(ScanResult.ssid, n.ssid).varint(ScanResult.channel, 6).varint(ScanResult.rssi, n.rssi).varint(ScanResult.auth, n.auth ?? AuthMode.WPA2_PSK));
    return w.varint(ScanPayload.msg, ScanMsg.RespScanResult).message(ScanPayload.respScanResult, entries).done();
  });

  endpoint('prov-config', '6c3a1005-7b52-4c1f-9d3e-5c6c65617201', async (req) => {
    const f = new Fields(req);
    const msg = f.uint(ConfigPayload.msg);
    if (msg === ConfigMsg.CmdSetConfig) {
      const c = f.message(ConfigPayload.cmdSetConfig);
      config = { ssid: text(c.bytes(CmdSetConfig.ssid)), password: text(c.bytes(CmdSetConfig.passphrase)) };
      return new Writer().varint(ConfigPayload.msg, ConfigMsg.RespSetConfig).message(ConfigPayload.respSetConfig, new Writer()).done();
    }
    if (msg === ConfigMsg.CmdApplyConfig) {
      const n = opts.networks.find((x) => x.ssid === config?.ssid);
      joining = opts.joinSteps ?? 2;
      joinResult = !n ? 'not_found' : n.password !== config?.password ? 'auth' : 'connected';
      return new Writer().varint(ConfigPayload.msg, ConfigMsg.RespApplyConfig).message(ConfigPayload.respApplyConfig, new Writer()).done();
    }
    // Get status: connecting for a step or two, then how it went.
    const body = new Writer();
    if (joining > 0) {
      joining -= 1;
      body.varint(RespGetStatus.staState, StationState.Connecting);
    } else if (joinResult === 'connected') {
      radio.joined = config!.ssid;
      body.varint(RespGetStatus.staState, StationState.Connected).message(RespGetStatus.connected, new Writer().bytes(ConnectedState.ip4Addr, '192.168.1.57'));
    } else if (joinResult) {
      body.varint(RespGetStatus.staState, StationState.ConnectionFailed).varint(RespGetStatus.failReason, joinResult === 'auth' ? FailReason.AuthError : FailReason.NetworkNotFound, true);
    } else body.varint(RespGetStatus.staState, StationState.Disconnected);
    return new Writer().varint(ConfigPayload.msg, ConfigMsg.RespGetStatus).message(ConfigPayload.respGetStatus, body).done();
  });

  endpoint('clear-claim', '6c3a1006-7b52-4c1f-9d3e-5c6c65617201', async (req) => {
    const b = JSON.parse(text(req)) as { code?: string; secret?: string; apiBase?: string };
    if (b.code !== code || !b.secret || !b.apiBase) return utf8(JSON.stringify({ ok: false, error: 'That setup isn’t for this Point' }));
    radio.claim = { code: b.code, secret: b.secret, apiBase: b.apiBase };
    return utf8(JSON.stringify({ ok: true }));
  });

  endpoint('clear-reach', '6c3a1007-7b52-4c1f-9d3e-5c6c65617201', async () => {
    const n = opts.networks.find((x) => x.ssid === radio.joined);
    return utf8(JSON.stringify({ server: !n ? 'offline' : n.portal ? 'portal' : 'ok' }));
  });

  // Every endpoint characteristic names itself, as Espressif's do.
  for (const c of peripheral.services.get(POINT_PROV_SERVICE)!.values()) if (!c.description) throw new Error(`${c.uuid} has no name`);
  return radio;
}
