// Makes the Ed25519 key pair for shop sign-in on useclear.org (services/merchant/connect).
//   node scripts/generate-shop-connect-key.mjs
// The private key goes in this API's environment as SHOP_CONNECT_PRIVATE_KEY (Railway). The public
// key goes in the site's environment as CLEAR_API_PUBLIC_KEY (Vercel), and is also served at
// GET /api/public/shop-connect/key once the private key is set. Both are printed with \n escapes,
// one line each, the way Railway and Vercel store them.
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const oneLine = (pem) => pem.trim().replace(/\n/g, '\\n');
console.log('\nAPI (Railway) SHOP_CONNECT_PRIVATE_KEY=\n' + oneLine(privateKey.export({ type: 'pkcs8', format: 'pem' })));
console.log('\nSite (Vercel) CLEAR_API_PUBLIC_KEY=\n' + oneLine(publicKey.export({ type: 'spki', format: 'pem' })) + '\n');
