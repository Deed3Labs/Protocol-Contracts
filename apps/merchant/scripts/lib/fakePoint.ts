import { firmwareSigningPayload, PointFirmware, PointKey, PointScreen, type PointHealthReport } from '@clear/merchant-contracts';

/**
 * A Point on the network, as its firmware talks to the device API (docs/hardware/point-device-api.md):
 * activate with the setup secret the tablet handed it over Bluetooth, then follow what to show. On
 * battery it long-polls with the ETag; plugged in it can hold the event stream. Every answer is
 * checked against the contract, so a run is also a conformance check of the server.
 */
export class FakePointDevice {
  key: string | null;
  etag: string | null = null;
  private readonly api: string;

  constructor(apiBase: string, key: string | null = null) {
    this.api = `${apiBase.replace(/\/+$/, '')}/api/device/point`;
    this.key = key;
  }

  private auth(): Record<string, string> {
    if (!this.key) throw new Error('Not activated');
    return { authorization: `Bearer ${this.key}` };
  }

  private async post(path: string, body: unknown, auth = true) {
    const r = await fetch(`${this.api}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? this.auth() : {}) },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${path}: ${r.status} ${text}`);
    return text ? JSON.parse(text) : null;
  }

  async activate(code: string, secret: string): Promise<string> {
    this.key = PointKey.parse(await this.post('/activate', { code, secret }, false)).deviceKey;
    return this.key;
  }

  /** What to show now; with `wait`, held until it changes (304 when nothing did). */
  async state(wait = false): Promise<PointScreen | null> {
    const r = await fetch(`${this.api}/state`, { headers: { ...this.auth(), ...(wait && this.etag ? { 'if-none-match': this.etag } : {}) } });
    if (r.status === 304) return null;
    if (!r.ok) throw new Error(`/state: ${r.status} ${await r.text()}`);
    this.etag = r.headers.get('etag');
    return PointScreen.parse(await r.json());
  }

  /** Plugged in: every screen as the server sends it, until the returned function is called. */
  stream(on: (s: PointScreen) => void): () => void {
    const stop = new AbortController();
    void (async () => {
      const r = await fetch(`${this.api}/stream`, { headers: this.auth(), signal: stop.signal });
      const reader = r.body!.getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += new TextDecoder().decode(value);
        let at: number;
        while ((at = buf.indexOf('\n\n')) >= 0) {
          const event = buf.slice(0, at);
          buf = buf.slice(at + 2);
          const data = event.split('\n').find((l) => l.startsWith('data: '));
          if (data) on(PointScreen.parse(JSON.parse(data.slice(6))));
        }
      }
    })().catch(() => undefined);
    return () => stop.abort();
  }

  /**
   * The newest firmware for this Point's model, or null. Checked as the firmware must: against the
   * public keys it carries, with Ed25519, before anything is downloaded.
   */
  async firmware(trusted: Map<string, string>): Promise<{ manifest: PointFirmware; verified: boolean } | null> {
    const r = await fetch(`${this.api}/firmware`, { headers: this.auth() });
    if (r.status === 204) return null;
    if (!r.ok) throw new Error(`/firmware: ${r.status} ${await r.text()}`);
    const manifest = PointFirmware.parse(await r.json());
    const raw = trusted.get(manifest.keyId);
    if (!raw) return { manifest, verified: false };
    const key = await crypto.subtle.importKey('raw', Buffer.from(raw, 'base64'), { name: 'Ed25519' }, false, ['verify']);
    const { signature, ...unsigned } = manifest;
    const verified = await crypto.subtle.verify({ name: 'Ed25519' }, key, Buffer.from(signature, 'base64'), new TextEncoder().encode(firmwareSigningPayload(unsigned)));
    return { manifest, verified };
  }

  health(report: PointHealthReport) {
    return this.post('/health', report);
  }

  press(button: 'call' | 'bill', at = new Date()) {
    return this.post('/event', { kind: 'button', button, at: at.toISOString() });
  }
}
