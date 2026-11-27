/**
 * Who this device signed in as last.
 *
 * Coming back is a different screen from arriving, and the difference is that we know who you are:
 * the returning screen can say your name and offer the device itself instead of a code. That only
 * works if something remembers, and there is no password and no username field to remind us.
 *
 * Name, handle and the contact a code would go to — nothing else, and nothing secret: this only
 * decides which screen to draw, and signing in still happens against Privy.
 */
const KEY = 'clear:last-member';

export interface RememberedMember {
  name: string;
  handle: string;
  /** The phone or email a code went to last time, so the fallback does not ask again. */
  contact: string;
}

export function rememberMember(member: RememberedMember): void {
  try {
    if (!member.name) return;
    localStorage.setItem(KEY, JSON.stringify(member));
  } catch {
    // A device that will not keep this simply gets the arriving screen, which still works.
  }
}

export function rememberedMember(): RememberedMember | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedMember>;
    if (!parsed?.name) return null;
    return { name: parsed.name, handle: parsed.handle ?? '', contact: parsed.contact ?? '' };
  } catch {
    return null;
  }
}

export function forgetMember(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget if the store is not there.
  }
}
