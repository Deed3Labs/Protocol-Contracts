/**
 * The store build (apps/rewards/native): Capacitor's plugins, reached through the global the native
 * shell injects, so the web app carries no native packages and the same build runs in a browser.
 * Each returns null where it isn't native.
 */

interface Plugins {
  BarcodeScanner?: {
    isSupported(): Promise<{ supported: boolean }>;
    requestPermissions(): Promise<{ camera: string }>;
    scan(o: { formats: string[] }): Promise<{ barcodes: Array<{ rawValue: string }> }>;
  };
}

const cap = () => (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Plugins } }).Capacitor;

export const isNative = () => Boolean(cap()?.isNativePlatform?.());

/** The store build has the ML Kit scanner: the web camera stands down for it. */
export const hasNativeScanner = () => isNative() && Boolean(cap()?.Plugins?.BarcodeScanner);

/** The shop a store build is for: it opens that shop at `/`, as on its own domain. */
export const NATIVE_SHOP = (import.meta.env.VITE_NATIVE_SHOP as string | undefined)?.trim() || null;

/** The native scanner (ML Kit), one code. Null where there's none, so the web camera is used. */
export async function scanNative(): Promise<string | null | undefined> {
  const s = isNative() ? cap()?.Plugins?.BarcodeScanner : undefined;
  if (!s || !(await s.isSupported().catch(() => ({ supported: false }))).supported) return undefined;
  const p = await s.requestPermissions().catch(() => ({ camera: 'denied' }));
  if (p.camera !== 'granted' && p.camera !== 'limited') return null;
  const r = await s.scan({ formats: ['QR_CODE'] }).catch(() => ({ barcodes: [] }));
  return r.barcodes[0]?.rawValue ?? null;
}
