import Modal from '@/components/clear/Modal';
import { Btn, Line, Rows } from '@/components/clear/brand/anatomy';
import { KvRow, RowBtn } from './SettingsKit';

/**
 * Advanced — an action surface, so a modal rather than a pane. The downloads live in main and the
 * one destructive action is the footer.
 */
export default function AdvancedDialog({
  walletAddress,
  permissionsOn,
  open,
  onOpenChange,
  onPermissions,
  onClose,
}: {
  walletAddress: string;
  permissionsOn: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPermissions?: () => void;
  onClose?: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Advanced"
      description="Your wallet address, exports and permissions."
      footer={
        <Btn lg onClick={onClose}>
          Close account and withdraw
        </Btn>
      }
    >
      <Line className="items-center!">
        <div className="min-w-0">
          <p className="c-label">Wallet address</p>
          <p className="c-mono mt-[4px] truncate">{walletAddress}</p>
        </div>
        <RowBtn onClick={() => navigator.clipboard?.writeText(walletAddress).catch(() => {})}>Copy</RowBtn>
      </Line>
      <p className="c-det mt-s1">
        Your account is a smart wallet. You do not need this for anything in the app. It is here if you want it.
      </p>
      <Rows className="mt-s2 border-t border-ink-13 pt-s2">
        <div>
          <KvRow label="Export account data" value={<RowBtn>Download</RowBtn>} />
        </div>
        <div>
          <KvRow label="Transaction history (CSV)" value={<RowBtn>Download</RowBtn>} />
        </div>
        <div>
          <KvRow label="Permissions" value={`${permissionsOn} on`} onSelect={onPermissions} />
        </div>
      </Rows>
    </Modal>
  );
}
