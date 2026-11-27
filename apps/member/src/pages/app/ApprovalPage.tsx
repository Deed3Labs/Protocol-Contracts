import type { ReactNode } from 'react';
import { Btn } from '@/components/clear/brand/anatomy';
import { noAccountLine } from '@/lib/approvalPage';

/**
 * The approval page's states that aren't the approve sheet (none of them is drawn): built from the
 * charge screen's own "Nothing to approve", so they read as the same app.
 */
export function ApprovalNotice({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="c-text min-h-screen bg-paper">
      <div className="w-full px-5 py-8 text-center lg:mx-auto lg:max-w-[420px]">
        <p className="mb-1.5 text-[19px] font-medium">{title}</p>
        <p className="text-[13px] leading-relaxed text-foreground-secondary">{children}</p>
        {action && <div className="mt-s3">{action}</div>}
      </div>
    </div>
  );
}

/** Signed in, and no Clear account behind it: the shop's page takes the code, or a card. */
export function NoClearAccount({ shopName, host }: { shopName: string; host: string | null }) {
  return <ApprovalNotice title="No Clear account yet">{noAccountLine(host, shopName)}</ApprovalNotice>;
}

/** `GET /api/checkout/approval/:id` answered 404: no such payment, or it has ended. */
export function ApprovalGone() {
  return <ApprovalNotice title="Nothing to approve">This payment has ended, or the link isn’t right. Start again from the shop’s page.</ApprovalNotice>;
}

/** 409: paid already, here or another way. */
export function ApprovalPaid() {
  return <ApprovalNotice title="Already paid">This payment has gone through. There’s nothing more to approve.</ApprovalNotice>;
}

/** The network, or the API having a bad moment. */
export function ApprovalUnreadable({ onRetry }: { onRetry: () => void }) {
  return (
    <ApprovalNotice
      title="We couldn’t open this payment"
      action={
        <Btn lg className="w-full" onClick={onRetry}>
          Try again
        </Btn>
      }
    >
      Check your connection. Nothing has been charged.
    </ApprovalNotice>
  );
}
