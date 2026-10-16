import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getApprovalView } from '@/utils/apiClient';
import type { ApprovalRead } from '@/lib/approvalPage';
import ChargeApprovalRoute from './ChargeApprovalRoute';
import { ApprovalGone, ApprovalPaid, ApprovalUnreadable } from './ApprovalPage';

/**
 * `/approve/:id`: Pay with Clear's approval page (pay spec §4; DECISIONS.md, Phase 1).
 *
 * The shop's modal opens it with `window.open`, or a text links to it. It reads the payment first,
 * which needs no sign-in, so a payment that has ended says so before anyone is asked to sign in.
 * Then it is the charge approval on the payment's `chargeCode`: the same sign-in (back to this
 * address), the same Pay now and the same approve with Face ID, drawn as the online sheet.
 */
export default function ApprovalPageRoute() {
  const { id = '' } = useParams<{ id: string }>();
  const [read, setRead] = useState<ApprovalRead | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRead(null);
    void getApprovalView(id).then((r) => {
      if (!cancelled) setRead(r);
    });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (!read) return <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">Loading…</p>;
  if (read.kind === 'gone') return <ApprovalGone />;
  if (read.kind === 'paid') return <ApprovalPaid />;
  if (read.kind === 'error') return <ApprovalUnreadable onRetry={retry} />;
  return <ChargeApprovalRoute approval={read.view} />;
}
