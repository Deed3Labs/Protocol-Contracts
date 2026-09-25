import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The installed app: the same web build (`dist`), wrapped for iOS and Android.
 *
 * The web app at merchant.useclear.org is unchanged by this file. In the installed app the
 * pages load from the bundle, so the API is reached at VITE_API_BASE_URL, set at build time,
 * and the API must allow the app's origins (capacitor://localhost on iOS, https://localhost on
 * Android).
 */
const config: CapacitorConfig = {
  appId: 'org.useclear.merchant',
  appName: 'Clear for Merchants',
  webDir: 'dist',
  android: {
    // Card readers want a steady screen: the counter tablet is plugged in and always on.
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
  },
};

export default config;
