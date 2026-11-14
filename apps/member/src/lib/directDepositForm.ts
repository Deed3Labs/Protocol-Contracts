import { MISSING, bankDisclosure } from './accountDetails';

/*
 * "Get direct deposit form": a one-page PDF with the member's details filled in, for an employer's
 * payroll team.
 *
 * Built in the browser from the numbers already on screen and the full account number held in the
 * surface's memory after Face ID. jsPDF is lazy-imported, as for receipts (lib/receiptPdf), so it
 * loads only when somebody asks. The file goes to the member's own download and nowhere else: no
 * upload, no cache, nothing kept.
 */

export interface DirectDepositFormData {
  holderName: string | null;
  bankName: string | null;
  routingNumber: string;
  /** The full number. The form is useless with a masked one. */
  accountNumber: string;
  accountType: string;
}

export const DIRECT_DEPOSIT_FILENAME = 'clear-direct-deposit-form.pdf';

/** The filled-in rows, in the order the surface shows them. */
export function directDepositRows(data: DirectDepositFormData): { label: string; value: string }[] {
  return [
    { label: 'Account holder', value: data.holderName || MISSING },
    { label: 'Bank', value: data.bankName || MISSING },
    { label: 'Routing number', value: data.routingNumber },
    { label: 'Account number', value: data.accountNumber },
    { label: 'Account type', value: data.accountType },
  ];
}

export async function downloadDirectDepositForm(data: DirectDepositFormData): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const L = 56;
  const R = W - 56;
  let y = 72;

  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(17);
  doc.text('Clear', L, y);
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(130);
  doc.text('Direct deposit form', R, y, { align: 'right' });

  y += 24;
  doc.setDrawColor(228).line(L, y, R, y);
  y += 34;

  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(60);
  const intro = doc.splitTextToSize(
    'Please deposit my pay into the account below. These details are for direct deposit (ACH credit) only.',
    R - L,
  );
  doc.text(intro, L, y);
  y += intro.length * 15 + 18;

  doc.setFontSize(11);
  for (const row of directDepositRows(data)) {
    doc.setFont('helvetica', 'normal').setTextColor(130).text(row.label, L, y);
    doc.setTextColor(20).text(row.value, R, y, { align: 'right' });
    y += 22;
  }

  y += 30;
  doc.setDrawColor(200);
  doc.line(L, y, L + 260, y);
  doc.line(R - 140, y, R, y);
  y += 14;
  doc.setFontSize(9).setTextColor(130);
  doc.text('Signature', L, y);
  doc.text('Date', R - 140, y);

  y += 44;
  doc.setFontSize(9).setTextColor(155);
  doc.text(doc.splitTextToSize(bankDisclosure(), R - L), L, y);

  doc.save(DIRECT_DEPOSIT_FILENAME);
}
