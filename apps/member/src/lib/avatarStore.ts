/*
 * Local per-wallet avatar storage. The backend avatar_url field is capped at 2048 chars, so a
 * real photo (a ~20–50KB data URL) gets truncated → broken image. Until there's proper image
 * storage (S3/Cloudinary or a Postgres blob endpoint), we keep the uploaded photo in localStorage
 * so it renders across the app + survives refresh on this device.
 */
const KEY = (address: string) => `clear_avatar_${address.toLowerCase()}`;

export function getStoredAvatar(address: string): string | null {
  if (!address || typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(KEY(address));
  } catch {
    return null;
  }
}

export function setStoredAvatar(address: string, dataUrl: string | null): void {
  if (!address || typeof localStorage === 'undefined') return;
  try {
    if (dataUrl) localStorage.setItem(KEY(address), dataUrl);
    else localStorage.removeItem(KEY(address));
  } catch {
    /* quota / disabled storage — ignore */
  }
}
