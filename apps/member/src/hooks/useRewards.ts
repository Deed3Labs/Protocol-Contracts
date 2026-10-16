import { useEffect } from 'react';
import { getShopPurchases, getYourShops, type ShopPurchase, type YourShop } from '@/utils/apiClient';
import { onChainStale } from '@/lib/chainStale';
import { useRemembered, walletKey } from '@/lib/rememberedState';

/**
 * Card purchases at Clear shops, for Activity: what the member bought as a rewards-only customer
 * shows once they've set up Clear (rewards spec, Phase 6). Read again after any move, like the rest.
 */
export function useShopPurchases(address: string | undefined): ShopPurchase[] {
  const [purchases, setPurchases] = useRemembered<ShopPurchase[]>(`shoppurchases:${walletKey(address)}`, []);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const read = () => {
      void getShopPurchases().then((list) => {
        if (!cancelled) setPurchases(list);
      });
    };
    read();
    const stop = onChainStale(read);
    return () => {
      cancelled = true;
      stop();
    };
  }, [address]);
  return purchases;
}

/**
 * Your shops (rewards spec, section 6): every shop whose rewards they've joined. Empty until it's
 * read, and when it can't be: the list is only ever shown with shops in it.
 */
export function useYourShops(address: string | undefined): YourShop[] {
  const [shops, setShops] = useRemembered<YourShop[]>(`yourshops:${walletKey(address)}`, []);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    void getYourShops().then((list) => {
      if (!cancelled && list) setShops(list);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);
  return shops;
}
