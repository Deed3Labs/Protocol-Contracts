import { readFileSync } from 'node:fs';
import type { CapacitorConfig } from '@capacitor/cli';

/**
 * One shop's store app (docs/rewards-reference/store-builds.md). `npm run config` writes shop.json
 * from the shop's public config; this reads it, so the name, the bundle id and the colours are the
 * shop's. The web content is the rewards app built for that shop alone (`npm run build:web`), shipped
 * inside the app: nothing loads from another origin, because review sees what ships.
 */
const shop = JSON.parse(readFileSync(new URL('./shop.json', import.meta.url), 'utf8')) as {
  slug: string;
  name: string;
  bundleId: string;
  colour: string;
  paper: string;
};

const config: CapacitorConfig = {
  appId: shop.bundleId,
  appName: shop.name,
  webDir: 'www',
  // https on Android, so the web app's origin is secure (the camera and Privy need it).
  server: { androidScheme: 'https' },
  backgroundColor: shop.paper,
  ios: { contentInset: 'never' },
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
