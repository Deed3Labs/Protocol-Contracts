import { api } from '../live/api';

/*
 * Build → Signing, live (brief update 2, section 6): the rollout's signing plan, signed from Command.
 *
 * Ported from tools/signing-page/index.html, which stays the reference for this flow:
 * - the plan (format clear-signing-plan/1) is written by scripts/signing_plan.ts and committed; the API serves it
 *   untouched and this checks it as the signing page does: Base Sepolia only, every step well formed, and
 *   sha256(JSON.stringify(steps)) equal to its stepsSha256;
 * - a wallet step is sent from MetaMask by the account it names, with exactly the plan's call (to, data, value 0):
 *   Command never builds a call and holds no key;
 * - a Safe step is a Safe Transaction Builder batch file, opened in the Safe app, where its owners sign;
 * - what this browser sent is kept per plan (by its fingerprint), and its receipts are read from the wallet;
 * - where each step stands NOW comes with the plan (SIGNING.live): the API reads the chain and each Safe's queue at
 *   most every five minutes while Command is open, and again on "Check now", so a step turns done or ready without
 *   anyone re-running the plan script;
 * - a ready Safe step goes into its own Safe's queue from here: an owner's MetaMask signs exactly the step's call
 *   at the Safe's next nonce, the API checks the signer is one of that Safe's owners and hands it to the Safe's
 *   service; further owners sign the queued copy here or in the Safe app, and it's executed in the Safe app.
 */

export const BASE_SEPOLIA = 84532;
const CHAIN = {
  hex: '0x14a34',
  explorer: 'https://sepolia.basescan.org',
  safePrefix: 'basesep',
  add: { chainId: '0x14a34', chainName: 'Base Sepolia', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://sepolia.base.org'], blockExplorerUrls: ['https://sepolia.basescan.org'] },
};

export interface PlanArg {
  name: string;
  type: string;
  value: string;
  note?: string;
}
export interface PlanStep {
  id: string;
  stage: string;
  title: string;
  explanation: string;
  kind: 'wallet' | 'safe';
  signer: string;
  signerLabel: string;
  chainId: number;
  to: string;
  toLabel: string;
  value: string;
  data: string | null;
  functionSignature: string;
  args: PlanArg[];
  dependsOn?: string[];
  status: 'ready' | 'done' | 'waiting';
  reason?: string;
  safeBatchFile?: string;
}
export interface Plan {
  format: string;
  generatedAt: string;
  network: string;
  chainId: number;
  block: number;
  blockTime?: string;
  stepsSha256: string;
  notes?: string[];
  steps: PlanStep[];
}
/** What the API sends (contractsSection's SIGNING). */
export interface StepLive {
  status: 'done' | 'ready' | 'waiting';
  why?: string;
  opensAt?: string;
  by: string;
  txHash?: string;
  queued?: { safeTxHash: string; nonce: number; signed: string[]; required: number; behind: number[]; link: string };
}
export interface SafeLive {
  address: string;
  owners: string[];
  threshold: number;
  nonce: number;
  others: Array<{ nonce: number; safeTxHash: string; what: string; signed: number; required: number }>;
  link: string;
  problem?: string;
}
export interface SigningLive {
  stepsSha256: string;
  checkedAt: number;
  nextCheckAt: number;
  block: number;
  blockTime: number;
  steps: Record<string, StepLive>;
  safes: Record<string, SafeLive>;
}
export interface SigningPayload {
  source: 'plan' | 'run-log' | 'none';
  file?: string;
  plan: Plan | null;
  live?: SigningLive;
  liveProblem?: string;
  runLog?: { file: string; block?: number; at?: string; steps: Array<{ id: string; status: 'done' | 'waiting' | 'ready'; why?: string }> } | null;
}

/* the rollout's stages: a short code and a name (the reference's SG_STAGES; E9 is the signing page's) */
const STAGES: Record<string, [string, string]> = {
  C1d: ['C1d', 'Savings vault'],
  D4: ['D4', 'Credit roles'],
  E8: ['E8', 'Earn changes'],
  E9: ['E9', 'Backstop change'],
  F2: ['F2', 'Fee recipient'],
  'Pool Tier': ['G1', 'Pool Tier'],
  'Safe (before I2)': ['SF', 'Treasury Safe'],
  I3: ['I3', 'Vault timelock'],
  Assurance: ['AS', 'Assurance'],
  'Payout top-ups': ['TU', 'Top-ups'],
  SA: ['SA', 'State attester'],
  SR: ['SR', 'Credit by state'],
  SL: ['SL', 'Settlement lane'],
  RT: ['RT', 'Lending routes'],
  CF: ['CF', 'Card credit fee'],
  'Day 7': ['D7', 'Day 7 runs'],
};
export const stageOf = (st: string): [string, string] => STAGES[st] || [st, st];

const isAddress = (a: unknown) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
const isHex = (a: unknown) => typeof a === 'string' && /^0x([0-9a-fA-F]{2})*$/.test(a);
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const shortA = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

async function sha256Hex(text: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Checks a plan as the signing page does. Command signs on Base Sepolia only (Kai, 17 Nov). */
export async function verifyPlan(p: any): Promise<{ plan: Plan } | { error: string }> {
  if (!p || p.format !== 'clear-signing-plan/1' || !Array.isArray(p.steps)) return { error: 'Not a signing plan: it should come from scripts/signing_plan.ts' };
  if (p.chainId !== BASE_SEPOLIA) return { error: `Refused: this plan is for chain ${p.chainId}. Command signs on Base Sepolia (84532) only.` };
  for (let i = 0; i < p.steps.length; i++) {
    const s = p.steps[i];
    if (!s || typeof s.id !== 'string') return { error: `Refused: step ${i + 1} is malformed.` };
    if (s.chainId !== p.chainId) return { error: `Refused: step ${s.id} is for chain ${s.chainId}, not the plan’s ${p.chainId}.` };
    if (!isAddress(s.signer) || !isAddress(s.to) || (s.data !== null && !isHex(s.data)) || s.value !== '0') return { error: `Refused: step ${s.id} is malformed.` };
  }
  const digest = await sha256Hex(JSON.stringify(p.steps));
  if (digest === null) return { error: 'This browser can’t check the plan’s fingerprint here (it needs a secure page).' };
  if (digest !== p.stepsSha256) return { error: 'Refused: the plan’s steps don’t match its fingerprint. Re-run the plan script.' };
  return { plan: p as Plan };
}

/* ── what this browser sent, per plan ── */
export type Sent = Record<string, { hash?: string; state: 'pending' | 'success' | 'failed'; at?: string; block?: number }>;
const storeKey = (sha: string) => `clear-command-signing:${sha}`;
export function loadSent(sha: string): Sent {
  try {
    const raw = localStorage.getItem(storeKey(sha));
    return raw ? JSON.parse(raw) || {} : {};
  } catch {
    return {};
  }
}
export function saveSent(sha: string, sent: Sent) {
  try {
    localStorage.setItem(storeKey(sha), JSON.stringify(sent));
  } catch {
    /* storage off: the page still works */
  }
}

/** A signer as the tab shows it: a short name and who it belongs to (the reference's role tags). */
function account(label: string): [string, string] {
  const l = String(label || '').replace(/^\[Safe\]\s*/, '');
  const short = l.replace(/\s*\(.*\)\s*$/, '').replace(/^the /, '').replace(/ 0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/, '');
  const name = short.charAt(0).toUpperCase() + short.slice(1);
  const tag = /deployer/i.test(l)
    ? 'OPS'
    : /agent key/i.test(l)
      ? 'AG'
      : /assurance signer/i.test(l)
        ? 'CO'
        : /treasury safe|clear financial/i.test(l)
          ? 'CF'
          : /treasury signer|clear lending|credit settings|valuation|cl operating/i.test(l)
            ? 'CL'
            : 'OPS';
  return [name, tag];
}

/**
 * The plan as Build → Signing draws it (the reference's SG): steps with the stage code, the signer as an
 * account key (its address, lower case), the contract on the map when its name is there, and the call.
 */
export function sgFromPlan(p: Plan, file: string, ctrIdByName: (name: string) => string | null) {
  const accts: Record<string, [string, string, string]> = {};
  const stages: Array<[string, string]> = [];
  const steps = p.steps.map((s) => {
    const k = s.signer.toLowerCase();
    if (!accts[k]) {
      const [n, tag] = account(s.signerLabel);
      accts[k] = [s.kind === 'safe' ? `${n} · Safe` : n, shortA(s.signer), tag];
    }
    const [code, name] = stageOf(s.stage);
    if (!stages.some((x) => x[0] === code)) stages.push([code, name]);
    const toName = String(s.toLabel || '').replace(/\s*\(.*\)\s*$/, '');
    return {
      id: s.id,
      st: code,
      kind: s.kind,
      who: k,
      to: ctrIdByName(toName),
      toLbl: toName || shortA(s.to),
      fn: s.functionSignature,
      t: s.title,
      x: s.explanation,
      args: (s.args || []).map((a) => [a.name, a.type, a.note || (a.value.length > 22 ? shortA(a.value) : a.value)]),
      status: s.status,
      why: s.reason || '',
      dep: s.dependsOn && s.dependsOn.length ? s.dependsOn : null,
      call: s,
    };
  });
  // the track in the rollout's order (the reference's, Day 7 last); a stage it doesn't know goes before Day 7
  const ORDER = Object.values(STAGES).map((x) => x[0]);
  const rank = (c: string) => (ORDER.includes(c) ? ORDER.indexOf(c) : ORDER.length - 1.5);
  stages.sort((a, b) => rank(a[0]) - rank(b[0]));
  return {
    plan: { name: 'Base Sepolia rollout', chain: p.chainId, block: p.block, generated: Date.parse(p.generatedAt), sha: `${p.stepsSha256.slice(0, 12)}…`, file, full: p.stepsSha256 },
    accts,
    stages,
    steps,
  };
}

/* A waiting step opens here once every step it waits on is done, only when the plan script held it back for those
   alone ("Waits for … first.") and its call data is known (the signing page's rule). */
const DEPENDENCY_ONLY = /^Waits for .+ first\.$/;
export function stateOf(s: any, sent: Sent, byId: Record<string, any>): string {
  if (s.status === 'done') return 'done';
  const r = sent[s.id];
  if (r && (r.state === 'pending' || r.state === 'success' || r.state === 'failed')) return r.state;
  if (s.status === 'ready') return 'ready';
  const depsDone = s.dep && s.dep.every((d: string) => ['done', 'success'].includes(stateOf(byId[d] || {}, sent, byId)));
  return depsDone && s.call?.data && DEPENDENCY_ONLY.test(s.why || '') ? 'ready' : 'waiting';
}

/* ── the wallet ── */
const eth = () => (globalThis as any).ethereum ?? null;
export const W: { account: string | null; chain: number | null; error: string; busy: Record<string, boolean> } = { account: null, chain: null, error: '', busy: {} };
export const hasWallet = () => !!eth();

async function switchChain() {
  const e = eth();
  try {
    await e.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.hex }] });
  } catch (err: any) {
    const code = err?.code ?? err?.data?.originalError?.code;
    if (code === 4902) await e.request({ method: 'wallet_addEthereumChain', params: [CHAIN.add] });
    else throw err;
  }
}

/** What MetaMask already shares, without asking (on load). */
export async function readWallet() {
  const e = eth();
  if (!e) return;
  try {
    const a = await e.request({ method: 'eth_accounts' });
    W.account = a?.[0]?.toLowerCase() ?? null;
    W.chain = parseInt(await e.request({ method: 'eth_chainId' }), 16);
  } catch {
    /* leave it */
  }
}

export async function connect() {
  W.error = '';
  const e = eth();
  if (!e) {
    W.error = 'MetaMask isn’t in this browser.';
    return;
  }
  try {
    const a = await e.request({ method: 'eth_requestAccounts' });
    W.account = a?.[0]?.toLowerCase() ?? null;
    W.chain = parseInt(await e.request({ method: 'eth_chainId' }), 16);
    if (W.chain !== BASE_SEPOLIA) {
      await switchChain();
      W.chain = parseInt(await e.request({ method: 'eth_chainId' }), 16);
    }
  } catch (err: any) {
    W.error = err?.code === 4001 ? 'You declined in MetaMask. Nothing was changed.' : `MetaMask said: ${err?.message ?? err}`;
  }
}

let listening = false;
/** Follows MetaMask's account and network as they change. */
export function listen(onChange: () => void) {
  const e = eth();
  if (!e?.on || listening) return;
  listening = true;
  e.on('accountsChanged', (a: string[]) => {
    W.account = a?.[0]?.toLowerCase() ?? null;
    onChange();
  });
  e.on('chainChanged', (hex: string) => {
    W.chain = parseInt(hex, 16);
    onChange();
  });
}

/** Sends a wallet step: exactly the plan's call, from the account it names, on Base Sepolia. Returns the hash. */
export async function send(step: PlanStep): Promise<string | null> {
  W.error = '';
  const e = eth();
  if (!e || !W.account || !same(W.account, step.signer) || W.chain !== BASE_SEPOLIA || step.kind !== 'wallet' || !step.data || step.value !== '0' || step.chainId !== BASE_SEPOLIA) return null;
  try {
    return await e.request({ method: 'eth_sendTransaction', params: [{ from: step.signer, to: step.to, data: step.data, value: '0x0' }] });
  } catch (err: any) {
    W.error = err?.code === 4001 ? 'You declined in MetaMask. Nothing was sent.' : `MetaMask couldn’t send it: ${err?.message ?? err}`;
    return null;
  }
}

/** A sent step's receipt, from the wallet's node: 'success', 'failed', or null while it's pending. */
export async function receipt(hash: string): Promise<{ state: 'success' | 'failed'; block: number } | null> {
  const e = eth();
  if (!e) return null;
  const r = await e.request({ method: 'eth_getTransactionReceipt', params: [hash] });
  return r && r.status ? { state: parseInt(r.status, 16) === 1 ? 'success' : 'failed', block: parseInt(r.blockNumber, 16) } : null;
}

export const explorerTx = (hash: string) => `${CHAIN.explorer}/tx/${hash}`;

/* ── Safe steps ── */
export function safeBatchJson(step: PlanStep, p: Plan) {
  return JSON.stringify(
    {
      version: '1.0',
      chainId: String(p.chainId),
      createdAt: Date.now(),
      meta: { name: step.title, description: `${step.explanation} From the signing plan at block ${p.block}.` },
      transactions: [{ to: step.to, value: '0', data: step.data }],
    },
    null,
    2,
  );
}
export function downloadBatch(step: PlanStep, p: Plan) {
  const blob = new Blob([safeBatchJson(step, p)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `signing-${step.id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
/** The Safe app's Transaction Builder, open on the step's Safe. */
export const safeAppUrl = (step: PlanStep) => `https://app.safe.global/apps/open?safe=${CHAIN.safePrefix}:${step.signer}&appUrl=${encodeURIComponent('https://apps-portal.safe.global/tx-builder')}`;

/* ── where each step stands now (the API's live check) ── */

/** Puts the live statuses on the drawn steps, when they're for this plan. Returns whether they were. */
export function applyLive(steps: any[], live: SigningLive | null | undefined, sha: string): boolean {
  if (!live || live.stepsSha256 !== sha) return false;
  for (const s of steps) {
    const l = live.steps[s.id];
    if (!l) continue;
    s.status = l.status;
    s.why = l.why || (l.status === 'waiting' ? s.why : '');
    s.opensAt = l.opensAt || null;
    s.queued = l.queued || null;
    s.txHash = l.txHash || null;
    s.liveBy = l.by;
  }
  return true;
}

/** "in 1 d 6 h", "in 25 min", "now". */
export function untilText(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso) - now;
  if (!(ms > 0)) return 'now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return `in ${Math.floor(h / 24)} d ${h % 24} h`;
}

/** "just now", "4 min ago". */
export function agoText(at: number, now = Date.now()): string {
  const m = Math.floor((now - at) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
}

/** Whether the connected MetaMask account owns the step's Safe. */
/** A Safe's owners and queue from the live check, whatever the case of its address. */
export const safeOf = (live: SigningLive | null | undefined, safe: string): SafeLive | null => {
  const k = Object.keys(live?.safes || {}).find((x) => same(x, safe));
  return k ? live!.safes[k] : null;
};
export const ownsSafe = (live: SigningLive | null | undefined, safe: string, account: string | null) => !!account && !!safeOf(live, safe)?.owners?.some((o) => same(o, account));

/** "Check now": the API reads the chain and the Safes again (unless it did seconds ago). */
export const checkNow = () => api<{ live: SigningLive | null; liveProblem: string | null }>('POST', '/signing/check');

/** Signs Safe typed data with the connected MetaMask account, on Base Sepolia. */
async function signSafe(typedData: unknown): Promise<string> {
  const e = eth();
  if (!e || !W.account) throw new Error('Connect MetaMask first.');
  if (W.chain !== BASE_SEPOLIA) throw new Error('Switch MetaMask to Base Sepolia first.');
  try {
    return await e.request({ method: 'eth_signTypedData_v4', params: [W.account, JSON.stringify(typedData)] });
  } catch (err: any) {
    throw new Error(err?.code === 4001 ? 'You declined in MetaMask. Nothing was signed.' : `MetaMask couldn’t sign it: ${err?.message ?? err}`);
  }
}

/** Puts a ready Safe step in its Safe's queue: Command builds nothing, the API prepares exactly the plan's call. */
export async function proposeSafe(step: PlanStep): Promise<{ safeTxHash: string; nonce: number; signed: number; required: number }> {
  const stepId = step.id;
  const p = await api<any>('POST', '/signing/safe/prepare', { stepId });
  const m = p.typedData?.message;
  // the wallet signs only what the plan says: this Safe, this call, nothing sent with it
  if (step.kind !== 'safe' || !step.data || (!same(p.safe, step.signer) || !same(p.typedData?.domain?.verifyingContract, step.signer) || !same(m?.to, step.to) || String(m?.data).toLowerCase() !== String(step.data).toLowerCase() || String(m?.value) !== '0' || Number(m?.operation) !== 0 || Number(p.typedData?.domain?.chainId) !== BASE_SEPOLIA))
    throw new Error('What the API prepared isn’t exactly this step’s call. Nothing was signed.');
  const signature = await signSafe(p.typedData);
  return api<any>('POST', '/signing/safe/propose', { stepId, nonce: p.nonce, signature });
}

/** Adds the connected owner's signature to a Safe step already in its queue. */
export async function confirmSafe(step: PlanStep, safeTxHash: string): Promise<{ signed: number; required: number }> {
  const stepId = step.id;
  const t = await api<any>('POST', '/signing/safe/tx', { stepId, safeTxHash });
  const m = t.typedData?.message;
  if (step.kind !== 'safe' || !step.data || (!same(t.typedData?.domain?.verifyingContract, step.signer) || Number(t.typedData?.domain?.chainId) !== BASE_SEPOLIA || !same(m?.to, step.to) || String(m?.data).toLowerCase() !== String(step.data).toLowerCase() || String(m?.value) !== '0' || Number(m?.operation) !== 0))
    throw new Error('The queued copy isn’t exactly this step’s call. Nothing was signed.');
  const signature = await signSafe(t.typedData);
  return api<any>('POST', '/signing/safe/confirm', { stepId, safeTxHash, signature });
}
