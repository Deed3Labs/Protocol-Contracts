import { Plus, SendHorizontal, FileText, ArrowDownToLine, type LucideIcon } from 'lucide-react';
import ActionTile from '@/components/app-ui/ActionTile';
import { useMoneyActions } from '@/context/MoneyActionsContext';

/** Dashboard quick-actions grid — no card wrapper; the tiles are the cards. */
export default function QuickActions({ className }: { className?: string }) {
  const { openAddMoney, openWithdraw } = useMoneyActions();
  const actions: { icon: LucideIcon; label: string; hint: string; onClick?: () => void }[] = [
    { icon: Plus, label: 'Add money', hint: 'Bank or card', onClick: openAddMoney },
    { icon: SendHorizontal, label: 'Send', hint: 'To anyone' },
    { icon: FileText, label: 'Pay bill', hint: 'Rent & utilities' },
    { icon: ArrowDownToLine, label: 'Withdraw', hint: 'To linked bank', onClick: openWithdraw },
  ];
  return (
    <div className={className}>
      <h3 className="mb-3 text-xs font-medium text-muted-foreground">Quick actions</h3>
      <div className="grid grid-cols-2 gap-3">
        {actions.map(({ icon, label, hint, onClick }) => (
          <ActionTile key={label} icon={icon} label={label} hint={hint} onClick={onClick} />
        ))}
      </div>
    </div>
  );
}
