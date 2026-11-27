import { createContext, useContext } from 'react';
import { useLocation, useParams } from 'react-router-dom';

/**
 * The address decides the scope (rewards spec, "Two front doors"). A shop's link, `/s/:slug` (on
 * useclear.org, through the apex's rewrite, or a shop's own domain) is only ever that shop. Anything
 * else is the hub, rewards.useclear.org: every shop the person has joined, and a shop inside it at
 * `/shops/:slug`.
 */
export interface Scope {
  mode: 'shop' | 'hub';
  /** The shop being looked at, if any. */
  slug: string | null;
  /** Where this shop's screens live: `/s/micasa` or `/shops/micasa`. */
  base: string;
}

export function scopeOf(pathname: string): Scope {
  const shop = /^\/s\/([a-z0-9-]+)/.exec(pathname);
  if (shop) return { mode: 'shop', slug: shop[1]!, base: `/s/${shop[1]}` };
  const inHub = /^\/shops\/([a-z0-9-]+)/.exec(pathname);
  if (inHub) return { mode: 'hub', slug: inHub[1]!, base: `/shops/${inHub[1]}` };
  return { mode: 'hub', slug: null, base: '' };
}

/** On a shop's own domain (Phase 7): that shop, at `/`. Null on Clear's hosts. */
export const HostShop = createContext<string | null>(null);

export function useScope(): Scope {
  const { pathname } = useLocation();
  useParams();
  const host = useContext(HostShop);
  return host ? { mode: 'shop', slug: host, base: '' } : scopeOf(pathname);
}
