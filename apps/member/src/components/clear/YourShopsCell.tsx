import { useEffect } from 'react';
import { CFoot, CHead, CMain, Cell, Rows, SecHead } from './brand/anatomy';
import { ChevronIcon } from './brand/icons';
import { shopUrl, tileFamily, yourShopLine } from '@/lib/yourShops';
import type { YourShop } from '@/utils/apiClient';

const FONTS = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&family=Archivo:wght@600&family=Nunito:wght@800&display=swap';

/**
 * Your shops (rewards spec, section 6): every shop whose rewards the member has joined, with their
 * points and anything ready. A list and links only: each row opens that shop in the rewards hub,
 * signed in. Rewards screens live once, in apps/rewards. Each tile wears its shop's colour and type;
 * the Ready chip is Clear's.
 */
export default function YourShopsCell({ shops }: { shops: YourShop[] }) {
  useEffect(() => {
    if (document.getElementById('c-shop-fonts')) return;
    const link = document.createElement('link');
    link.id = 'c-shop-fonts';
    link.rel = 'stylesheet';
    link.href = FONTS;
    document.head.append(link);
  }, []);
  return (
    <Cell full>
      <CHead>
        <SecHead label="Your shops">
          <span className="c-det">{shops.length}</span>
        </SecHead>
      </CHead>
      <CMain>
        <Rows>
          {shops.map((s) => (
            <a key={s.slug} href={shopUrl(s.slug)} className="c-line w-full items-center! text-left" aria-label={`${s.name}, ${yourShopLine(s)}${s.readyCount ? ', ready' : ''}`}>
              <span className="flex min-w-0 items-center gap-[12px]">
                {s.brand.logoUrl ? (
                  <img src={s.brand.logoUrl} alt="" width={30} height={30} className="shrink-0" style={{ width: 30, height: 30, objectFit: 'cover' }} />
                ) : (
                  <span
                    aria-hidden
                    className="flex shrink-0 items-center justify-center"
                    style={{ width: 30, height: 30, background: s.brand.colour, color: s.brand.onColour, fontFamily: tileFamily(s), fontWeight: 700, fontSize: 12, letterSpacing: '.02em' }}
                  >
                    {s.brand.monogram}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sec font-semibold">{s.name}</span>
                  <span className="c-det mt-[2px] block">{yourShopLine(s)}</span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-[10px] text-ink-50">
                {s.readyCount > 0 && (
                  <span className="c-chip" style={{ background: 'var(--ink)', color: 'var(--paper)', borderColor: 'transparent' }}>
                    Ready
                  </span>
                )}
                <ChevronIcon size={14} strokeWidth={2} className="shrink-0" />
              </span>
            </a>
          ))}
        </Rows>
      </CMain>
      <CFoot>
        <p className="c-det">Opens in the rewards app, signed in</p>
      </CFoot>
    </Cell>
  );
}
