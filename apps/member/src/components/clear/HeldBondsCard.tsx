import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './Modal';
import MenuButton from './brand/MenuButton';
import { Btn, CBar, CFoot, CHead, CMain, Cell, Line, Rows, SecHead } from './brand/anatomy';
import { ChevronIcon, SortIcon } from './brand/icons';
import { money } from '@clear/domain';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { bondsWorth, monthYear, type EarnData, type HeldBond } from '@/lib/clearModel';
import { useOptionalAddress, useOptionalSmartWalletClient } from '@/hooks/useOptionalWallet';
import { ACTIVE_CHAIN_ID } from '@/lib/clearNetwork';
import { scBondAction } from '@/lib/sendCalls';
import { markChainStale } from '@/lib/chainStale';
import { shortMoveReason } from '@/hooks/usePoolMove';
import { track } from '@/lib/analytics';

type BondAction = 'redeem' | 'roll' | 'cash-at-maturity' | 'roll-at-maturity';

/**
 * What a holder can do with one bond: once it has matured, take the face value or roll it into a
 * new bond; before then, choose which of the two happens. Sent to the collection that issued it.
 */
function useBondAction(bond: HeldBond, onDone: () => void) {
  const address = useOptionalAddress();
  const getClientForChain = useOptionalSmartWalletClient();
  const [busy, setBusy] = useState<BondAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: BondAction) => {
    if (!address || !bond.collection) {
      setError('Connect a wallet first.');
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const smartWalletClient = getClientForChain
        ? await getClientForChain({ id: ACTIVE_CHAIN_ID }).catch(() => undefined)
        : undefined;
      await scBondAction({
        smartWalletClient,
        ownerWallet: address,
        collection: bond.collection,
        bondId: bond.id,
        action,
        chainId: ACTIVE_CHAIN_ID,
      });
      track(action === 'redeem' ? 'bond_redeemed' : action === 'roll' ? 'bond_rolled' : 'bond_maturity_choice', {});
      // The bond list, the shelf and the limit it backs all move with this.
      markChainStale();
      onDone();
    } catch (e) {
      setError(shortMoveReason(e instanceof Error ? e.message : "That didn't go through."));
    } finally {
      setBusy(null);
    }
  };
  return { run, busy, error };
}

type Filter = 'all' | 'year' | 'later';
type Sort = 'maturity' | 'face' | 'worth';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All bonds' },
  { id: 'year', label: 'Within a year' },
  { id: 'later', label: 'Later' },
];

const SORTS: { id: Sort; label: string }[] = [
  { id: 'maturity', label: 'Maturity' },
  { id: 'face', label: 'Face value' },
  { id: 'worth', label: 'Worth today' },
];

/** The list is built to grow, so it shows this many and See all opens the rest in place. */
const SHOWN = 4;

/**
 * BurnerBond — what a row in Your bonds opens. The list was built to grow, so the detail had to
 * exist somewhere other than the row.
 *
 * Face value leads, with what it is worth today beneath it in cobalt; then what was paid, when it
 * matures, what it gains and what it backs.
 */
function BondDetailDialog({
  bond,
  ltv,
  open,
  onOpenChange,
}: {
  bond: HeldBond;
  ltv: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const gain = bond.face - bond.paid;
  const matured = bond.maturityUnix !== undefined && bond.maturityUnix <= Date.now() / 1000;
  const actionable = Boolean(bond.collection);
  const { run, busy, error } = useBondAction(bond, () => onOpenChange(false));

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="BurnerBond"
      description={`A ${money(bond.face)} bond maturing ${monthYear(bond.maturesOn)}.`}
      footer={
        <>
          {actionable && matured && (
            <div className="c-pair mb-s2">
              {!bond.backsDrawnCredit && (
                <Btn primary disabled={busy !== null} onClick={() => run('redeem')}>
                  {busy === 'redeem' ? 'Redeeming…' : `Redeem ${money(bond.face)}`}
                </Btn>
              )}
              {bond.autoRoll !== false && (
                <Btn disabled={busy !== null} onClick={() => run('roll')}>
                  {busy === 'roll' ? 'Rolling…' : 'Roll it over'}
                </Btn>
              )}
            </div>
          )}
          {error && <p className="c-det text-negative mb-s2">{error}</p>}
          <div className="c-footnote mt-0! border-t-0! pt-0!">
            {matured && bond.backsDrawnCredit ? (
              <p>
                Matured, and backing credit you&rsquo;ve drawn &mdash; roll it over to keep it there, or pay the credit down
                first to redeem it.
              </p>
            ) : matured ? (
              <p>
                Matured. Redeem it for the face value, paid to Ready to allocate, or roll it into a new bond so it keeps
                backing your credit line.
              </p>
            ) : (
              <p>
                Locked until maturity. It backs your credit line automatically at 0.65% a cycle &mdash; there is nothing to
                borrow, the card just reaches it when the cheaper tiers run out.
              </p>
            )}
          </div>
          {/* No borrow button: credit draws on its own, so the way through is to the limit it backs. */}
          <div className="c-pair mt-s2">
            <Btn
              onClick={() => {
                onOpenChange(false);
                navigate('/?do=limit-breakdown');
              }}
            >
              See your limit
            </Btn>
            <Btn
              onClick={() => {
                onOpenChange(false);
                navigate('/activity');
              }}
            >
              See in activity
            </Btn>
          </div>
        </>
      }
    >
      <p className="c-label">Face value</p>
      <p className="c-bigamt">
        {money(Math.trunc(bond.face))}
        <span className="c-dec">.{String(Math.round((bond.face % 1) * 100)).padStart(2, '0')}</span>
      </p>
      <p className="c-paytoday">Worth {money(bond.worthToday, { cents: true })} today</p>
      <Rows className="mt-s3">
        <div>
          <div className="c-kv">
            <span>You paid</span>
            <span className="c-v">{money(bond.paid, { cents: true })}</span>
          </div>
        </div>
        <div>
          <div className="c-kv">
            <span>Matures</span>
            <span className="c-v">
              {monthYear(bond.maturesOn)} &middot; {bond.monthsLeft} months left
            </span>
          </div>
        </div>
        <div>
          <div className="c-kv">
            <span>Gain at maturity</span>
            <span className="c-v">+{money(gain, { cents: true })}</span>
          </div>
        </div>
        <div>
          <div className="c-kv">
            <span>Backs your limit at {Math.round(ltv * 100)}%</span>
            <span className="c-v">{money(Math.round(bond.worthToday * ltv * 100) / 100, { cents: true })}</span>
          </div>
        </div>
        {actionable && !matured && (
          <div>
            <div className="c-kv">
              <span>At maturity</span>
              <span className="c-v">
                {bond.autoRoll === false ? 'Pays out' : 'Rolls over'}
                {' · '}
                <button
                  type="button"
                  className="underline hover:text-ink disabled:opacity-50"
                  aria-label={bond.autoRoll === false ? 'Roll it over at maturity instead' : 'Take the cash at maturity instead'}
                  disabled={busy !== null}
                  onClick={() => run(bond.autoRoll === false ? 'roll-at-maturity' : 'cash-at-maturity')}
                >
                  {busy === 'cash-at-maturity' || busy === 'roll-at-maturity' ? 'Saving…' : 'Change'}
                </button>
              </span>
            </div>
          </div>
        )}
      </Rows>
    </Modal>
  );
}

/**
 * Your bonds — the only thing on Earn that grows, so it takes the full width at the bottom.
 *
 * Header: what the lot is worth today, the one figure a holder wants. Control bar: filter left, sort
 * right, one line at every width. Rows: face value leads, maturity opposite; what was paid and how
 * long is left beneath, with worth held in the right-hand column. Footer: how many, what matures next,
 * and the way through to the rest.
 */
export default function HeldBondsCard({ data }: { data: EarnData }) {
  const desktop = useIsDesktop();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('maturity');
  const [all, setAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { bonds } = data;

  const rows = useMemo(() => {
    const filtered = bonds.filter((b) => (filter === 'all' ? true : filter === 'year' ? b.monthsLeft <= 12 : b.monthsLeft > 12));
    return [...filtered].sort((a, b) =>
      sort === 'maturity' ? a.monthsLeft - b.monthsLeft : sort === 'face' ? b.face - a.face : b.worthToday - a.worthToday,
    );
  }, [bonds, filter, sort]);

  const next = [...bonds].sort((a, b) => a.monthsLeft - b.monthsLeft)[0];
  const shown = all ? rows : rows.slice(0, SHOWN);
  const open = bonds.find((b) => b.id === openId) ?? null;

  return (
    <Cell full>
      <CHead>
        <SecHead label="Your bonds">
          <p className="c-fig c-fig-sec">
            {money(bondsWorth(bonds), { cents: true })} <span className="c-of">worth today</span>
          </p>
        </SecHead>
      </CHead>
      {bonds.length > 0 && (
        <CBar>
          <div className="c-listctl">
            <MenuButton label={FILTERS.find((f) => f.id === filter)!.label} options={FILTERS} value={filter} onChange={setFilter} />
            <MenuButton
              label={SORTS.find((s) => s.id === sort)!.label}
              icon={<SortIcon />}
              options={SORTS}
              value={sort}
              onChange={setSort}
              align="end"
            />
          </div>
        </CBar>
      )}
      <CMain>
        {bonds.length === 0 ? (
          <p className="c-det">No bonds yet — pick a term above to lock in a fixed return.</p>
        ) : shown.length === 0 ? (
          <p className="c-det">No bonds match this filter.</p>
        ) : (
          <Rows>
            {shown.map((bond) => (
              <button key={bond.id} type="button" className="block w-full text-left" onClick={() => setOpenId(bond.id)}>
                <Line>
                  <span className="c-fig text-[16px]">{money(bond.face, { cents: true })}</span>
                  <span className="c-det">{monthYear(bond.maturesOn)}</span>
                </Line>
                <Line className="mt-1">
                  <span className="c-det">
                    paid {money(bond.paid, { cents: true })} &middot; {bond.monthsLeft} {desktop ? 'months' : 'mo'} left
                  </span>
                  <span className="c-fig c-fig-row">{money(bond.worthToday, { cents: true })}</span>
                </Line>
              </button>
            ))}
          </Rows>
        )}
      </CMain>
      {bonds.length > 0 && (
        <CFoot>
          <Line className="items-center!">
            <span className="c-det">
              {bonds.length} {bonds.length === 1 ? 'bond' : 'bonds'} &middot; next matures {monthYear(next.maturesOn)}
            </span>
            {rows.length > SHOWN && (
              <button type="button" className="c-det flex items-center gap-1 hover:text-ink" onClick={() => setAll((v) => !v)}>
                {all ? 'Show fewer' : 'See all'}
                <ChevronIcon />
              </button>
            )}
          </Line>
        </CFoot>
      )}
      {open && (
        <BondDetailDialog bond={open} ltv={data.bondLtv} open={open !== null} onOpenChange={(o) => !o && setOpenId(null)} />
      )}
    </Cell>
  );
}
