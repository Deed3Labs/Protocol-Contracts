import { useEffect, useState } from 'react';
import { api } from '../live/api';

/*
 * Liquidation Holds and shortfall notices (Phase 2b, sections 12.6 and 12.8), on Money → Credit.
 *
 * A hold pauses enforcement against a member's pledged collateral (bankruptcy, death, a billing
 * dispute, a late default notice). Every step is a two-person HOLD_ROLE action on the Liquidator:
 * one signer proposes, a DIFFERENT signer confirms; renewing must come from a different signer than
 * the last one; clearing an active hold takes two different signers. The API only encodes each step
 * (POST /liquidation-holds/prepare); the signer sends it from their own wallet. No key is held for it.
 *
 * Shortfall notices are read alongside: when one was noticed and when it may be settled (the governed
 * wait, 72 hours or more). The enforcement keeper settles it then, unless a hold is active.
 */

type Hold = {
  proposer: string;
  reason: string;
  confirmed: boolean;
  setAt: number;
  lastSigner: string;
  until: number;
  clearProposer: string | null;
  active: boolean;
};
type Row = {
  wallet: string;
  hold: Hold | null;
  shortfall: { noticedAt: number; settleableAt: number; gapCents: number } | null;
  excessCents: number;
};
type Read = { liquidator: string; chainId: number; members: Row[]; shortfallWaitSeconds: number; maxHoldDays: Record<string, number> };
type Prepared = { to: string; data: string; value: string; chainId: number; note: string };
type Action = 'propose' | 'confirm' | 'renew' | 'clear';

const REASONS = ['BANKRUPTCY', 'DEATH', 'BILLING_DISPUTE', 'LATE_NOTICE'] as const;
const WORDS: Record<string, string> = { BANKRUPTCY: 'Bankruptcy', DEATH: 'Death', BILLING_DISPUTE: 'Billing dispute', LATE_NOTICE: 'Late default notice' };
const short = (a: string | null | undefined) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const day = (t: number) => (t ? new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—');
const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function holdState(h: Hold | null): string {
  if (!h) return 'None';
  if (!h.confirmed) return h.until * 1000 > Date.now() ? 'Proposed · waiting for a second signer' : 'Proposal lapsed';
  if (!h.active) return 'Lapsed';
  return h.clearProposer ? 'Active · clearing proposed, waiting for a second signer' : 'Active';
}

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

/** Sends a prepared step from the signer's own browser wallet. Nothing here holds a key. */
async function sendFromWallet(p: Prepared): Promise<string> {
  const eth = (window as unknown as { ethereum?: Eth }).ethereum;
  if (!eth) throw new Error('No browser wallet here. Copy the transaction into your wallet or Safe instead.');
  const [from] = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${p.chainId.toString(16)}` }] }).catch(() => null);
  return (await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: p.to, data: p.data, value: '0x0' }] })) as string;
}

export function LiquidationHolds() {
  const [read, setRead] = useState<Read | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ action: 'propose' as Action, member: '', reason: 'DEATH', durationDays: '90', evidence: '', until: '' });
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off = false;
    api<Read>('GET', '/liquidation-holds')
      .then((r) => !off && setRead(r))
      .catch((e) => !off && setError(e instanceof Error ? e.message : 'Could not read the Liquidator'));
    return () => {
      off = true;
    };
  }, []);

  const prepare = async () => {
    setBusy(true);
    setError(null);
    setPrepared(null);
    setSent(null);
    try {
      const untilUnix = form.until ? Math.floor(Date.parse(`${form.until}T00:00:00Z`) / 1000) : 0;
      setPrepared(
        await api<Prepared>('POST', '/liquidation-holds/prepare', {
          action: form.action,
          member: form.member.trim(),
          reason: form.reason,
          durationDays: Number(form.durationDays),
          evidence: form.evidence,
          untilUnix,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare that step');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!prepared) return;
    setBusy(true);
    setError(null);
    try {
      setSent(await sendFromWallet(prepared));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your wallet did not send it');
    } finally {
      setBusy(false);
    }
  };

  const pick = (row: Row, action: Action) => {
    setForm((f) => ({ ...f, action, member: row.wallet }));
    setPrepared(null);
    setSent(null);
  };

  const rows = read?.members ?? [];
  return (
    <section className="band" data-liquidation-holds="">
      <div className="bento">
        <div className="cell s12">
          <div className="hd">
            <h2>Liquidation Holds and shortfall notices</h2>
            <div className="r">
              <span className="lbl">{read ? `Liquidator ${short(read.liquidator)} · shortfall wait ${Math.round(read.shortfallWaitSeconds / 3600)} h` : 'Liquidator'}</span>
            </div>
          </div>
          <p className="small quiet" style={{ padding: '0 22px' }}>
            Every hold step is two-person: one HOLD_ROLE signer proposes and a <b>different</b> signer confirms. Renewing must come from a
            different signer than the last one, and clearing an active hold takes two different signers. Each step is sent from the
            signer’s own wallet; Command holds no key for it.
          </p>
          {error ? <p className="small" style={{ padding: '0 22px', color: 'var(--absent)' }}>{error}</p> : null}
          <div className="bt-wrap">
            <table className="bt">
              <thead>
                <tr>
                  <th className="c-nm">Member</th>
                  <th style={{ textAlign: 'left' }}>Hold</th>
                  <th style={{ textAlign: 'left' }}>Signers</th>
                  <th>Until</th>
                  <th style={{ textAlign: 'left' }}>Shortfall</th>
                  <th>Excess</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!read ? (
                  <tr><td colSpan={7} className="tn"><span className="quiet">{error ? 'Not read.' : 'Reading the Liquidator…'}</span></td></tr>
                ) : !rows.length ? (
                  <tr><td colSpan={7} className="tn"><span className="quiet">No holds, shortfall notices or excesses.</span></td></tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.wallet}>
                      <td className="tn"><b>{short(r.wallet)}</b></td>
                      <td style={{ textAlign: 'left' }}>{r.hold ? `${WORDS[r.hold.reason] ?? r.hold.reason} · ${holdState(r.hold)}` : 'None'}</td>
                      <td style={{ textAlign: 'left' }}>
                        {r.hold ? `proposed ${short(r.hold.proposer)} · last ${short(r.hold.lastSigner)}${r.hold.clearProposer ? ` · clear by ${short(r.hold.clearProposer)}` : ''}` : '—'}
                      </td>
                      <td>{r.hold ? day(r.hold.until) : '—'}</td>
                      <td style={{ textAlign: 'left' }}>
                        {r.shortfall ? `${usd(r.shortfall.gapCents)} · noticed ${day(r.shortfall.noticedAt)} · settleable ${day(r.shortfall.settleableAt)}` : '—'}
                      </td>
                      <td>{r.excessCents ? usd(r.excessCents) : '—'}</td>
                      <td>
                        {!r.hold || (!r.hold.active && r.hold.confirmed) ? <button className="btn sm-b" onClick={() => pick(r, 'propose')}>Propose</button> : null}
                        {r.hold && !r.hold.confirmed ? <button className="btn sm-b" onClick={() => pick(r, 'confirm')}>Confirm</button> : null}
                        {r.hold?.active ? <button className="btn sm-b" onClick={() => pick(r, 'renew')}>Renew</button> : null}
                        {r.hold ? <button className="btn sm-b" onClick={() => pick(r, 'clear')}>Clear</button> : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 22px', display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select aria-label="Step" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value as Action })}>
                <option value="propose">Propose a hold</option>
                <option value="confirm">Confirm (a different signer)</option>
                <option value="renew">Renew (a different signer)</option>
                <option value="clear">Clear (two different signers)</option>
              </select>
              <input aria-label="Member wallet" placeholder="0x… member" value={form.member} onChange={(e) => setForm({ ...form, member: e.target.value })} style={{ minWidth: 340 }} />
              {form.action === 'propose' ? (
                <>
                  <select aria-label="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                    {REASONS.map((r) => (
                      <option key={r} value={r}>{`${WORDS[r]}${read?.maxHoldDays?.[r] ? ` (up to ${read.maxHoldDays[r]} days)` : ''}`}</option>
                    ))}
                  </select>
                  <input aria-label="Days" inputMode="numeric" value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: e.target.value.replace(/[^0-9]/g, '') })} style={{ width: 70 }} />
                  <input aria-label="Evidence" placeholder="Evidence reference or 0x hash (hashed, never stored on chain)" value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} style={{ minWidth: 320 }} />
                </>
              ) : null}
              {form.action === 'renew' ? <input aria-label="Renew until" type="date" value={form.until} onChange={(e) => setForm({ ...form, until: e.target.value })} /> : null}
              <button className="btn p" disabled={busy || !form.member} onClick={() => void prepare()}>Prepare</button>
            </div>
            {prepared ? (
              <div className="small">
                <p><b>{prepared.note}</b></p>
                <p>To <code>{prepared.to}</code> on chain {prepared.chainId}, value 0</p>
                <p style={{ wordBreak: 'break-all' }}>Data <code>{prepared.data}</code></p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn sm-b" onClick={() => void navigator.clipboard?.writeText(prepared.data)}>Copy data</button>
                  <button className="btn p" disabled={busy} onClick={() => void send()}>Send from my wallet</button>
                </div>
                {sent ? <p>Sent: <code>{sent}</code>. The next step needs a different signer.</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
