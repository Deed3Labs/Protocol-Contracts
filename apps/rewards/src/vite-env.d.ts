/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_PRIVY_APP_ID?: string;
  /** A store build's one shop (apps/rewards/native). */
  readonly VITE_NATIVE_SHOP?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_CLEAR_NETWORK?: 'mainnet' | 'testnet';
  readonly VITE_CLEAR_APP_URL?: string;
  readonly VITE_APPLE_SIGN_IN?: 'on' | 'off';
}
