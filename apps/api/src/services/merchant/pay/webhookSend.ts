import { lookup as dnsLookup, type LookupAddress, type LookupAllOptions, type LookupOptions } from 'node:dns';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';

/**
 * Sending a webhook without letting an endpoint point Clear at its own network.
 *
 * The endpoint's URL is checked when it's added (`webhookUrlProblem`: https, a public name, no IP), but
 * a name can still resolve to a private address, and can change what it resolves to between a check and
 * the connection (DNS rebinding). So the check is in the connection itself: the request's own `lookup`
 * resolves the name and refuses it when any address it gets is loopback, private, link-local or
 * otherwise not on the public internet. Redirects are never followed (a 3xx is a failed try).
 */

const blocked = new BlockList();
const V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, and cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and broadcast
];
const V6: Array<[string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64, which can reach IPv4 inside
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
];
for (const [net, prefix] of V4) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of V6) blocked.addSubnet(net, prefix, 'ipv6');

/** An address on the public internet. `::ffff:a.b.c.d` is judged as the IPv4 address it carries. */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]!);
  const family = isIP(address);
  if (!family) return false;
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

type Resolve = (hostname: string, options: LookupAllOptions, callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;
const resolveAll: Resolve = (hostname, options, callback) => dnsLookup(hostname, options, callback);

/** A `lookup` for the connection: every address the name resolves to must be public, or none is used. */
export function guardedLookup(resolve: Resolve = resolveAll) {
  return (hostname: string, options: LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
    resolve(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, []);
      if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
        return callback(Object.assign(new Error(`${hostname} doesn’t resolve to a public address`), { code: 'ENOTPUBLIC' }), []);
      }
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

export type WebhookSend = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number }>;

/** POSTs a delivery over https through the guarded lookup. Answers with the endpoint's status. */
export function webhookSend(resolve: Resolve = resolveAll): WebhookSend {
  return (url, init) =>
    new Promise((resolveP, reject) => {
      const u = new URL(url);
      if (u.protocol !== 'https:') return reject(new Error('Webhooks go to https addresses only'));
      // A literal address skips the lookup, so it's refused here: endpoints are names (webhookUrlProblem).
      if (isIP(u.hostname.replace(/^\[|\]$/g, ''))) return reject(new Error('Webhooks go to a name, not an IP address'));
      const req = request(u, { method: init.method ?? 'POST', headers: init.headers, lookup: guardedLookup(resolve) as never }, (res) => {
        res.resume();
        resolveP({ status: res.statusCode ?? 0 });
      });
      req.on('error', reject);
      init.signal?.addEventListener('abort', () => req.destroy(new Error('No answer in time')), { once: true });
      req.end(init.body);
    });
}
