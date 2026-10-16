import type { PublicShopApp } from '@clear/merchant-contracts';
import { useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useAuth } from './auth/auth';
import { useRead } from './data/context';
import { Frames } from './preview/Frames';
import { PREVIEW } from './lib/env';
import { ShopScope } from './shell/ui';
import { HubHome, HubScan, HubYou } from './screens/hub';
import { ActivityScreen, ApproveScreen, BillScreen, ClaimScreen, PaidScreen, PayScreen, RewardsTab, ShopHome, ShopYou, ShowCode } from './screens/shop';
import { HubSignIn, ShopJoin, ShopJoinTap, Welcome, useJoined } from './screens/signin';

/** Signed in, and someone: else signing in, or Welcome. */
function HubGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [tick, setTick] = useState(0);
  const person = useRead((d) => (auth.signedIn ? d.person() : Promise.resolve(null)), [auth.signedIn, tick]);
  if (!auth.ready || (auth.signedIn && person.loading)) return null;
  if (!auth.signedIn) return <HubSignIn onDone={() => setTick((t) => t + 1)} />;
  if (!person.data) return <Welcome onDone={() => setTick((t) => t + 1)} />;
  return <>{children}</>;
}

/** A shop's screens need them signed in and joined; otherwise its Join screen. */
function ShopGate({ shop, children }: { shop: PublicShopApp; children: ReactNode }) {
  const auth = useAuth();
  const [tick, setTick] = useState(0);
  const person = useRead((d) => (auth.signedIn ? d.person() : Promise.resolve(null)), [auth.signedIn, tick]);
  const joined = useJoined(shop.slug, `${auth.signedIn}-${tick}-${Boolean(person.data)}`);
  if (!auth.ready || (auth.signedIn && (person.loading || (person.data && joined.loading)))) return null;
  if (!auth.signedIn || !person.data) return <ShopJoin shop={shop} onDone={() => setTick((t) => t + 1)} />;
  if (!joined.data) return <ShopJoinTap shop={shop} onDone={() => setTick((t) => t + 1)} />;
  return <>{children}</>;
}

/** The same screens at `/s/:slug/…` (a shop's own link) and `/shops/:slug/…` (inside the hub). */
function ShopRoutes({ hub }: { hub?: boolean }) {
  const { slug = '' } = useParams();
  const screen = (S: (p: { shop: PublicShopApp }) => ReactNode, open = false) => (
    <ShopScope slug={slug}>{(shop) => (open ? <S shop={shop} /> : <ShopGate shop={shop}><S shop={shop} /></ShopGate>)}</ShopScope>
  );
  const routes = (
    <Routes>
      <Route index element={screen(ShopHome)} />
      <Route path="rewards" element={screen(RewardsTab)} />
      <Route path="rewards/:id" element={screen(ClaimScreen)} />
      <Route path="pay" element={screen(PayScreen)} />
      <Route path="code" element={screen(ShowCode)} />
      <Route path="bill/:point" element={screen(BillScreen)} />
      <Route path="paid/:order" element={hub ? <HubGate>{screen(PaidScreen, true)}</HubGate> : screen(PaidScreen)} />
      <Route path="c/:code" element={screen(ApproveScreen)} />
      <Route path="you" element={screen(ShopYou)} />
      <Route path="activity" element={screen(ActivityScreen)} />
      <Route path="join" element={<JoinRedirect />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
  return hub ? <HubGate>{routes}</HubGate> : routes;
}

/** A shop's join link (its counter card) is its Home: signed out, Home is the Join screen. */
function JoinRedirect() {
  const { slug = '' } = useParams();
  return <Navigate to={`/s/${slug}`} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/s/:slug/*" element={<ShopRoutes />} />
        <Route path="/shops/:slug/*" element={<ShopRoutes hub />} />
        <Route path="/" element={<HubGate><HubHome /></HubGate>} />
        <Route path="/scan" element={<HubGate><HubScan /></HubGate>} />
        <Route path="/you" element={<HubGate><HubYou /></HubGate>} />
        {PREVIEW ? <Route path="/_frames" element={<Frames />} /> : null}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
