/** Email from the Command Center, through the API's Resend (RESEND_API_KEY, RESEND_FROM). */
export async function sendMail(m: { to: string; subject: string; text: string }): Promise<void> {
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) throw new Error('Email isn’t set up on this server (RESEND_API_KEY), so the invite can’t be sent');
  const from = (process.env.RESEND_FROM || 'Clear <receipts@useclear.org>').trim();
  const r = await fetch((process.env.RESEND_API_BASE_URL || 'https://api.resend.com').replace(/\/+$/, '') + '/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`Resend refused the email (${r.status})`);
}
