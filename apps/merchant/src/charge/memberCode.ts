/**
 * Reading a member's own Clear code (the member app's Code page).
 *
 * Their code carries who they are and no amount: a link to send to them, `…/send?to=0x…`, with
 * their wallet. So a scanned code gives a wallet, and the charge is sent to it. A code that isn't a
 * member's (a charge code, a menu, a wifi code) gives null rather than a guess.
 */
const WALLET = /^0x[0-9a-fA-F]{40}$/;

export function memberWalletFrom(payload: string): string | null {
  const text = payload.trim();
  if (!text) return null;
  if (WALLET.test(text)) return text.toLowerCase();
  const eth = /^ethereum:(0x[0-9a-fA-F]{40})/i.exec(text);
  if (eth) return eth[1]!.toLowerCase();
  try {
    const url = new URL(text);
    const to = url.searchParams.get('to');
    if (url.pathname.replace(/\/+$/, '') === '/send' && to && WALLET.test(to)) return to.toLowerCase();
  } catch {
    // Not a URL: nothing else a member's code could be.
  }
  return null;
}
