import { Fields, Writer } from './proto';

/**
 * ESP32 unified provisioning's messages, by field number, from ESP-IDF's
 * `components/protocomm/proto` (session, sec1, constants) and
 * `components/wifi_provisioning/proto` (wifi_config, wifi_constants, wifi_scan). The firmware uses
 * Espressif's own component, so these must match it exactly.
 */

export const STATUS = ['Success', 'InvalidSecScheme', 'InvalidProto', 'TooManySessions', 'InvalidArgument', 'InternalError', 'CryptoError', 'InvalidSession'] as const;
export const statusName = (n: number) => STATUS[n] ?? `Status ${n}`;

// ---- session.proto / sec1.proto ------------------------------------------------------------------
export const SEC_SCHEME_1 = 1;
export const SessionData = { secVer: 2, sec1: 11 } as const;
export const Sec1Payload = { msg: 1, sc0: 20, sr0: 21, sc1: 22, sr1: 23 } as const;
export const Sec1Msg = { Command0: 0, Response0: 1, Command1: 2, Response1: 3 } as const;
export const SessionCmd0 = { clientPubkey: 1 } as const;
export const SessionResp0 = { status: 1, devicePubkey: 2, deviceRandom: 3 } as const;
export const SessionCmd1 = { clientVerifyData: 2 } as const;
export const SessionResp1 = { status: 1, deviceVerifyData: 3 } as const;

export function sessionCmd0(clientPubkey: Uint8Array): Uint8Array {
  return new Writer()
    .varint(SessionData.secVer, SEC_SCHEME_1)
    .message(SessionData.sec1, new Writer().varint(Sec1Payload.msg, Sec1Msg.Command0).message(Sec1Payload.sc0, new Writer().bytes(SessionCmd0.clientPubkey, clientPubkey)))
    .done();
}

export function sessionCmd1(clientVerifyData: Uint8Array): Uint8Array {
  return new Writer()
    .varint(SessionData.secVer, SEC_SCHEME_1)
    .message(SessionData.sec1, new Writer().varint(Sec1Payload.msg, Sec1Msg.Command1).message(Sec1Payload.sc1, new Writer().bytes(SessionCmd1.clientVerifyData, clientVerifyData)))
    .done();
}

export const sec1Of = (b: Uint8Array) => new Fields(b).message(SessionData.sec1);

// ---- wifi_constants.proto -------------------------------------------------------------------------
export const StationState = { Connected: 0, Connecting: 1, Disconnected: 2, ConnectionFailed: 3 } as const;
export const FailReason = { AuthError: 0, NetworkNotFound: 1 } as const;
export const AuthMode = { Open: 0, WEP: 1, WPA_PSK: 2, WPA2_PSK: 3, WPA_WPA2_PSK: 4, WPA2_ENTERPRISE: 5, WPA3_PSK: 6, WPA2_WPA3_PSK: 7 } as const;

// ---- wifi_config.proto ----------------------------------------------------------------------------
export const ConfigPayload = { msg: 1, cmdGetStatus: 10, respGetStatus: 11, cmdSetConfig: 12, respSetConfig: 13, cmdApplyConfig: 14, respApplyConfig: 15 } as const;
export const ConfigMsg = { CmdGetStatus: 0, RespGetStatus: 1, CmdSetConfig: 2, RespSetConfig: 3, CmdApplyConfig: 4, RespApplyConfig: 5 } as const;
export const CmdSetConfig = { ssid: 1, passphrase: 2, bssid: 3, channel: 4 } as const;
export const RespGetStatus = { status: 1, staState: 2, failReason: 10, connected: 11, attemptFailed: 12 } as const;
export const ConnectedState = { ip4Addr: 1, authMode: 2, ssid: 3, bssid: 4, channel: 5 } as const;

export const cmdGetStatus = () => new Writer().varint(ConfigPayload.msg, ConfigMsg.CmdGetStatus).message(ConfigPayload.cmdGetStatus, new Writer()).done();
export const cmdSetConfig = (ssid: string, passphrase: string) =>
  new Writer()
    .varint(ConfigPayload.msg, ConfigMsg.CmdSetConfig)
    .message(ConfigPayload.cmdSetConfig, new Writer().bytes(CmdSetConfig.ssid, ssid).bytes(CmdSetConfig.passphrase, passphrase))
    .done();
export const cmdApplyConfig = () => new Writer().varint(ConfigPayload.msg, ConfigMsg.CmdApplyConfig).message(ConfigPayload.cmdApplyConfig, new Writer()).done();

// ---- wifi_scan.proto ------------------------------------------------------------------------------
export const ScanPayload = { msg: 1, status: 2, cmdScanStart: 10, respScanStart: 11, cmdScanStatus: 12, respScanStatus: 13, cmdScanResult: 14, respScanResult: 15 } as const;
export const ScanMsg = { CmdScanStart: 0, RespScanStart: 1, CmdScanStatus: 2, RespScanStatus: 3, CmdScanResult: 4, RespScanResult: 5 } as const;
export const CmdScanStart = { blocking: 1, passive: 2, groupChannels: 3, periodMs: 4 } as const;
export const RespScanStatus = { scanFinished: 1, resultCount: 2 } as const;
export const CmdScanResult = { startIndex: 1, count: 2 } as const;
export const RespScanResult = { entries: 1 } as const;
export const ScanResult = { ssid: 1, channel: 2, rssi: 3, bssid: 4, auth: 5 } as const;

export const cmdScanStart = () =>
  new Writer()
    .varint(ScanPayload.msg, ScanMsg.CmdScanStart)
    .message(ScanPayload.cmdScanStart, new Writer().varint(CmdScanStart.blocking, true).varint(CmdScanStart.periodMs, 120))
    .done();
export const cmdScanStatus = () => new Writer().varint(ScanPayload.msg, ScanMsg.CmdScanStatus).message(ScanPayload.cmdScanStatus, new Writer()).done();
export const cmdScanResult = (startIndex: number, count: number) =>
  new Writer()
    .varint(ScanPayload.msg, ScanMsg.CmdScanResult)
    .message(ScanPayload.cmdScanResult, new Writer().varint(CmdScanResult.startIndex, startIndex).varint(CmdScanResult.count, count))
    .done();
