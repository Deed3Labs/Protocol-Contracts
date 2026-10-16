import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  BRAND_PRESETS,
  brandContrast,
  earnLabels,
  earnPoints,
  giveBack,
  pointsWord,
  type Brand,
  type CatalogItem,
  type DiscountCode,
  type EarnRules,
  type FontRef,
  type MerchantApi,
  type PointsName,
  type Reward,
  type ShopAppSettings,
  type UploadedFont,
} from '@clear/merchant-contracts';
import { IconAppHome, IconAppRewards, IconAppYou, IconChevron12, IconClear14, IconScanCode } from '@/brand/chargeIcons';
import { clickOnKey, cx, Sheet } from '@/brand/ui';
import { mockControls, useMerchantApi } from '@/data/merchantApi';
import { errorSentence, useApi } from '@/data/useApi';
import { Btn, Cell, Chips, FootLine, Main, R2, Rows, Switch, TextSheet, Tg } from '@/settings/views';
import { boostDet, dollars, fontFamily, fontNameOf, giveBackLine, givesLabel, limitLabel, offerRow, offerWhen, rateExample, rulesInput, sizeLabel } from '@/settings/shopAppModel';

/**
 * Settings › Shop app (rewards spec, section 8): the shop's own app for its customers, its look,
 * how points are earned, its rewards and which discount codes it shows. Owners and managers change
 * it; the counter sees it as it is. Every change saves as it's made, and the preview on the right is
 * the app as a customer sees it.
 */

export const SHOP_APP_DET = 'Your own app for your customers: rewards, offers and Scan to pay.';

type Open =
  | { kind: 'domain' }
  | { kind: 'store' }
  | { kind: 'reward'; reward: Reward | null; draft?: Partial<Reward> }
  | { kind: 'font'; usedFor: 'headings' | 'everything'; file?: File; licence?: boolean }
  | { kind: 'boost' }
  | { kind: 'colour' }
  | { kind: 'name' }
  | { kind: 'logo' }
  | { kind: 'preview' }
  | null;

const PRESET_KEYS = ['terracotta', 'ink', 'olive', 'plum'] as const;
const QUICK = [100, 500, 1000, 2000];
const MULTIPLIERS = [1, 1.5, 2] as const;
const EXPIRY = ['never', '12m', '6m'] as const;
const HEADING_PRESETS = [
  ['serif', 'Serif'],
  ['grotesque', 'Grotesque'],
  ['rounded', 'Rounded'],
] as const;
const TEXT_PRESETS = [
  ['instrument_sans', 'Instrument Sans'],
  ['serif', 'Serif'],
  ['rounded', 'Rounded'],
] as const;
const PRESET_FONTS = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Archivo:wght@500;600;700&family=Nunito:wght@700;800&display=swap';

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const monthDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** The type the preview and the font sheet draw in: the presets, and the shop's own uploads. */
function useShopFonts(fonts: UploadedFont[]) {
  useEffect(() => {
    if (!document.getElementById('c-shop-fonts')) {
      const link = document.createElement('link');
      link.id = 'c-shop-fonts';
      link.rel = 'stylesheet';
      link.href = PRESET_FONTS;
      document.head.append(link);
    }
  }, []);
  const css = fonts.map((f) => `@font-face{font-family:'${f.name.replace(/'/g, '')}';src:url(${JSON.stringify(f.url)});font-display:swap}`).join('');
  useEffect(() => {
    let el = document.getElementById('c-shop-uploaded-fonts');
    if (!el) {
      el = document.createElement('style');
      el.id = 'c-shop-uploaded-fonts';
      document.head.append(el);
    }
    el.textContent = css;
  }, [css]);
}

/** A number in a box, as the spec draws `.sa-box`: saved when it's left or Enter is pressed. */
function NumBox({ value, prefix = '', width, label, disabled, min = 0, onCommit }: { value: number; prefix?: string; width?: number; label: string; disabled?: boolean; min?: number; onCommit: (n: number) => void }) {
  const shown = `${prefix}${value}`;
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const n = Number(text.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(n) && n >= min && `${prefix}${n}` !== shown) onCommit(n);
    else setText(shown);
  };
  return (
    <input
      className="c-sa-box"
      aria-label={label}
      inputMode="decimal"
      style={width ? { width } : undefined}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

/** Two or three choices, one on: `.st-seg.tm-seg`. */
function Seg({ options, on, onPick, label, disabled }: { options: string[]; on: number; onPick?: (i: number) => void; label: string; disabled?: boolean }) {
  return (
    <div className="c-st-seg c-tm-seg" role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <b
          key={o}
          className={i === on ? 'c-on' : undefined}
          role="radio"
          aria-checked={i === on}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          onKeyDown={clickOnKey}
          onClick={disabled || !onPick ? undefined : () => onPick(i)}
        >
          {o}
        </b>
      ))}
    </div>
  );
}

/** A 4 × 6 card with the join code, for the register and tables. */
function printJoinCard(shop: string, url: string) {
  document.getElementById('c-print-root')?.remove();
  document.getElementById('c-print-css')?.remove();
  const css = document.createElement('style');
  css.id = 'c-print-css';
  css.textContent = `@page{size:4in 6in;margin:0}@media screen{#c-print-root{display:none}}@media print{body>*:not(#c-print-root){display:none!important}#c-print-root{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;width:4in;height:6in;font-family:'Instrument Sans',sans-serif;color:#16211D;text-align:center}#c-print-root h1{font-size:22px;margin:0}#c-print-root p{margin:0;font-size:13px}}`;
  const root = document.createElement('div');
  root.id = 'c-print-root';
  document.head.append(css);
  document.body.append(root);
  const r = createRoot(root);
  flushSync(() =>
    r.render(
      <>
        <h1>Join {shop} Rewards</h1>
        <QRCodeSVG value={`https://${url}`} size={220} fgColor="#16211D" />
        <p>Scan to join · {url}</p>
      </>,
    ),
  );
  const done = () => {
    r.unmount();
    root.remove();
    css.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

/** The app as a customer sees it, small (`.sa-thumb`): a sample member with 128 points and $212.40. */
function AppThumb({ s, shopName, codes, timeZone }: { s: ShopAppSettings; shopName: string; codes: DiscountCode[]; timeZone: string }) {
  const { app, rules, rewards, fonts } = s;
  const b = app.brand;
  const points = 128;
  const word = (n: number) => pointsWord(app.pointsName, n);
  const offers = app.offerCodeIds.map((id) => codes.find((c) => c.id === id)).filter((c): c is DiscountCode => Boolean(c));
  const vars = { '--b': b.colour, '--bi': b.onColour, '--bf': fontFamily(b.headingFont, fonts), '--bp': b.paper, '--b2': b.paper2 } as CSSProperties;
  const labels = earnLabels(rules, app.pointsName);
  return (
    <div className="c-sa-thumb c-page-rewards" aria-label="Preview of your app">
      <div className="c-sa-wrap">
        <div className="c-sa-ph" style={vars}>
          <div className="c-sa-status">
            <span>9:41</span>
            <span>&#9679;&#9679;&#9679;</span>
          </div>
          <div className="c-sa-top">
            <span className="c-sa-brand">
              {b.logoUrl ? <img className="c-sa-logo" src={b.logoUrl} alt="" /> : <span className="c-sa-logo">{b.monogram}</span>}
              <span className="c-sa-name">{shopName}</span>
            </span>
            <span className="c-sa-av">SM</span>
          </div>
          <div className="c-sa-body">
            <div className="c-sa-sec c-sa-brandsec">
              <div className="c-sa-h">
                <p className="c-label">Rewards</p>
                <span className="c-det">{labels.rate}</span>
              </div>
              <div className="c-sa-m">
                <p className="c-sa-pts">
                  <b>{points}</b>
                  <span>{word(points)}</span>
                </p>
                <div className="c-sa-rows">
                  {rewards.slice(0, 2).map((r) => (
                    <div key={r.id} className="c-sa-r ">
                      <div>
                        <p className="c-t">{r.name}</p>
                        <p className="c-det">
                          {r.cost} {word(r.cost)}
                        </p>
                      </div>
                      <span className="c-v">{r.cost <= points ? <span className="c-sa-ready">Ready</span> : <span className="c-det">{r.cost - points} to go</span>}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="c-sa-f">
                <button type="button" className="c-sa-btn " tabIndex={-1}>
                  See rewards
                </button>
                <span className="c-det">{labels.expiry}</span>
              </div>
            </div>
            <div className="c-sa-sec c-sa-clear">
              <div className="c-sa-h">
                <p className="c-sa-cl">
                  <IconClear14 />
                  <span className="c-label">Clear balance</span>
                </p>
                <span className="c-det">Spendable</span>
              </div>
              <div className="c-sa-m">
                <p className="c-sa-amt">$212.40</p>
                <p className="c-det">Your Clear account. The same balance in every Clear shop.</p>
              </div>
              <div className="c-sa-f">
                <button type="button" className="c-sa-btn c-k" tabIndex={-1}>
                  Scan to pay
                </button>
                <span className="c-det">
                  Open in Clear <IconChevron12 />
                </span>
              </div>
            </div>
            {offers.length > 0 && (
              <div className="c-sa-sec ">
                <div className="c-sa-h">
                  <p className="c-label">Offers</p>
                  <span className="c-det">{offers.length}</span>
                </div>
                <div className="c-sa-m">
                  <div className="c-sa-rows">
                    {offers.slice(0, 2).map((c) => (
                      <div key={c.id} className="c-sa-r ">
                        <div>
                          <p className="c-t">{c.offer?.title ?? c.code}</p>
                          <p className="c-det">{c.offer?.detail ?? ''}</p>
                        </div>
                        <span className="c-v">
                          <span className="c-det">{c.days?.length === 1 ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][c.days[0]!] : offerWhen(c, timeZone)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          <nav className="c-sa-nav">
            <span className="c-on">
              <IconAppHome />
              <b>Home</b>
            </span>
            <span className="">
              <IconAppRewards />
              <b>Rewards</b>
            </span>
            <span className="">
              <IconScanCode size={20} />
              <b>Pay</b>
            </span>
            <span className="">
              <IconAppYou />
              <b>You</b>
            </span>
          </nav>
        </div>
      </div>
    </div>
  );
}

/** Settings › Shop app, with its sheets. `screen` opens one of them in the preview. */
export function ShopAppSection({ head, screen, onDiscounts }: { head: ReactNode; screen?: string; onDiscounts?: () => void }) {
  const merchant = useMerchantApi();
  const settings = useApi(() => merchant.shopApp(), []);
  const codes = useApi(() => merchant.discountCodes(), []);
  const catalog = useApi(() => merchant.catalog(), []);
  const shop = useApi(() => merchant.shop(), []);
  const [s, setS] = useState<ShopAppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [copied, setCopied] = useState(false);
  const opened = useRef(false);
  useEffect(() => setS(settings.data), [settings.data]);
  useShopFonts(s?.fonts ?? []);

  const items = useMemo(() => (catalog.data ?? []).filter((i) => !i.archivedAt), [catalog.data]);
  const nameOf = (id: string) => items.find((i) => i.id === id)?.name ?? null;
  const priceOf = (id: string) => items.find((i) => i.id === id)?.priceCents ?? null;
  const timeZone = shop.data?.timezone ?? 'America/Los_Angeles';
  const shopName = shop.data?.name ?? 'Your shop';

  // The preview's sheets: `&screen=shop-app-domain|store|reward|font`.
  useEffect(() => {
    if (opened.current || !s || !screen?.startsWith('shop-app-')) return;
    opened.current = true;
    const which = screen.slice('shop-app-'.length);
    if (which === 'domain') {
      // The preview's domain, two minutes after it was last checked (section 8's Own domain).
      const ctl = mockControls();
      if (ctl && !s.domain) {
        ctl.rewards.domain('rewards.micasatacos.com', 2);
        void merchant.shopApp().then((next) => (setS(next), setOpen({ kind: 'domain' })));
      } else setOpen({ kind: 'domain' });
    }
    if (which === 'store') setOpen({ kind: 'store' });
    if (which === 'reward') setOpen({ kind: 'reward', reward: null, draft: s.rewards[0] ? { ...s.rewards[0], id: undefined } : undefined });
    if (which === 'font') setOpen({ kind: 'font', usedFor: 'headings', file: new File([new Uint8Array(190_464)], 'Casa-Display-Bold.woff2'), licence: true });
  }, [s, screen]);

  if (!s) {
    return (
      <>
        {head}
        <div className="c-panebody">{settings.error ? <p className="c-det">{settings.error}</p> : null}</div>
      </>
    );
  }

  const edit = s.canEdit;
  const { app, rules } = s;
  const word = (n: number) => pointsWord(app.pointsName, n);
  const many = capital(word(2));
  const save = async (fn: (m: MerchantApi) => Promise<unknown>) => {
    setError(null);
    try {
      const out = await fn(merchant);
      if (out && typeof out === 'object' && 'app' in out && 'rules' in out) setS(out as ShopAppSettings);
      else settings.reload();
      return true;
    } catch (e) {
      setError(errorSentence(e));
      return false;
    }
  };
  const saveRules = (patch: Partial<ReturnType<typeof rulesInput>>) => save((m) => m.updateShopApp({ rules: { ...rulesInput(rules), ...patch } }));
  const saveBrand = (patch: Partial<Brand>) => save((m) => m.updateShopApp({ brand: patch }));

  const presetOn = PRESET_KEYS.findIndex((k) => BRAND_PRESETS[k].colour === app.brand.colour && BRAND_PRESETS[k].paper === app.brand.paper);
  const headingFonts = s.fonts.filter((f) => f.checks.glyphs === 'passed' && f.checks.legibility === 'passed');
  const textFonts = headingFonts.filter((f) => f.usedFor === 'everything');
  const fontIndex = (ref: FontRef, presets: readonly (readonly [string, string])[], uploads: UploadedFont[]) =>
    ref.kind === 'preset' ? presets.findIndex(([k]) => k === ref.preset) : presets.length + uploads.findIndex((f) => f.id === ref.fontId);
  const headingUpload = app.brand.headingFont.kind === 'uploaded' ? s.fonts.find((f) => f.id === (app.brand.headingFont as { fontId: string }).fontId) : undefined;
  const birthday = rules.birthdayRewardId ? s.rewards.find((r) => r.id === rules.birthdayRewardId) : undefined;
  const boostsOn = rules.boosts.filter((b) => b.on).length + (rules.birthdayRewardId ? 1 : 0) + (rules.referralBonus ? 1 : 0);
  const emailDomain = shop.data?.listing.email?.split('@')[1];
  const shopCodes = (codes.data ?? []).filter((c) => c.code);
  const domainDet = s.domain
    ? `${s.domain.domain} · ${s.domain.status === 'verified' ? 'live' : s.domain.status === 'failed' ? 'not found' : 'checking'}`
    : `${emailDomain ? `rewards.${emailDomain}` : 'Your own address'} · add-on`;

  return (
    <>
      {head}
      <div className="c-panebody">
        {error && (
          <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginBottom: 'var(--s2)' }}>
            {error}
          </p>
        )}
        {/* ---- Your app */}
        <Cell label="Your app" det={app.enabled ? 'On' : 'Off'}>
          <Main>
            <div className="c-tm-split">
              <div>
                <Rows>
                  <R2
                    t="Your app"
                    det={app.enabled ? `${s.link} · installs from the browser` : `${s.link} · off until you turn it on`}
                    end={
                      app.enabled ? (
                        <Btn
                          sm
                          onClick={() => {
                            void navigator.clipboard?.writeText(`https://${s.link}`).then(() => {
                              setCopied(true);
                              setTimeout(() => setCopied(false), 1600);
                            });
                          }}
                        >
                          {copied ? 'Copied' : 'Copy'}
                        </Btn>
                      ) : edit ? (
                        <Btn sm primary onClick={() => void save((m) => m.updateShopApp({ enabled: true }))}>
                          Turn on
                        </Btn>
                      ) : null
                    }
                  />
                  <R2 t="Members" det={`${s.members.joined} joined · ${s.members.thisWeek} this week · ${s.members.withClear} have Clear`} end={null} />
                  <R2 t="Counter card" det="A 4 × 6 card with the code, for the register and tables" end={<Btn sm onClick={() => printJoinCard(shopName, s.link)}>Print</Btn>} />
                  <R2 t="Your own domain" det={domainDet} end={edit ? <Btn sm onClick={() => setOpen({ kind: 'domain' })}>{s.domain ? 'Manage' : 'Set up'}</Btn> : null} />
                  <R2 t="Your own app in the stores" det="App Store and Google Play, built and kept up to date by Clear · add-on" end={<Btn sm onClick={() => setOpen({ kind: 'store' })}>See how</Btn>} />
                </Rows>
              </div>
              <div className="c-sa-mini">
                <QRCodeSVG value={`https://${s.link}`} size={110} fgColor="#16211D" marginSize={2} title={`Scan to join: ${s.link}`} />
                <p className="c-det">Scan to join</p>
              </div>
            </div>
          </Main>
        </Cell>
        <div style={{ height: 'var(--s3)' }} />

        {/* ---- Look */}
        <Cell label="Look" det="Preview on the right">
          <Main>
            <div className="c-tm-split">
              <div>
                <Rows>
                  <R2 t="Logo" det="Square, at least 512px. Shown on the app icon and header" end={edit ? <Btn sm onClick={() => setOpen({ kind: 'logo' })}>Change</Btn> : null} />
                </Rows>
                <p className="c-label c-st-fl">Colour</p>
                <Chips
                  options={[...PRESET_KEYS.map((k) => BRAND_PRESETS[k].label), 'Custom']}
                  value={presetOn === -1 ? 4 : presetOn}
                  disabled={edit ? [] : [0, 1, 2, 3, 4].filter((i) => i !== (presetOn === -1 ? 4 : presetOn))}
                  onPick={(i) => {
                    if (i === 4) return setOpen({ kind: 'colour' });
                    const p = BRAND_PRESETS[PRESET_KEYS[i]!];
                    void saveBrand({ colour: p.colour, onColour: p.onColour, paper: p.paper, paper2: p.paper2 });
                  }}
                />
                <p className="c-label c-st-fl">Headings</p>
                <Chips
                  options={[...HEADING_PRESETS.map(([, l]) => l), ...headingFonts.map((f) => f.name)]}
                  value={fontIndex(app.brand.headingFont, HEADING_PRESETS, headingFonts)}
                  disabled={edit ? [] : HEADING_PRESETS.map((_, i) => i).concat(headingFonts.map((_, i) => i + 3)).filter((i) => i !== fontIndex(app.brand.headingFont, HEADING_PRESETS, headingFonts))}
                  onPick={(i) =>
                    void saveBrand({ headingFont: i < HEADING_PRESETS.length ? { kind: 'preset', preset: HEADING_PRESETS[i]![0] } : { kind: 'uploaded', fontId: headingFonts[i - HEADING_PRESETS.length]!.id } })
                  }
                />
                <p className="c-det" style={{ marginTop: 6 }}>
                  {headingUpload ? `${headingUpload.name} is your own font, uploaded ${monthDay(headingUpload.uploadedAt)}. ` : ''}
                  {edit && (
                    <u role="button" tabIndex={0} onKeyDown={clickOnKey} style={{ cursor: 'pointer' }} onClick={() => setOpen({ kind: 'font', usedFor: 'headings' })}>
                      Upload a font
                    </u>
                  )}
                </p>
                <p className="c-label c-st-fl">Text</p>
                <Chips
                  options={[...TEXT_PRESETS.map(([, l]) => l), ...textFonts.map((f) => f.name), ...(edit ? ['Upload'] : [])]}
                  value={fontIndex(app.brand.textFont, TEXT_PRESETS, textFonts)}
                  disabled={edit ? [] : TEXT_PRESETS.map((_, i) => i).filter((i) => i !== fontIndex(app.brand.textFont, TEXT_PRESETS, textFonts))}
                  onPick={(i) => {
                    if (i === TEXT_PRESETS.length + textFonts.length) return setOpen({ kind: 'font', usedFor: 'everything' });
                    void saveBrand({ textFont: i < TEXT_PRESETS.length ? { kind: 'preset', preset: TEXT_PRESETS[i]![0] } : { kind: 'uploaded', fontId: textFonts[i - TEXT_PRESETS.length]!.id } });
                  }}
                />
                <p className="c-det" style={{ marginTop: 8 }}>
                  Colours are checked for contrast and fonts for legibility before they save. Amounts and the Clear balance block always use Clear’s type.
                </p>
              </div>
              <AppThumb s={s} shopName={shopName} codes={codes.data ?? []} timeZone={timeZone} />
            </div>
          </Main>
        </Cell>
        <div style={{ height: 'var(--s3)' }} />

        {/* ---- Earning */}
        <Cell
          label="Earning"
          det={earnLabels(rules, app.pointsName).rate}
          foot={
            <FootLine det={giveBackLine(s.giveBack)}>
              <Btn onClick={() => setOpen({ kind: 'preview' })}>Preview an order</Btn>
            </FootLine>
          }
        >
          <Main>
            <Rows>
              <R2 t="Earn by" det="Dollars spent, or one stamp a visit like a punch card" end={<Seg label="Earn by" options={['Dollars', 'Visits']} on={rules.unit === 'dollars' ? 0 : 1} disabled={!edit} onPick={(i) => void saveRules({ unit: i === 0 ? 'dollars' : 'visits' })} />} />
              {rules.unit === 'dollars' ? (
                <>
                  <R2
                    t="Rate"
                    det={rateExample(rules, word)}
                    end={
                      <span className="c-sa-inl">
                        <NumBox label={`${capital(word(2))} each time`} value={rules.pointsPer} min={1} disabled={!edit} onCommit={(n) => void saveRules({ pointsPer: Math.round(n) })} /> {word(rules.pointsPer)} for every{' '}
                        <NumBox label="For every" prefix="$" width={52} value={rules.perAmountCents / 100} min={0.01} disabled={!edit} onCommit={(n) => void saveRules({ perAmountCents: Math.round(n * 100) })} />
                      </span>
                    }
                  />
                  <R2
                    t="Quick picks"
                    det="Or type any amount"
                    end={<Chips options={QUICK.map(dollars)} value={QUICK.indexOf(rules.perAmountCents)} disabled={edit ? [] : QUICK.map((_, i) => i).filter((i) => QUICK[i] !== rules.perAmountCents)} onPick={(i) => void saveRules({ perAmountCents: QUICK[i]! })} />}
                  />
                  <R2
                    t="Keep the change"
                    det={`Leftover dollars carry to the next visit, so at $10 a ${word(1)}, $15 and $15 earn 3`}
                    end={<Tg on={rules.keepTheChange} label="Keep the change" onChange={edit ? (on) => void saveRules({ keepTheChange: on }) : undefined} />}
                  />
                </>
              ) : (
                <>
                  <R2
                    t="Rate"
                    det={`One ${word(1)} a visit, at most once a day`}
                    end={
                      <span className="c-sa-inl">
                        <NumBox label="A visit pays at least" prefix="$" width={52} value={rules.visitMinCents / 100} disabled={!edit} onCommit={(n) => void saveRules({ visitMinCents: Math.round(n * 100) })} /> or more
                      </span>
                    }
                  />
                  <R2
                    t="Card"
                    det={`${capital(word(2))} to a card, like a punch card`}
                    end={
                      <span className="c-sa-inl">
                        <NumBox label="To a card" value={rules.cardSize} min={2} disabled={!edit} onCommit={(n) => void saveRules({ cardSize: Math.round(n) })} /> {word(2)}
                      </span>
                    }
                  />
                </>
              )}
              <R2 t="Counted on" det={`What they pay, before tax and tip. Refunds take ${word(2)} back`} end={null} />
              <R2
                t="Extra for paying with Clear"
                det="Clear costs you less to take than a card; pass some of it on"
                end={<Seg label="Extra for paying with Clear" options={['Off', '1.5×', '2×']} on={MULTIPLIERS.indexOf(rules.clearMultiplier)} disabled={!edit} onPick={(i) => void saveRules({ clearMultiplier: MULTIPLIERS[i]! })} />}
              />
              <R2
                t="Call them"
                det="What the app says instead of points"
                end={
                  <Chips
                    options={['Points', 'Stars', 'Custom']}
                    value={['points', 'stars', 'custom'].indexOf(app.pointsName.kind)}
                    disabled={edit ? [] : [0, 1, 2].filter((i) => i !== ['points', 'stars', 'custom'].indexOf(app.pointsName.kind))}
                    onPick={(i) => (i === 2 ? setOpen({ kind: 'name' }) : void save((m) => m.updateShopApp({ pointsName: { kind: i === 0 ? 'points' : 'stars' } })))}
                  />
                }
              />
            </Rows>
          </Main>
        </Cell>
        <div style={{ height: 'var(--s3)' }} />

        {/* ---- Boosts and bonuses */}
        <Cell
          label="Boosts and bonuses"
          det={`${boostsOn} on`}
          foot={
            <FootLine det="Boosts multiply the rate; only the biggest one applies.">
              {edit && <Btn onClick={() => setOpen({ kind: 'boost' })}>Add a boost</Btn>}
            </FootLine>
          }
        >
          <Main>
            <Rows>
              {rules.boosts.map((b, i) => (
                <R2
                  key={b.id}
                  t={b.name}
                  det={boostDet(b)}
                  end={<Tg on={b.on} label={b.name} onChange={edit ? (on) => void saveRules({ boosts: rules.boosts.map((x, j) => (j === i ? { ...x, on } : x)) }) : undefined} />}
                />
              ))}
              <R2
                t="For joining"
                det={`${capital(word(2))} when they join, once`}
                end={
                  <span className="c-sa-inl">
                    <NumBox label="For joining" value={rules.joinBonus} disabled={!edit} onCommit={(n) => void saveRules({ joinBonus: Math.round(n) })} /> {word(rules.joinBonus)}
                  </span>
                }
              />
              <R2
                t="Birthday"
                det={`${birthday || s.rewards[0] ? `A ${lowerFirst((birthday ?? s.rewards[0])!.name)}` : 'A reward'} in their birthday month. Asks the month only`}
                end={<Tg on={Boolean(rules.birthdayRewardId)} label="Birthday" onChange={edit && s.rewards[0] ? (on) => void saveRules({ birthdayRewardId: on ? (birthday ?? s.rewards[0]!).id : null }) : undefined} />}
              />
              <R2
                t="Bring a friend"
                det={`${rules.referralBonus ?? 50} ${word(rules.referralBonus ?? 50)} each when the friend first pays`}
                end={<Tg on={rules.referralBonus !== null} label="Bring a friend" onChange={edit ? (on) => void saveRules({ referralBonus: on ? 50 : null }) : undefined} />}
              />
              <R2
                t={`${many} expire`}
                det="Counted from their last visit. A change applies to points earned after it"
                end={<Seg label={`${many} expire`} options={['Never', '12 months', '6 months']} on={EXPIRY.indexOf(rules.expiry)} disabled={!edit} onPick={(i) => void saveRules({ expiry: EXPIRY[i]! })} />}
              />
            </Rows>
          </Main>
        </Cell>
        <div style={{ height: 'var(--s3)' }} />

        {/* ---- Rewards */}
        <Cell
          label="Rewards"
          det={String(s.rewards.length)}
          foot={
            <FootLine det="Rewards are items or amounts off; they never become cash.">
              {edit && <Btn onClick={() => setOpen({ kind: 'reward', reward: null })}>Add a reward</Btn>}
            </FootLine>
          }
        >
          <Main>
            <div className="c-sa-rwh">
              <span>Reward</span>
              <span>Gives</span>
              <span>Limit</span>
              <span>{capital(word(2))}</span>
            </div>
            {s.rewards.map((r) => (
              <div
                key={r.id}
                className="c-sa-rwrow"
                {...(edit ? { role: 'button', tabIndex: 0, onKeyDown: clickOnKey, onClick: () => setOpen({ kind: 'reward', reward: r }), style: { cursor: 'pointer' } } : {})}
              >
                <b>{r.name}</b>
                <span>{givesLabel(r, nameOf)}</span>
                <span>{limitLabel(r)}</span>
                <span className="c-sa-c">{r.cost}</span>
              </div>
            ))}
            {s.rewards.length === 0 && <p className="c-det" style={{ paddingTop: 12 }}>No rewards yet. A free drink at 75 is a good first one.</p>}
          </Main>
        </Cell>
        <div style={{ height: 'var(--s3)' }} />

        {/* ---- Offers in the app */}
        <Cell
          label="Offers in the app"
          det="From Discounts"
          foot={
            <FootLine det="Codes are made in Discounts; this only chooses which the app shows.">
              {onDiscounts && <Btn onClick={onDiscounts}>Discounts</Btn>}
            </FootLine>
          }
        >
          <Main>
            <Rows>
              {shopCodes.map((c) => {
                const row = offerRow(c, timeZone);
                const on = app.offerCodeIds.includes(c.id);
                return (
                  <R2
                    key={c.id}
                    t={row.t}
                    det={row.det}
                    end={
                      <Tg
                        on={on}
                        label={`Show ${c.code} in the app`}
                        onChange={
                          edit
                            ? (next) =>
                                void save((m) => m.updateOffer(c.id, { showInApp: next })).then(() => {
                                  codes.reload();
                                  settings.reload();
                                })
                            : undefined
                        }
                      />
                    }
                  />
                );
              })}
              {shopCodes.length === 0 && <p className="c-det">No discount codes yet. Make one in Discounts and it can show here.</p>}
            </Rows>
          </Main>
        </Cell>
      </div>

      {open?.kind === 'domain' && <DomainSheet s={s} merchant={merchant} suggest={emailDomain ? `rewards.${emailDomain}` : ''} onSaved={() => settings.reload()} onClose={() => setOpen(null)} />}
      {open?.kind === 'store' && <StoreSheet shop={shopName} onClose={() => setOpen(null)} />}
      {open?.kind === 'reward' && (
        <RewardSheet
          s={s}
          reward={open.reward}
          draft={open.draft}
          items={items}
          priceOf={priceOf}
          word={word}
          onSave={async (input) => {
            const ok = await save((m) => (open.reward ? m.updateReward(open.reward.id, input) : m.createReward(input)));
            if (ok) setOpen(null);
          }}
          onRemove={
            open.reward
              ? async () => {
                  const ok = await save((m) => m.removeReward(open.reward!.id));
                  if (ok) setOpen(null);
                }
              : undefined
          }
          error={error}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'font' && (
        <FontSheet
          merchant={merchant}
          usedFor={open.usedFor}
          initialFile={open.file}
          initialLicence={open.licence}
          sample={[s.rewards[0] ? `${s.rewards[0].name}, ${s.rewards[0].cost} ${word(s.rewards[0].cost)}` : 'Your rewards, in your type', offerSample(app.offerCodeIds, codes.data ?? [])]}
          onUse={async (font, usedFor) => {
            settings.reload();
            const ok = await saveBrand(usedFor === 'everything' ? { headingFont: { kind: 'uploaded', fontId: font.id }, textFont: { kind: 'uploaded', fontId: font.id } } : { headingFont: { kind: 'uploaded', fontId: font.id } });
            if (ok) setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'boost' && (
        <BoostSheet
          categories={[...new Set(items.map((i) => i.category))]}
          onAdd={async (b) => {
            const ok = await saveRules({ boosts: [...rules.boosts, b] });
            if (ok) setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'colour' && (
        <ColourSheet
          brand={app.brand}
          onSave={async (c) => {
            const ok = await saveBrand(c);
            if (ok) setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'name' && (
        <TextSheet
          title="Call them"
          det="One and many, as the app says them: a stamp, 6 stamps."
          fields={[
            { key: 'one', label: 'One', value: app.pointsName.kind === 'custom' ? app.pointsName.one : '', max: 16, required: true },
            { key: 'many', label: 'Many', value: app.pointsName.kind === 'custom' ? app.pointsName.many : '', max: 16, required: true },
          ]}
          error={error}
          onSave={async (v) => {
            const name: PointsName = { kind: 'custom', one: v.one!.trim().toLowerCase(), many: v.many!.trim().toLowerCase() };
            const ok = await save((m) => m.updateShopApp({ pointsName: name }));
            if (ok) setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'logo' && (
        <TextSheet
          title="Logo"
          det="The address of a square image, at least 512px. Leave it empty for your initials."
          fields={[{ key: 'url', label: 'Image address', value: app.brand.logoUrl ?? '', max: 500 }]}
          error={error}
          onSave={async (v) => {
            const ok = await saveBrand({ logoUrl: v.url!.trim() || null });
            if (ok) setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'preview' && <PreviewOrderSheet rules={rules} word={word} onClose={() => setOpen(null)} />}
    </>
  );
}

/** "Two tacos for $7 · Taco Tuesday": the first offer, as the font sheet's small line. */
function offerSample(ids: string[], codes: DiscountCode[]): string {
  const c = ids.map((id) => codes.find((x) => x.id === id)).find((x) => x?.offer);
  if (!c?.offer) return 'Two for one · Today only';
  const deal = c.offer.detail.split(',')[0] ?? c.offer.detail;
  return `${deal} · ${c.offer.title}`;
}

/** A sheet's foot as the spec draws it: a line, and the one button. */
const Foot = ({ det, children }: { det: string; children: ReactNode }) => (
  <div className="c-line" style={{ alignItems: 'center' }}>
    <p className="c-det">{det}</p>
    {children}
  </div>
);
const Err = ({ error }: { error: string | null }) =>
  error ? (
    <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginTop: 12 }}>
      {error}
    </p>
  ) : null;

// ---- Your own domain ------------------------------------------------------------------------------

function ago(iso: string | null): string {
  if (!iso) return 'not checked yet';
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return min < 1 ? 'checked just now' : min === 1 ? 'checked 1 min ago' : min < 60 ? `checked ${min} min ago` : `checked at ${new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '')}`;
}

function DomainSheet({ s, merchant, suggest, onSaved, onClose }: { s: ShopAppSettings; merchant: MerchantApi; suggest: string; onSaved: () => void; onClose: () => void }) {
  const [domain, setDomain] = useState(s.domain);
  const [text, setText] = useState(s.domain?.domain ?? suggest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typed = text.trim().toLowerCase();
  const labels = typed.split('.');
  const record = domain && domain.domain === typed ? domain.record : labels.length > 2 ? { type: 'CNAME', name: labels[0], value: 'cname.vercel-dns.com' } : { type: 'A', name: '@', value: '76.76.21.21' };
  const saved = Boolean(domain && domain.domain === typed);
  const run = async (fn: () => Promise<typeof domain>) => {
    setBusy(true);
    setError(null);
    try {
      setDomain(await fn());
      onSaved();
    } catch (e) {
      setError(errorSentence(e));
    } finally {
      setBusy(false);
    }
  };
  const chip = !domain ? null : domain.status === 'verified' ? ['c-settled', 'Live'] : domain.status === 'failed' ? ['c-neutral', 'Not found'] : ['c-underway', 'Checking'];
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-w460"
      title="Your own domain"
      onClose={onClose}
      foot={
        <Foot det="Add-on · billed with your plan.">
          <button type="button" className="c-btn c-btn-primary" disabled={busy || typed.length < 4} onClick={() => void run(() => (saved ? merchant.checkDomain() : merchant.setDomain({ domain: typed })))}>
            {saved ? 'Check again' : 'Use this domain'}
          </button>
        </Foot>
      }
    >
      <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
        Your domain
      </p>
      <input className="c-field c-st-in" aria-label="Your domain" placeholder="rewards.yourshop.com" value={text} onChange={(e) => setText(e.target.value)} />
      <p className="c-det" style={{ marginTop: 8 }}>
        Add this record where you bought the domain. We’ll check it and turn on HTTPS for you.
      </p>
      <div className="c-sa-dns">
        <span>Type</span>
        <span>Name</span>
        <span>Value</span>
        <b>{record.type}</b>
        <b>{record.name}</b>
        <b>{record.value}</b>
      </div>
      <Rows style={{ marginTop: 'var(--s2)' }}>
        <R2
          t="DNS record"
          det={
            !saved
              ? 'Not added yet. Save the domain, then add the record'
              : domain!.status === 'verified'
                ? `Seen · HTTPS is on${domain!.verifiedAt ? ` since ${monthDay(domain!.verifiedAt)}` : ''}`
                : `Not seen yet · ${ago(domain!.checkedAt)}. Changes can take up to an hour`
          }
          end={
            saved && chip ? (
              <span className={cx('c-chip', chip[0])}>
                <span className="c-core" />
                {chip[1]}
              </span>
            ) : null
          }
        />
        <R2 t={s.link} det="Keeps working and forwards to your domain" end={null} />
        <R2 t="Signing in" det="Customers confirm their number once on your domain; it can’t share Clear’s sign-in" end={null} />
      </Rows>
      <Err error={error} />
    </Sheet>
  );
}

// ---- Your own app in the stores -------------------------------------------------------------------

function StoreSheet({ shop, onClose }: { shop: string; onClose: () => void }) {
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-w460"
      title="Your own app in the stores"
      onClose={onClose}
      foot={
        <Foot det="Add-on · setup, then monthly.">
          {/* Nothing is submitted from here: starting is a conversation with Clear (rewards prompt, Phase 7). */}
          <a className="c-btn c-btn-primary" href={`mailto:partners@useclear.org?subject=${encodeURIComponent(`Store app for ${shop}`)}`}>
            Start
          </a>
        </Foot>
      }
    >
      <p className="c-det" style={{ marginTop: 0 }}>
        Your app, with your name and icon, in the App Store and Google Play. Apple and Google require it to be published from your own developer accounts, so it is yours; we do the building, submitting and updating.
      </p>
      <div className="c-sa-m c-sa-steps" style={{ padding: '8px 0 0' }}>
        <p>
          <b>1</b>Open your developer accounts<span>Apple Developer Program (yearly) and Google Play Console (one-time), as a business. Apple asks for a D-U-N-S number; we’ll walk you through it</span>
        </p>
        <p>
          <b>2</b>Invite Clear<span>Add us as an admin on both, so we can build and submit</span>
        </p>
        <p>
          <b>3</b>We build and submit<span>Your icon, name, screenshots and listing. Review usually takes a few days</span>
        </p>
        <p>
          <b>4</b>We keep it current<span>New phone versions, store rules and Clear updates, for as long as the add-on is on</span>
        </p>
      </div>
      <Rows style={{ marginTop: 'var(--s2)' }}>
        <R2 t="In the store app" det="Push notifications, your rewards card in Apple Wallet and Google Wallet, and the scanner" end={null} />
      </Rows>
    </Sheet>
  );
}

// ---- Add a reward ---------------------------------------------------------------------------------

type Gives = 'item' | 'amount' | 'percent';

function RewardSheet({
  s,
  reward,
  draft,
  items,
  priceOf,
  word,
  onSave,
  onRemove,
  error,
  onClose,
}: {
  s: ShopAppSettings;
  reward: Reward | null;
  draft?: Partial<Reward>;
  items: CatalogItem[];
  priceOf: (id: string) => number | null;
  word: (n: number) => string;
  onSave: (input: Omit<Reward, 'id'>) => Promise<void>;
  onRemove?: () => Promise<void>;
  error: string | null;
  onClose: () => void;
}) {
  const start = reward ?? draft;
  const g = start?.gives;
  const [name, setName] = useState(start?.name ?? '');
  const [kind, setKind] = useState<Gives>(g?.kind ?? 'item');
  const [itemIds, setItemIds] = useState<string[]>(g?.kind === 'item' ? g.itemIds : []);
  const [amount, setAmount] = useState(g?.kind === 'amount' ? String(g.amountCents / 100) : '');
  const [percent, setPercent] = useState(g?.kind === 'percent' ? String(g.percent) : '');
  const [category, setCategory] = useState<string | null>(g && g.kind !== 'item' ? (g.categories?.[0] ?? null) : null);
  const [cost, setCost] = useState(start?.cost ? String(start.cost) : '');
  const [limit, setLimit] = useState<Reward['limit']>(start?.limit ?? 'none');
  const [clearOnly, setClearOnly] = useState(start?.clearMembersOnly ?? false);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const categories = [...new Set(items.map((i) => i.category))];
  const chosenCats = new Set(itemIds.map((id) => items.find((i) => i.id === id)?.category).filter(Boolean));
  const shown = all || chosenCats.size === 0 ? items : [...itemIds.map((id) => items.find((i) => i.id === id)!).filter(Boolean), ...items.filter((i) => chosenCats.has(i.category) && !itemIds.includes(i.id))];
  const points = Math.round(Number(cost));
  const gives: Reward['gives'] | null =
    kind === 'item'
      ? itemIds.length
        ? { kind: 'item', itemIds, maxCents: g?.kind === 'item' ? g.maxCents : null }
        : null
      : kind === 'amount'
        ? Number(amount) > 0
          ? { kind: 'amount', amountCents: Math.round(Number(amount) * 100), categories: category ? [category] : null }
          : null
        : Number(percent) >= 1 && Number(percent) <= 100
          ? { kind: 'percent', percent: Math.round(Number(percent)), categories: category ? [category] : null }
          : null;
  const back = gives && points > 0 ? giveBack(s.rules, [{ id: 'draft', gives, cost: points }], priceOf).byReward[0] : undefined;
  const ok = name.trim().length > 0 && gives !== null && points > 0;
  const save = async () => {
    if (!gives) return;
    setBusy(true);
    await onSave({ name: name.trim(), gives, cost: points, limit, clearMembersOnly: clearOnly, note: start?.note ?? null });
    setBusy(false);
  };
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-w460"
      title={reward ? reward.name : 'Add a reward'}
      onClose={onClose}
      foot={
        <Foot det={reward ? 'Changes show in the app as soon as you save.' : 'Shows in the app as soon as you save.'}>
          <span className="c-pair">
            {onRemove && (
              <button type="button" className="c-btn" disabled={busy} onClick={() => void onRemove()}>
                Remove
              </button>
            )}
            <button type="button" className="c-btn c-btn-primary" disabled={!ok || busy} onClick={() => void save()}>
              Save reward
            </button>
          </span>
        </Foot>
      }
    >
      <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
        Name
      </p>
      <input className="c-field c-st-in" aria-label="Name" placeholder="Free agua fresca" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      <p className="c-label c-st-fl">Gives</p>
      <Seg label="Gives" options={['An item', '$ off', '% off']} on={['item', 'amount', 'percent'].indexOf(kind)} onPick={(i) => setKind((['item', 'amount', 'percent'] as const)[i]!)} />
      {kind === 'item' ? (
        <>
          <p className="c-label c-st-fl">Which items</p>
          <div className="c-st-chips">
            {shown.map((i) => (
              <button key={i.id} type="button" className={cx('c-btn', itemIds.includes(i.id) && 'c-on')} aria-pressed={itemIds.includes(i.id)} onClick={() => setItemIds((ids) => (ids.includes(i.id) ? ids.filter((x) => x !== i.id) : [...ids, i.id]))}>
                {i.name}
              </button>
            ))}
            {!all && shown.length < items.length && (
              <button type="button" className="c-btn" onClick={() => setAll(true)}>
                + From Inventory
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="c-label c-st-fl">{kind === 'amount' ? 'Dollars off' : 'Percent off'}</p>
          {kind === 'amount' ? (
            <input className="c-field c-st-in" inputMode="decimal" aria-label="Dollars off" placeholder="20.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          ) : (
            <input className="c-field c-st-in" inputMode="numeric" aria-label="Percent off" placeholder="10" value={percent} onChange={(e) => setPercent(e.target.value)} />
          )}
          <p className="c-label c-st-fl">On</p>
          <Chips options={['The whole order', ...categories]} value={category ? categories.indexOf(category) + 1 : 0} onPick={(i) => setCategory(i === 0 ? null : categories[i - 1]!)} />
        </>
      )}
      <Rows style={{ marginTop: 'var(--s2)' }}>
        <R2
          t={capital(word(2))}
          det={back ? `Gives back ${back.percent.toFixed(1)}% at your rate` : kind === 'percent' ? 'Worth a share of what’s on the order' : 'What it costs a customer'}
          end={
            <span className="c-sa-inl">
              <input className="c-sa-box" aria-label={capital(word(2))} inputMode="numeric" value={cost} placeholder="75" onChange={(e) => setCost(e.target.value.replace(/\D/g, ''))} /> {word(points || 2)}
            </span>
          }
        />
        <R2 t="Limit" det="Per customer" end={<Chips options={['None', 'Once a day', 'Once a week']} value={['none', 'daily', 'weekly'].indexOf(limit)} onPick={(i) => setLimit((['none', 'daily', 'weekly'] as const)[i]!)} />} />
        <Switch t="Clear members only" det="Show it to everyone; only Clear members can use it" on={clearOnly} onChange={setClearOnly} />
      </Rows>
      <Err error={error} />
    </Sheet>
  );
}

// ---- Upload a font --------------------------------------------------------------------------------

function FontSheet({
  merchant,
  usedFor: initialUse,
  initialFile,
  initialLicence,
  sample,
  onUse,
  onClose,
}: {
  merchant: MerchantApi;
  usedFor: 'headings' | 'everything';
  initialFile?: File;
  initialLicence?: boolean;
  sample: [string, string];
  onUse: (font: UploadedFont, usedFor: 'headings' | 'everything') => Promise<void>;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [usedFor, setUsedFor] = useState(initialUse);
  const [licence, setLicence] = useState(initialLicence ?? false);
  const [font, setFont] = useState<UploadedFont | null>(null);
  const [family, setFamily] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const name = file ? fontNameOf(file.name) : '';

  // The file itself, drawn before anything is saved.
  useEffect(() => {
    if (!file || typeof FontFace === 'undefined') return;
    let gone = false;
    const fam = `c-upload-${Date.now()}`;
    file
      .arrayBuffer()
      .then((buf) => new FontFace(fam, buf).load())
      .then((face) => {
        if (gone) return;
        document.fonts.add(face);
        setFamily(fam);
      })
      .catch(() => setFamily(null));
    return () => {
      gone = true;
    };
  }, [file]);

  // Checked once there's a file and the licence is declared: the checks are the server's.
  useEffect(() => {
    if (!file || !licence) return;
    let gone = false;
    setBusy(true);
    setError(null);
    merchant
      .uploadFont(file, { name, usedFor, licenceDeclared: true })
      .then((f) => !gone && setFont(f))
      .catch((e) => !gone && (setFont(null), setError(errorSentence(e))))
      .finally(() => !gone && setBusy(false));
    return () => {
      gone = true;
    };
    // The Used for choice is applied when it's used, not re-uploaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, licence, merchant, name]);

  const passed = font?.checks.glyphs === 'passed' && font.checks.legibility === 'passed';
  const chip = (state: 'passed' | 'failed' | undefined) =>
    state ? (
      <span className={cx('c-chip', state === 'passed' ? 'c-settled' : 'c-neutral')}>
        <span className="c-core" />
        {state === 'passed' ? 'Passed' : 'Failed'}
      </span>
    ) : null;
  const fam = family ? `'${family}', 'Fraunces', Georgia, serif` : undefined;
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-w460"
      title="Upload a font"
      onClose={onClose}
      foot={
        <Foot det="Converted to WOFF2 and served with your app.">
          <button type="button" className="c-btn c-btn-primary" disabled={!passed || busy} onClick={() => font && void onUse(font, usedFor)}>
            Use this font
          </button>
        </Foot>
      }
    >
      <input ref={input} type="file" accept=".woff2,.otf,.ttf,font/woff2,font/otf,font/ttf" hidden onChange={(e) => (setFont(null), setFile(e.target.files?.[0] ?? null))} />
      <div className="c-sa-drop" role="button" tabIndex={0} onKeyDown={clickOnKey} onClick={() => input.current?.click()} style={{ cursor: 'pointer' }}>
        <p className="c-t">{file ? file.name : 'Choose a font file'}</p>
        <p className="c-det">{file ? `${sizeLabel(file.size)} · ` : ''}WOFF2, OTF or TTF up to 1 MB</p>
      </div>
      <p className="c-sa-fprev" style={fam ? { fontFamily: fam } : undefined}>
        {sample[0]}
      </p>
      <p className="c-sa-fprev c-sm" style={fam ? { fontFamily: fam } : undefined}>
        {sample[1]}
      </p>
      <Rows style={{ marginTop: 'var(--s2)' }}>
        <R2
          t="Letters and numbers"
          det={font?.checks.glyphs === 'failed' ? `Missing ${font.checks.missing.slice(0, 12).join(' ')}` : `A–Z, a–z, 0–9, accents and $${font ? ' · all present' : ''}`}
          end={chip(font?.checks.glyphs)}
        />
        <R2 t="Readable small" det="Checked at 14px on the menu and rewards" end={chip(font?.checks.legibility)} />
        <R2 t="Used for" det="Headings, the shop name and points. Not amounts" end={<Seg label="Used for" options={['Headings', 'Everything']} on={usedFor === 'headings' ? 0 : 1} onPick={(i) => setUsedFor(i === 0 ? 'headings' : 'everything')} />} />
        <Switch t="You have the right to use it" det="In an app and on the web. Most bought fonts need a web licence" on={licence} onChange={setLicence} />
      </Rows>
      {busy && <p className="c-det" style={{ marginTop: 12 }}>Checking the font…</p>}
      <Err error={error} />
    </Sheet>
  );
}

// ---- Add a boost, a custom colour, Preview an order -----------------------------------------------

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function BoostSheet({ categories, onAdd, onClose }: { categories: string[]; onAdd: (b: EarnRules['boosts'][number]) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState('');
  const [times, setTimes] = useState(1);
  const [scope, setScope] = useState(0);
  const [days, setDays] = useState<number[]>([1]);
  const [from, setFrom] = useState('14:00');
  const [to, setTo] = useState('17:00');
  const [cats, setCats] = useState<number[]>([]);
  const multiplier = [1.5, 2, 3][times]!;
  const ok = name.trim().length > 0 && (scope === 2 ? cats.length > 0 : days.length > 0) && (scope !== 1 || from < to);
  const add = () =>
    void onAdd({
      id: `bst_${Date.now().toString(36)}`,
      name: name.trim(),
      multiplier,
      on: true,
      scope: scope === 0 ? { kind: 'days', days } : scope === 1 ? { kind: 'hours', days, span: { from, to } } : { kind: 'categories', categories: cats.map((i) => categories[i]!) },
    });
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-w460"
      title="Add a boost"
      onClose={onClose}
      foot={
        <Foot det="Only the biggest boost that applies counts.">
          <button type="button" className="c-btn c-btn-primary" disabled={!ok} onClick={add}>
            Add boost
          </button>
        </Foot>
      }
    >
      <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
        Name
      </p>
      <input className="c-field c-st-in" aria-label="Name" placeholder="Double points · Tuesdays" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
      <p className="c-label c-st-fl">Multiplies by</p>
      <Seg label="Multiplies by" options={['1.5×', '2×', '3×']} on={times} onPick={setTimes} />
      <p className="c-label c-st-fl">When</p>
      <Seg label="When" options={['Some days', 'Some hours', 'Some items']} on={scope} onPick={setScope} />
      {scope < 2 ? (
        <>
          <p className="c-label c-st-fl">Days</p>
          <DayPicker days={days} onChange={setDays} />
        </>
      ) : (
        <>
          <p className="c-label c-st-fl">Categories</p>
          <div className="c-st-chips">
            {categories.map((c, i) => (
              <button key={c} type="button" className={cx('c-btn', cats.includes(i) && 'c-on')} aria-pressed={cats.includes(i)} onClick={() => setCats((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]))}>
                {c}
              </button>
            ))}
          </div>
        </>
      )}
      {scope === 1 && (
        <>
          <p className="c-label c-st-fl">Hours</p>
          <div className="c-st-two">
            <input className="c-field c-st-in" type="time" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input className="c-field c-st-in" type="time" aria-label="Until" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </>
      )}
    </Sheet>
  );
}

function DayPicker({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  return (
    <div className="c-st-chips">
      {WEEK.map((d, i) => (
        <button key={d} type="button" className={cx('c-btn', days.includes(i) && 'c-on')} aria-pressed={days.includes(i)} onClick={() => onChange(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}>
          {d}
        </button>
      ))}
    </div>
  );
}

function ColourSheet({ brand, onSave, onClose }: { brand: Brand; onSave: (c: Pick<Brand, 'colour' | 'onColour' | 'paper' | 'paper2'>) => Promise<void>; onClose: () => void }) {
  const [c, setC] = useState({ colour: brand.colour, onColour: brand.onColour, paper: brand.paper, paper2: brand.paper2 });
  const hex = (v: string) => /^#[0-9A-Fa-f]{6}$/.test(v);
  const valid = Object.values(c).every(hex);
  const problems = valid ? brandContrast(c) : ['Each colour is # and six digits, like #B4532A.'];
  const field = (key: keyof typeof c, label: string) => (
    <div key={key}>
      <p className="c-label c-st-fl">{label}</p>
      <div className="c-st-two">
        <input className="c-field c-st-in" aria-label={label} value={c[key]} maxLength={7} onChange={(e) => setC({ ...c, [key]: e.target.value.trim() })} />
        <span aria-hidden="true" style={{ display: 'block', height: 40, background: hex(c[key]) ? c[key] : 'transparent', border: '1px solid var(--ink-13)' }} />
      </div>
    </div>
  );
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-w460"
      title="Your own colours"
      onClose={onClose}
      foot={
        <Foot det={problems[0] ?? 'Checked for contrast before it saves.'}>
          <button type="button" className="c-btn c-btn-primary" disabled={problems.length > 0} onClick={() => void onSave(c)}>
            Use these
          </button>
        </Foot>
      }
    >
      {field('colour', 'Your colour')}
      {field('onColour', 'Text on it')}
      {field('paper', 'Paper')}
      {field('paper2', 'Deeper paper')}
    </Sheet>
  );
}

function PreviewOrderSheet({ rules, word, onClose }: { rules: EarnRules; word: (n: number) => string; onClose: () => void }) {
  const [text, setText] = useState('24.00');
  const cents = Math.max(0, Math.round(Number(text.replace(/[^0-9.]/g, '')) * 100) || 0);
  const at = { weekday: (new Date().getDay() + 6) % 7, time: new Date().toTimeString().slice(0, 5) };
  const earn = (clear: boolean) => earnPoints({ rules, lines: [{ netCents: cents, category: null }], at, clearCents: clear ? cents : 0, paidCents: cents, carryCents: 0, stampedToday: false }).points;
  const plain = earn(false);
  const clear = earn(true);
  return (
    <Sheet className="c-st-sheet c-tm-sheet c-w420" title="Preview an order" onClose={onClose} foot={<p className="c-det">Counted before tax and tip, at today’s boosts.</p>}>
      <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
        They pay
      </p>
      <input className="c-field c-st-in" inputMode="decimal" aria-label="They pay" value={text} onChange={(e) => setText(e.target.value)} />
      <Rows style={{ marginTop: 'var(--s2)' }}>
        <R2 t="Card or cash" det="What it earns" end={<b>{`${plain} ${word(plain)}`}</b>} />
        <R2 t="Paying with Clear" det={rules.clearMultiplier > 1 ? `${rules.clearMultiplier}× for paying with Clear` : 'No extra for Clear'} end={<b>{`${clear} ${word(clear)}`}</b>} />
      </Rows>
    </Sheet>
  );
}


/**
 * Settings › Discounts › a code: whether the shop's app lists it under Offers, and to whom. Applying
 * it from the app is the code's own path; nothing else about the code changes here.
 */
export function OfferSheet({ code, onSave, onClose }: { code: DiscountCode; onSave?: (input: { showInApp: boolean; audience: NonNullable<DiscountCode['audience']> }) => Promise<boolean>; onClose: () => void }) {
  const [show, setShow] = useState(code.showInApp ?? false);
  const [audience, setAudience] = useState<NonNullable<DiscountCode['audience']>>(code.audience ?? 'everyone');
  const [busy, setBusy] = useState(false);
  const AUDIENCES = ['everyone', 'members', 'clear_members'] as const;
  const changed = show !== (code.showInApp ?? false) || audience !== (code.audience ?? 'everyone');
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-w420"
      title={code.code}
      onClose={onClose}
      foot={
        <Foot det="Codes still work at checkout either way.">
          <button
            type="button"
            className="c-btn c-btn-primary"
            disabled={busy || !changed}
            onClick={async () => {
              if (!onSave) return onClose();
              setBusy(true);
              const ok = await onSave({ showInApp: show, audience });
              setBusy(false);
              if (ok) onClose();
            }}
          >
            Save
          </button>
        </Foot>
      }
    >
      <Rows>
        <Switch t="Show in app" det="Listed under Offers in your app, in the order you choose in Shop app" on={show} onChange={setShow} />
      </Rows>
      <p className="c-label c-st-fl">Who sees it</p>
      <Chips options={['Everyone', 'Members', 'Clear members']} value={AUDIENCES.indexOf(audience)} onPick={(i) => setAudience(AUDIENCES[i]!)} />
      <p className="c-det" style={{ marginTop: 8 }}>
        Members are people who joined your rewards. Clear members also pay with Clear.
      </p>
    </Sheet>
  );
}
