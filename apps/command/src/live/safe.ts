// @ts-nocheck: writes into the sections' untyped data (src/sections/data.tsx).
import { CHAIN, DAY, SIGNERS, SIGN_W, TODAY, vars } from '../sections/data';
import { shortId } from './account';
import { api } from './api';
import { privy } from './privy';

/*
 * The Ops Safe, live (Phase 4a): its owners become Contracts' signers, and what's waiting in its
 * queue becomes what waits on each of them. Without a Safe configured, Contracts keeps its rows.
 */

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b),
    m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0;
};

export async function loadSafe() {
  const s = await api('GET', '/safe');
  vars.safe = s;
  if (!s.configured) return;
  const key = (o, i) => (o.person ? shortId({ id: o.person.id, name: o.person.name }) : `S${i + 1}`);
  const txs = [...s.pending, ...s.executed];
  // each owner's median hours from a transaction going up to their signature on it
  const hours = (addr) => txs.flatMap((t) => t.confirmations.filter((c) => c.owner === addr && t.proposer !== addr).map((c) => (Date.parse(c.at) - Date.parse(t.submittedAt)) / 3600e3)).filter((h) => h >= 0);
  vars.safeKeys = Object.fromEntries(s.owners.map((o, i) => [o.address, key(o, i)]));
  SIGNERS.splice(
    0,
    SIGNERS.length,
    ...s.owners.map((o, i) => [key(o, i), o.person?.name || short(o.address), o.you ? 'You' : o.person ? 'Signer' : 'Not linked to anyone here', Number(median(hours(o.address)).toFixed(1)), 'Nothing waiting']),
  );
  // signatures a week, the last eight weeks
  const weekOf = (t) => 7 - Math.floor((TODAY + DAY - Date.parse(t)) / (7 * DAY));
  for (const k of Object.keys(SIGN_W)) delete SIGN_W[k];
  for (const [i, o] of s.owners.entries()) {
    const w = Array(8).fill(0);
    for (const t of txs) for (const c of t.confirmations) if (c.owner === o.address && weekOf(c.at) >= 0 && weekOf(c.at) < 8) w[weekOf(c.at)]++;
    SIGN_W[key(o, i)] = w;
  }
  CHAIN.threshold = s.threshold;
}

/** The Safe transactions still waiting on a signer's signature, as Contracts lists them. */
export function safeWaitingOn(k) {
  const s = vars.safe;
  if (!s?.configured) return null;
  const addr = Object.keys(vars.safeKeys || {}).find((a) => vars.safeKeys[a] === k);
  if (!addr) return [];
  return s.pending.filter((t) => !t.confirmations.some((c) => c.owner === addr) && t.confirmations.length < t.confirmationsRequired).map((t) => ({ t: `${t.method || 'Transaction'} · nonce ${t.nonce}`, safeTxHash: t.safeTxHash }));
}

/** Links the wallet you sign with: picks one you have here (or connects one), signs the server's one-time message, and saves it. */
export async function linkWallet() {
  const address = privy.wallets()[0] ?? (await privy.connectWallet());
  const ch = await api('POST', '/me/wallet/challenge');
  const signature = await privy.signMessage(address, ch.message);
  const r = await api('POST', '/me/wallet', { id: ch.id, address, signature });
  if (vars.me) vars.me.wallet = r.wallet;
  await loadSafe().catch(() => undefined);
  return r.wallet;
}
