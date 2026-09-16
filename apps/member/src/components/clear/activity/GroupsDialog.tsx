import { useEffect, useState } from 'react';
import Modal from '../Modal';
import { Btn, Line, Rows } from '../brand/anatomy';
import Switch from '../brand/Switch';
import { RowChevron } from '@/components/settings/SettingsKit';
import { TickIcon } from '../brand/icons';
import { money } from '@clear/domain';
import { REST, groupOfMerchant } from '@/lib/activityCycle';
import type { MerchantSpend } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Change groups — two sheets, because the useful control is per merchant, not per group. Nobody
 * wants to rename Groceries; they want Costco out of Everything else.
 *
 * The first lists the groups with what is in them; opening one lists its merchants and what they
 * took; choosing a merchant is where the move happens. A move is a rule and it applies to payments
 * already made, because otherwise the figures that sent the member here stay wrong — both sheets
 * say so. Naming a new group happens inline: a modal on top of a modal to collect one word is not
 * worth the stack.
 */
export default function GroupsDialog({
  merchants,
  moved,
  grouping,
  open,
  onOpenChange,
  onGrouping,
  onMove,
}: {
  merchants: MerchantSpend[];
  /** Merchant name to the group the member put it in. */
  moved: Record<string, string>;
  grouping: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGrouping: (on: boolean) => void;
  onMove: (merchant: string, group: string) => void;
}) {
  /** null is the group list; a string is that group's merchants; a merchant is the move itself. */
  const [group, setGroup] = useState<string | null>(null);
  const [merchant, setMerchant] = useState<MerchantSpend | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  /** Non-null while New group is the choice: the name being typed. */
  const [newGroup, setNewGroup] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setGroup(null);
    setMerchant(null);
    setNewGroup(null);
  }, [open]);

  const groupOf = (m: MerchantSpend) => groupOfMerchant(m, moved);
  const groups = [...new Set([...merchants.map(groupOf), REST])];
  const totals = groups.map((label) => {
    const inGroup = merchants.filter((m) => groupOf(m) === label);
    return { label, merchants: inGroup.length, amount: inGroup.reduce((sum, m) => sum + m.amount, 0) };
  });

  if (merchant) {
    const typed = newGroup?.trim() ?? '';
    const current = newGroup !== null ? typed : (picked ?? groupOf(merchant));
    const canMove = current !== '' && current !== groupOf(merchant);
    return (
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="Change group"
        description={`Choose the group ${merchant.name} belongs in.`}
        onBack={() => {
          setMerchant(null);
          setPicked(null);
        }}
        footer={
          <>
            <div className="c-footnote mt-0! border-t-0! pt-0!">
              <p>
                Applies to every {merchant.name} payment, past and future. You can move it back any time.
              </p>
            </div>
            <Btn
              primary
              lg
              className="mt-s2"
              disabled={!canMove}
              onClick={() => {
                onMove(merchant.name, current);
                setMerchant(null);
                setPicked(null);
              }}
            >
              {newGroup !== null ? `Create ${typed || 'a group'} and move` : `Move to ${current}`}
            </Btn>
          </>
        }
      >
        <Line className="items-center!">
          <div className="min-w-0">
            <p className="text-body font-semibold">{merchant.name}</p>
            <p className="c-det mt-[3px]">
              {merchant.payments} {merchant.payments === 1 ? 'payment' : 'payments'} this cycle
            </p>
          </div>
          <p className="c-fig c-fig-sec">{money(merchant.amount, { cents: true })}</p>
        </Line>
        <Rows className="mt-s3">
          {groups.map((label) => (
            <div key={label}>
              <button
                type="button"
                onClick={() => {
                  setPicked(label);
                  setNewGroup(null);
                }}
                className="c-line w-full items-center! text-left"
              >
                <span className="flex items-center gap-[12px]">
                  <span className={cn('c-pick', newGroup === null && current === label && 'c-on')}>
                    {newGroup === null && current === label && <TickIcon size={12} className="text-paper" />}
                  </span>
                  <span className="text-sec">{label}</span>
                </span>
              </button>
            </div>
          ))}
          <div>
            {/* A group that does not exist yet: the row names it, and the field is where it gets one. */}
            <button type="button" onClick={() => setNewGroup(newGroup === null ? '' : null)} className="c-line w-full items-center! text-left">
              <span className="flex items-center gap-[12px]">
                <span className={cn('c-pick', newGroup !== null && 'c-on')}>
                  {newGroup !== null && <TickIcon size={12} className="text-paper" />}
                </span>
                <span className="text-sec text-ink-50">New group</span>
              </span>
            </button>
            {newGroup !== null && (
              <input
                autoFocus
                className="c-field mt-s2 w-full"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                placeholder="Name it"
                aria-label="New group name"
              />
            )}
          </div>
        </Rows>
      </Modal>
    );
  }

  if (group) {
    const inGroup = merchants.filter((m) => groupOf(m) === group);
    const total = inGroup.reduce((sum, m) => sum + m.amount, 0);
    return (
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title={group}
        description={`The merchants in ${group}.`}
        onBack={() => setGroup(null)}
        footer={
          <Line className="items-center!">
            {/* What governs the whole sheet: the groups are Clear's, and a merchant is how you change one. */}
            <span className="c-det">Set by Clear &middot; move a merchant to change what is in it</span>
            <button type="button" className="c-det hover:text-ink" onClick={() => setGroup(null)}>
              Done
            </button>
          </Line>
        }
      >
        <Line className="mb-s2 items-baseline!">
          <span className="c-sub">This cycle</span>
          <span className="c-fig c-fig-sec">{money(total, { cents: true })}</span>
        </Line>
        {inGroup.length === 0 ? (
          <p className="c-det">Nothing in this group yet.</p>
        ) : (
          <Rows>
            {inGroup.map((m) => (
              <div key={m.name}>
                <button type="button" onClick={() => setMerchant(m)} className="c-line w-full items-center! text-left">
                  <div className="min-w-0">
                    <p className="text-sec">{m.name}</p>
                    <p className="c-det mt-[3px]">
                      {m.payments} {m.payments === 1 ? 'payment' : 'payments'}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-s1">
                    <span className="c-fig c-fig-row">{money(m.amount, { cents: true })}</span>
                    <RowChevron />
                  </span>
                </button>
              </div>
            ))}
          </Rows>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Groups"
      description="How your spending is grouped, and which merchant sits where."
      sections={[
        <Line className="items-center!">
          <div className="min-w-0">
            <label htmlFor="grouping" className="text-sec">
              Group automatically
            </label>
            <p className="c-det mt-[3px]">Turn this off to see one flat list</p>
          </div>
          <Switch id="grouping" checked={grouping} onCheckedChange={onGrouping} />
        </Line>,
        <Rows>
          {totals.map((row) => (
            <div key={row.label}>
              <button type="button" onClick={() => setGroup(row.label)} className="c-line w-full items-center! text-left">
                <div className="min-w-0">
                  <p className="text-sec">{row.label}</p>
                  <p className="c-det mt-[3px]">
                    {row.merchants} {row.merchants === 1 ? 'merchant' : 'merchants'}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-s1">
                  <span className="c-fig c-fig-row">{money(row.amount, { cents: true })}</span>
                  <RowChevron />
                </span>
              </button>
            </div>
          ))}
        </Rows>,
      ]}
      footer={
        <>
          <div className="c-footnote mt-0! border-t-0! pt-0!">
            <p>Moving a merchant sets a rule for it. It applies to payments you have already made, so the totals stay right.</p>
          </div>
          <Btn lg className="mt-s2" onClick={() => onOpenChange(false)}>
            Done
          </Btn>
        </>
      }
    />
  );
}
