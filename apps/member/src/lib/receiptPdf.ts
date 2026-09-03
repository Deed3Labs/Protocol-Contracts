/*
 * Client-side receipt PDF for the bill/transaction detail view. jsPDF is lazy-imported so it only loads
 * when a user actually downloads a receipt (keeps it out of the main bundle).
 */
export interface ReceiptPdfData {
  title: string;
  subtitle?: string;
  dateTime?: string | null;
  reference?: string | null;
  account?: string | null;
  lines: { label: string; value: string }[];
  total?: { label: string; value: string };
}

export async function downloadReceiptPdf(data: ReceiptPdfData): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const L = 48;
  const R = W - 48;
  let y = 64;

  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(17);
  doc.text('Clear', L, y);
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(130);
  doc.text('Receipt', R, y, { align: 'right' });

  y += 24;
  doc.setDrawColor(228).line(L, y, R, y);
  y += 30;

  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(20);
  doc.text(data.title, L, y);
  if (data.subtitle) {
    y += 16;
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(130).text(data.subtitle, L, y);
  }
  y += 34;

  const meta = ([['Date', data.dateTime], ['Reference', data.reference], ['Account', data.account]] as [string, string | null | undefined][])
    .filter((m): m is [string, string] => Boolean(m[1]));
  doc.setFontSize(10);
  for (const [k, v] of meta) {
    doc.setFont('helvetica', 'normal').setTextColor(130).text(k, L, y);
    doc.setTextColor(30).text(v, R, y, { align: 'right' });
    y += 18;
  }

  y += 10;
  doc.setDrawColor(236).line(L, y, R, y);
  y += 26;

  doc.setFontSize(11);
  for (const l of data.lines) {
    doc.setFont('helvetica', 'normal').setTextColor(130).text(l.label, L, y);
    doc.setTextColor(30).text(l.value, R, y, { align: 'right' });
    y += 20;
  }

  if (data.total) {
    y += 4;
    doc.setDrawColor(236).line(L, y - 14, R, y - 14);
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(17);
    doc.text(data.total.label, L, y + 4);
    doc.text(data.total.value, R, y + 4, { align: 'right' });
    y += 30;
  }

  y += 26;
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(155);
  doc.text('Paid via Clear · useclear.org', L, y);

  const slug = data.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'clear';
  doc.save(`receipt-${slug}.pdf`);
}
