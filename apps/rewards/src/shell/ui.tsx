import { createContext, useContext, useEffect, type CSSProperties, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import type { PublicShopApp } from '@clear/merchant-contracts';
import { Back, Caret, ClearMark, GiftIcon, HomeIcon, PersonIcon, ScanIcon } from '../icons';
import { brandStyle, CLEAR_LOOK, loadShopFonts } from '../lib/brand';
import { useRead } from '../data/context';
import { HostShop, useScope } from './scope';
import { PREVIEW } from '../lib/env';
import { forwardUrl, isClearHost } from '../lib/hosts';
import { setHead } from './headTags';

/**
 * The parts every screen is built from, as the spec draws them (`sa-*`): the screen in a shop's
 * colours or Clear's, its top bar, and its bottom bar.
 */

export function Screen({ look, children, className }: { look: CSSProperties; children: ReactNode; className?: string }) {
  return (
    <div className={`sa-ph${className ? ` ${className}` : ''}`} style={look}>
      {children}
    </div>
  );
}

// ---- The shop being looked at -------------------------------------------------------------------

const ShopContext = createContext<PublicShopApp | null>(null);
export const useShop = () => useContext(ShopContext);

/** Loads the shop's config, dresses the page in it, and names the page and its icon after it. */
export function ShopScope({ slug, children }: { slug: string; children: (shop: PublicShopApp) => ReactNode }) {
  const { data, error } = useRead((d) => d.shop(slug), [slug]);
  const { mode } = useScope();
  const host = useContext(HostShop);
  useEffect(() => {
    if (!data) return;
    // A verified own domain: the shop's useclear.org link forwards there (Phase 7). Never in the hub.
    if (mode === 'shop' && !host && data.domain && !PREVIEW && isClearHost(window.location.hostname)) {
      window.location.replace(forwardUrl(data.domain, data.slug, window.location.pathname, window.location.search));
      return;
    }
    loadShopFonts(data.fonts);
    // A shop's own link installs as its own app; inside the hub the page stays the hub's.
    if (mode === 'shop') setHead({ title: data.name, manifest: `/s/${data.slug}/manifest.webmanifest`, themeColor: data.brand.colour, icon: data.brand.logoUrl });
  }, [data, mode]);
  if (error) return <Missing message={error} />;
  if (!data) return <Screen look={CLEAR_LOOK}>{null}</Screen>;
  return <ShopContext.Provider value={data}>{children(data)}</ShopContext.Provider>;
}

export const shopLook = (shop: PublicShopApp): CSSProperties => brandStyle(shop.brand, shop.fonts);

export function Missing({ message }: { message: string }) {
  return (
    <Screen look={CLEAR_LOOK}>
      <HubTop />
      <div className="sa-body">
        <div className="sa-m">
          <p className="sa-big2" style={{ textAlign: 'left', fontFamily: 'var(--font-display)' }}>
            Not here
          </p>
          <p className="det">{message}</p>
        </div>
      </div>
    </Screen>
  );
}

// ---- Top bars -----------------------------------------------------------------------------------

export function Logo({ shop, big, style }: { shop: Pick<PublicShopApp, 'brand'>; big?: boolean; style?: CSSProperties }) {
  return shop.brand.logoUrl ? (
    <img className={`sa-logo${big ? ' big' : ''}`} src={shop.brand.logoUrl} alt="" style={style} />
  ) : (
    <span className={`sa-logo${big ? ' big' : ''}`} style={style}>
      {shop.brand.monogram}
    </span>
  );
}

function Avatar({ initials }: { initials?: string | null }) {
  const { base, mode } = useScope();
  if (!initials) return null;
  return (
    <Link className="sa-av" to={mode === 'hub' && !base ? '/you' : `${base}/you`} aria-label="You">
      {initials}
    </Link>
  );
}

/** A shop's app: its logo and name. */
export function ShopTop({ shop, initials }: { shop: PublicShopApp; initials?: string | null }) {
  return (
    <div className="sa-top">
      <span className="sa-brand">
        <Logo shop={shop} />
        <span className="sa-name">{shop.name}</span>
      </span>
      <Avatar initials={initials} />
    </div>
  );
}

/** Inside the hub, the shop's name is the switcher; there's no back arrow. */
export function SwitcherTop({ shop, initials, onSwitch }: { shop: PublicShopApp; initials?: string | null; onSwitch: () => void }) {
  return (
    <div className="sa-top">
      <button className="sa-switch" aria-label="Switch shop" onClick={onSwitch}>
        <Logo shop={shop} />
        <span className="sa-name">{shop.name}</span>
        <span className="sa-caret">
          <Caret />
        </span>
      </button>
      <Avatar initials={initials} />
    </div>
  );
}

/** A screen in a flow: back, and its title ("Table 6"). Or just a title ("Paid"). */
export function TitleTop({ title, back, initials }: { title: string; back?: boolean | string; initials?: string | null }) {
  const navigate = useNavigate();
  return (
    <div className="sa-top">
      <span className="sa-brand">
        {back ? (
          <button className="sa-switch" aria-label="Back" onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}>
            <Back />
          </button>
        ) : null}
        <span className="sa-title">{title}</span>
      </span>
      <Avatar initials={initials} />
    </div>
  );
}

/** The hub at its top level, in Clear's look. */
export function HubTop({ initials }: { initials?: string | null }) {
  return (
    <div className="sa-top">
      <span className="mc-who">
        <span className="lockup">
          <ClearMark />
          <span className="wm">Clear</span>
        </span>
        <span className="mc-for">Rewards app</span>
      </span>
      <Avatar initials={initials} />
    </div>
  );
}

// ---- Bottom bars --------------------------------------------------------------------------------

const cls = ({ isActive }: { isActive: boolean }) => (isActive ? 'on' : '');

/** A shop's app: Home, Rewards, Pay, You. */
export function ShopNav() {
  const { base } = useScope();
  return (
    <nav className="sa-nav">
      <NavLink to={base} end className={cls}>
        <HomeIcon />
        <b>Home</b>
      </NavLink>
      <NavLink to={`${base}/rewards`} className={cls}>
        <GiftIcon />
        <b>Rewards</b>
      </NavLink>
      <NavLink to={`${base}/pay`} className={cls}>
        <ScanIcon />
        <b>Pay</b>
      </NavLink>
      <NavLink to={`${base}/you`} className={cls}>
        <PersonIcon />
        <b>You</b>
      </NavLink>
    </nav>
  );
}

/** The hub: Shops, Scan, You. Inside a shop, Shops is lit and goes back to all of them. */
export function HubNav({ inShop }: { inShop?: boolean }) {
  return (
    <nav className="sa-nav hub">
      <NavLink to="/" end={!inShop} className={({ isActive }) => (isActive || inShop ? 'on' : '')}>
        <HomeIcon />
        <b>Shops</b>
      </NavLink>
      <NavLink to="/scan" className={cls}>
        <ScanIcon />
        <b>Scan</b>
      </NavLink>
      <NavLink to="/you" className={cls}>
        <PersonIcon />
        <b>You</b>
      </NavLink>
    </nav>
  );
}

/** The right bar for a shop's screen, by where it's being seen. */
export function ShopBar() {
  const { mode } = useScope();
  return mode === 'hub' ? <HubNav inShop /> : <ShopNav />;
}

// ---- Sheets -------------------------------------------------------------------------------------

/** A sheet over the screen: the scrim closes it. */
export function Sheet({ children, onClose, full, look }: { children: ReactNode; onClose: () => void; full?: boolean; look?: CSSProperties }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="r-scrim" onClick={(e) => e.target === e.currentTarget && onClose()} style={look}>
      <div className={full ? 'sa-sheet' : 'sa-sheet2'} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}
