import { useContext, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { seesMoney } from '@clear/domain';
import { useAuth } from '@/auth/authContext';
import { OwnerSignIn } from '@/auth/OwnerSignIn';
import { OneColumn } from '@/brand/ui';
import { api, type PayoutPosition } from '@/data/apiClient';
import { useApi } from '@/data/useApi';
import GrantSignerPanel from '@/payouts/GrantSignerPanel';
import { fromPosition, NONE, PAYING, REFERENCE, YEAR_ON, type HistRow, type PayoutsModel } from '@/payouts/model';
import {
  AddBankSheet,
  BreakdownSheet,
  CashAccountCell,
  CashTipsCell,
  CycleCard,
  PayoutsCell,
  PayoutsHero,
  PayoutsLocked,
  ReceiveSheet,
  WhereItSitsCell,
  WhereWithdrawalsGoSheet,
} from '@/payouts/views';
import WithdrawModal, { type Stage } from '@/payouts/WithdrawModal';
import { useShiftActions } from '@/shell/shiftActions';

/**
 * Payouts — docs/merchant-reference/clear-merchant-payouts.html.
 *
 * Two balances, not one: what the co-op owes and what the cash account already holds. A business
 * asks "how much can I move right now, and when does the rest land", so that is the figure at the
 * top. Then the payout cycle, counting down to the day the rest releases, and the slab: the
 * payouts themselves, where the money sits, the cash account, and the drawer's cash and tips.
 *
 * A live shop's figures come from the payout position, and Withdraw and the signer grant are live.
 * Card deposits, the drawer, receiving by ACH and adding a bank have no backend yet, so they are
 * the preview's: `?preview=1&screen=none|paying|year|counter|withdraw|from|to|sending|done|
 * breakdown|receive|destinations|add-bank`.
 */

type Open = 'withdraw' | 'breakdown' | 'receive' | 'destinations' | 'add-bank' | null;

/** The reference's position, for the preview's withdraw sheet. */
const PREVIEW_POSITION: PayoutPosition = {
  owedCents: 421891,
  cashAccountCents: 61240,
  releasedReadyCents: 240000,
  scheduledCents: 181891,
  readyToWithdrawCents: 301240,
  nextPayoutOn: '2026-10-14T12:00:00',
  clearsBalanceCents: 0,
  toBankCents: 421891,
  availableTodayCents: 240000,
  paid: [],
};

/** The position couldn't be read: every figure says so rather than showing $0.00. */
const UNREAD: PayoutsModel = {
  readyCents: null,
  cashCents: null,
  releasedCents: null,
  scheduledCents: 0,
  owedCents: 0,
  on: null,
  dayOrdinal: '—',
  daysLeft: null,
  cycle: 'none',
  bank: null,
  clear: [],
  card: [],
};

export default function PayoutsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const one = useContext(OneColumn);
  const shift = useShiftActions();
  const { session } = useAuth();

  const preview = import.meta.env.DEV && params.get('preview') === '1' && params.get('live') !== '1';
  const screen = preview ? (params.get('screen') ?? '') : '';

  const { data: position, loading, reload } = useApi(() => (preview ? Promise.resolve(null) : api.payouts()), [preview]);
  const { data: profile } = useApi(() => (preview ? Promise.resolve(null) : api.profile()), [preview]);
  /*
   * Can Clear settle for this shop at all? A shop set up before Clear's signer existed has a wallet
   * only its owner can sign for, so Withdraw would take the request and never settle it. Asked here
   * so the page can offer the one-time grant instead.
   */
  const { data: signer, reload: reloadSigner } = useApi(() => (preview ? Promise.resolve(null) : api.signerStatus()), [preview]);
  const [granting, setGranting] = useState(false);

  const stages: Stage[] = ['from', 'to', 'sending', 'done'];
  const [open, setOpen] = useState<Open>(() =>
    screen === 'withdraw' || stages.includes(screen as Stage)
      ? 'withdraw'
      : (['breakdown', 'receive', 'destinations', 'add-bank'] as const).find((s) => s === screen) ?? null,
  );
  const [card, setCard] = useState<HistRow | null>(screen === 'breakdown' ? REFERENCE.card[0] : null);
  const [source, setSource] = useState<'owed' | 'cash' | undefined>(undefined);

  if (screen === 'counter') return <PayoutsLocked onOwner={shift.ownerSignIn} />;

  const bank = preview ? REFERENCE.bank : (profile?.payoutAccount ?? null);
  const m: PayoutsModel | null = preview
    ? screen === 'none'
      ? NONE
      : screen === 'paying'
        ? PAYING
        : screen === 'year'
          ? YEAR_ON
          : REFERENCE
    : position
      ? fromPosition(position, bank)
      : loading
        ? null
        : UNREAD;
  if (!m) return null;

  const pos = preview ? PREVIEW_POSITION : position;
  const withdraw = (s?: 'owed' | 'cash') => {
    setSource(s);
    setOpen('withdraw');
  };
  const me = (session?.staff.name ?? '').split(' ')[0];

  const payouts = (
    <PayoutsCell
      m={m}
      onCard={(r) => {
        setCard(r);
        setOpen('breakdown');
      }}
      onStatement={(r) => r.id && !preview && navigate(`/payouts/${r.id}`)}
    />
  );
  const sits = <WhereItSitsCell m={m} onBank={() => setOpen('destinations')} onDay={() => navigate(`/settings/payouts${preview ? '?preview=1' : ''}`)} />;
  const cash = <CashAccountCell m={m} onWithdraw={() => withdraw('cash')} onReceive={preview ? () => setOpen('receive') : undefined} />;
  const tips = m.drawer && <CashTipsCell d={m.drawer} me={me} />;

  return (
    <>
      <PayoutsHero m={m} />
      <CycleCard m={m} onWithdraw={() => withdraw()} />
      {signer && !signer.attached && seesMoney(session?.staff.role ?? 'counter') && (
        // Not drawn in the reference: the one-time grant, shown only while it is missing, where an
        // owner finds out it matters.
        <div className="c-mc-slot">
          <div className="c-panel">
            <div className="c-cmain">
              {granting ? (
                <OwnerSignIn
                  embedded
                  title="Allow Clear to settle payouts"
                  blurb="Sign in as the owner. The permission is yours to give, and only yours — your shop's wallet is not Clear's to change."
                  onDone={() => {
                    setGranting(false);
                    reloadSigner();
                  }}
                  onBack={() => setGranting(false)}
                  authorizedContent={({ signRequest, linkPasskey }) => (
                    <GrantSignerPanel
                      signRequest={signRequest as never}
                      linkPasskey={linkPasskey}
                      onGranted={() => {
                        setGranting(false);
                        reloadSigner();
                      }}
                    />
                  )}
                />
              ) : (
                <>
                  <p style={{ margin: 0, fontSize: 'var(--t-sec)', fontWeight: 500 }}>Let Clear settle your payouts</p>
                  <p className="c-det" style={{ marginTop: 4 }}>
                    Withdrawals are recorded but cannot settle until you allow it. You sign in once; Clear can then pay you out from the pool,
                    up to your agreed ceiling, and never move money anywhere else.
                  </p>
                </>
              )}
            </div>
            {!granting && (
              <div className="c-cfoot">
                <div className="c-line" style={{ alignItems: 'center' }}>
                  <span className="c-det">The owner signs in once</span>
                  <button type="button" className="c-btn" onClick={() => setGranting(true)}>
                    Allow
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {one ? (
        <div className="c-slab c-one">
          {sits}
          {cash}
          {tips}
          {payouts}
        </div>
      ) : (
        <div className="c-slab">
          {payouts}
          <div className="c-col">
            {sits}
            {cash}
            {tips}
          </div>
        </div>
      )}

      {open === 'withdraw' && pos && (
        <WithdrawModal
          position={pos}
          bankName={bank}
          initialSource={source}
          initialEntry={preview && screen ? '2400' : ''}
          initialStage={stages.includes(screen as Stage) ? (screen as Stage) : 'amount'}
          request={
            preview
              ? async (input) => ({
                  id: 'preview',
                  amountCents: input.amountCents,
                  source: input.source,
                  destination: input.destination,
                  throughCashAccount: input.source === 'owed',
                  nextPayoutOn: PREVIEW_POSITION.nextPayoutOn,
                  cashAccountCents: PREVIEW_POSITION.cashAccountCents,
                  owedCents: PREVIEW_POSITION.owedCents,
                  status: 'requested',
                })
              : undefined
          }
          onClose={() => setOpen(null)}
          onDone={reload}
        />
      )}
      {open === 'breakdown' && card?.card && <BreakdownSheet r={card} onClose={() => setOpen(null)} />}
      {open === 'receive' && <ReceiveSheet name="Mike’s Tire LLC" routing="084106768" account="9600000418824" onClose={() => setOpen(null)} />}
      {open === 'destinations' && <WhereWithdrawalsGoSheet bank={bank ?? 'Bank account'} onAdd={preview ? () => setOpen('add-bank') : undefined} onClose={() => setOpen(null)} />}
      {open === 'add-bank' && <AddBankSheet onClose={() => setOpen(null)} />}
    </>
  );
}
