/**
 * The shop's name, remembered on the tablet.
 *
 * The shift screen shows "Clear | Mike's Tire" before anyone is on shift, but the shop's profile
 * sits behind a session and the device endpoint carries only its address. So the name is kept from
 * the last time it was read (at enrollment, and on every shift) and the frame shows the wordmark
 * alone until then. It is a label, not a credential: nothing is decided by it.
 */
const KEY = 'clear.merchant.shop';

export function rememberedShop(): string | undefined {
  try {
    return window.localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberShop(name: string | null | undefined): void {
  if (!name) return;
  try {
    window.localStorage.setItem(KEY, name);
  } catch {
    // Private windows throw; the frame falls back to the wordmark.
  }
}
