import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { fromBase64 } from '../ble/bytes';

/**
 * Where a drawer's key lives on the tablet: fetched from the server while online
 * (`GET /api/merchant/drawers/:id/key`) and kept for this tablet's enrollment, so the drawer opens
 * with no connection. In the app it's the Keychain or the Android Keystore (secure storage); in a
 * browser it's a non-extractable key in IndexedDB, which page script can use and never read.
 *
 * Names carry the enrollment, so a tablet enrolled again, or for another shop, never uses a key from
 * before; `forgetDrawerKeys` empties it when the tablet is signed out or removed.
 */

export interface DrawerKeyVault {
  get(enrollment: string, drawerId: string): Promise<CryptoKey | null>;
  put(enrollment: string, drawerId: string, keyBase64: string): Promise<void>;
  forget(): Promise<void>;
}

const name = (enrollment: string, drawerId: string) => `drawer-key.${enrollment}.${drawerId}`;
const importHmac = (raw: Uint8Array) => crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

/** The installed app: secure storage holds the key; it's imported for each open and never leaves. */
export function secureStorageVault(): DrawerKeyVault {
  return {
    get: async (e, d) => {
      const v = await SecureStorage.getItem(name(e, d)).catch(() => null);
      return v ? importHmac(fromBase64(v)) : null;
    },
    put: async (e, d, k) => {
      // Only this tablet's current enrollment keeps keys.
      for (const key of await SecureStorage.keys().catch(() => [] as string[])) if (key.startsWith('drawer-key.') && !key.startsWith(`drawer-key.${e}.`)) await SecureStorage.removeItem(key);
      await SecureStorage.setItem(name(e, d), k);
    },
    forget: async () => {
      for (const key of await SecureStorage.keys().catch(() => [] as string[])) if (key.startsWith('drawer-key.')) await SecureStorage.removeItem(key);
    },
  };
}

const DB = 'clear-drawer-keys';
function idb<T>(fn: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode = 'readonly'): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('keys');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('keys', mode);
      const req = fn(tx.objectStore('keys'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => open.result.close();
    };
  });
}

/** A browser: the key is imported non-extractable and stored as a CryptoKey. */
export function indexedDbVault(): DrawerKeyVault {
  return {
    get: async (e, d) => (await idb<CryptoKey | undefined>((s) => s.get(name(e, d)) as IDBRequest<CryptoKey | undefined>).catch(() => undefined)) ?? null,
    put: async (e, d, k) => {
      for (const n of await idb((s) => s.getAllKeys(), 'readonly').catch(() => [] as IDBValidKey[])) if (!String(n).startsWith(`drawer-key.${e}.`)) await idb((s) => s.delete(n), 'readwrite');
      const key = await importHmac(fromBase64(k));
      await idb((s) => s.put(key, name(e, d)), 'readwrite');
    },
    forget: async () => void (await idb((s) => s.clear(), 'readwrite').catch(() => undefined)),
  };
}

/** Tests and the preview. */
export function memoryVault(): DrawerKeyVault & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    get: async (e, d) => (raw.has(name(e, d)) ? importHmac(fromBase64(raw.get(name(e, d))!)) : null),
    put: async (e, d, k) => {
      for (const n of [...raw.keys()]) if (!n.startsWith(`drawer-key.${e}.`)) raw.delete(n);
      raw.set(name(e, d), k);
    },
    forget: async () => raw.clear(),
  };
}
