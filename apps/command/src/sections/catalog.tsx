// @ts-nocheck: reads the sections' untyped data (src/sections/data.tsx), as the other section files do.
import { api, apiFile } from '../live/api';
import { LIVE } from '../live/env';
import { reloadSection } from '../live/sections';
import { css } from '../runtime/dom';
import { money } from './core';
import { CATALOG, vars } from './data';
import { kv, sec, vModal } from './governance';
import { stepFlow } from './kit';
import { render, toast } from './shell';
import { prOf } from './shop';

/*
 * The store's catalog in Command (docs/command-center-plan.md, Phase 11b), live only: the product
 * pane's "On the store" section, and the flows that change what the store sells: its details, a
 * variant, a colour or an option, whether it sells past what's on hand, and adding a product. The
 * API's actions are services/command/actions.ts (product-edit, variant-edit, colour-add…); live, a
 * price change on a product on the shelf waits for a second person.
 *
 * Money in the payload and in the actions' bodies is dollars.
 */

const STORE = 'useclear.org/shop/';
const SIZES = ['s', 'm', 'l', 'xl', 'xxl'];
const TONES = [
  ['ink', 'Dark'],
  ['paper', 'Light'],
  ['land', 'Land'],
];
const GOODS_KINDS = ['tee', 'tee-ls', 'turtleneck', 'hoodie', 'cap', 'tote', 'patch'];
const HW_KINDS = ['point', 'point-large', 'pay-case', 'tap', 'tap-phone', 'counter', 'drawer', 'printer', 'stand', 'panels', 'kit'];

export const catOf = (pid) => CATALOG[pid];
/** "logo-tee": lowercase letters, numbers and dashes, from what was typed. */
const slugOf = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
/** A typed amount of money: "$1,200.50" is 1200.5, nothing typed is null, anything else NaN. */
const num = (s) => {
  const t = String(s ?? '').replace(/[$,\s]/g, '');
  return t === '' ? null : /^\d*\.?\d+$|^\d+\.$/.test(t) ? Number(t) : NaN;
};
const val = (id) => (document.getElementById(id)?.value ?? '').trim();
const lines = (s) =>
  String(s)
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
const list = (s) =>
  String(s)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const fail = (m) => {
  throw new Error(m);
};
/** Every colour the catalog's products come in, once each: the palette a new product or colour picks from. */
const palette = () => {
  const m = new Map();
  for (const c of Object.values(CATALOG)) for (const col of c.colours || []) if (!m.has(col.id)) m.set(col.id, col);
  return [...m.values()];
};
/** What one variant sells for, as the store shows it. */
const variantPrice = (c, v) => {
  const price = v.price ?? c.price;
  return v.deposit != null ? `${money(v.deposit)} now · ${money(price)} in full` : money(price);
};

/* ── The product pane ─────────────────────────────────────────────────── */

/** What the store shows of a product in Command's catalog, with the ways to change it. */
export function storeSec(p) {
  const c = CATALOG[p.id];
  if (!c) return '';
  const edit = p.st !== 'arch';
  const hw = c.section === 'for-shops';
  const colours = c.colours || [];
  const Row = edit ? 'button' : 'div';
  const images = c.images || [];
  return sec(
    'On the store',
    <>
      {kv([
        ['Name', c.title],
        ['Under the name', c.tagline || '—'],
        ['Price', hw ? `${money(c.price)} · reserved with a deposit` : money(c.price)],
        ['Page', STORE + c.slug],
        ['Shelves', [c.category, ...(c.alsoIn || [])].filter(Boolean).join(' · ') || '—'],
        [hw ? 'Reserved for' : 'Ships', c.ships || '—'],
        ['Packed weight', c.weightOz ? `${c.weightOz} oz` : '—'],
        ['When it runs out', c.sellPastStock ? 'Keeps selling, made to order' : 'Shows sold out'],
        ...(c.featured ? [['Shelf', 'The large tile']] : []),
      ])}
      {c.description ? (
        <p className="quiet" style={css('margin:0')}>
          {c.description}
        </p>
      ) : (
        ''
      )}
      {c.details?.length ? (
        <ul className="quiet small" style={css('margin:0;padding-left:18px')}>
          {c.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      ) : (
        ''
      )}
      <div className="pn-list">
        <div className="pn-h">
          <span className="lbl">Photos</span>
          <span className="small quiet">{images.length ? 'The first is the one the shelf shows' : 'None yet: the shop draws it until there are'}</span>
        </div>
        {images.map((im, i) => (
          <div key={im.src} className="pn-r">
            <img src={im.src} alt="" width={56} height={56} style={css('width:56px;height:56px;object-fit:cover;flex:none;box-shadow:inset 0 0 0 1px var(--line)')} />
            <span className="pn-k">
              <b>{im.alt || 'No description'}</b>
              <span className="small quiet">{i === 0 ? 'First' : `${i + 1} of ${images.length}`}</span>
            </span>
            {edit ? (
              <span className="pn-a">
                {i > 0 ? (
                  <button type="button" className="pn-link" onClick={() => send([['photo-move', { id: p.id, src: im.src, to: 0 }]], null, 'It’s the first photo now.')}>
                    First
                  </button>
                ) : (
                  ''
                )}
                <button type="button" className="pn-link" data-kflow="photo" data-sid={p.id} data-ksrc={im.src}>
                  Describe
                </button>
                <button type="button" className="pn-link" onClick={() => send([['photo-remove', { id: p.id, src: im.src }]], null, 'Taken off the store.')}>
                  Take off
                </button>
              </span>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
      {colours.length ? (
        <div className="pn-list">
          <div className="pn-h">
            <span className="lbl">Colours</span>
          </div>
          {colours.map((col) => (
            <div key={col.id} className="pn-r">
              <i className="sw-c" style={css(`background:${col.swatch}`)} />
              <span className="pn-k">
                <b>{col.label}</b>
                <span className="small quiet">{col.swatch}</span>
              </span>
              {edit && colours.length > 1 ? (
                <button type="button" className="pn-link" data-kflow="colour-remove" data-sid={p.id} data-kcol={col.id}>
                  Take off
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      ) : (
        ''
      )}
      <div className="pn-list">
        <div className="pn-h">
          <span className="lbl">{c.variantLabel || 'Options'}</span>
          <span className="small quiet">Price · on hand</span>
        </div>
        {(c.variants || []).map((v) => (
          <Row key={v.id} {...(edit ? { type: 'button', 'data-kflow': 'variant', 'data-sid': p.id, 'data-kvar': v.id } : {})} className="pn-r">
            <span className="pn-k">
              <b>{v.label}</b>
              <span className="small quiet">
                {variantPrice(c, v)}
                {v.per ? ` ${v.per}` : ''}
              </span>
            </span>
            <span className="num">{v.soldOut ? <span className="chip absent">Sold out</span> : v.onHand == null ? '—' : v.onHand}</span>
          </Row>
        ))}
      </div>
      {edit ? (
        <div className="pn-a">
          <label className="pn-link" style={css('cursor:pointer')}>
            Add photos
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => addPhotos(p, e.currentTarget)} />
          </label>
          {colours.length ? (
            <button type="button" className="pn-link" data-kflow="colour" data-sid={p.id}>
              Add a colour
            </button>
          ) : (
            <button type="button" className="pn-link" data-kflow="option" data-sid={p.id}>
              Add an option
            </button>
          )}
          <button
            type="button"
            className="pn-link"
            onClick={() =>
              send(
                [['product-edit', { ...base(p), sellPastStock: !c.sellPastStock }]],
                null,
                c.sellPastStock ? 'Each colour and size shows sold out when none are on hand.' : 'It keeps selling at 0, made to order.',
              )
            }
          >
            {c.sellPastStock ? 'Stop at what’s on hand' : 'Keep selling at 0'}
          </button>
        </div>
      ) : (
        ''
      )}
    </>,
    edit ? (
      <button type="button" className="pn-link" data-kflow="details" data-sid={p.id}>
        Edit
      </button>
    ) : (
      ''
    ),
  );
}

/** The largest photo the site's store takes in one go (a Vercel function's body tops out at 4.5 MB). */
const MAX_PHOTO = 4 * 1024 * 1024;
/**
 * Uploads the photos picked, one after another (each stored in the site's Blob store, then added to the
 * catalog), and says how it went. One too big or of the wrong kind is skipped, and said so.
 */
export async function addPhotos(p, input) {
  const files = [...(input.files || [])];
  input.value = '';
  if (!files.length || !LIVE) return;
  const skipped = files.filter((f) => f.size > MAX_PHOTO || !['image/jpeg', 'image/png', 'image/webp'].includes(f.type));
  const ok = files.filter((f) => !skipped.includes(f));
  let added = 0;
  toast(`Uploading ${ok.length} photo${ok.length === 1 ? '' : 's'}…`);
  try {
    for (const f of ok) {
      const { src } = await apiFile(`/shop/photos/${p.id}?name=${encodeURIComponent(f.name)}`, f);
      await api('POST', '/actions/shop/photo-add', { id: p.id, src });
      added++;
    }
  } catch (e) {
    toast(e.message);
  } finally {
    await reloadSection('shop').catch(() => undefined);
    render();
  }
  if (added || skipped.length)
    toast([added ? `Added ${added} photo${added === 1 ? '' : 's'}` : '', skipped.length ? `${skipped.length} skipped: a photo is a JPEG, PNG or WebP up to 4 MB` : ''].filter(Boolean).join(' · '));
}

/** product-edit's required half: Command's shelf labels and the price as they are. */
const base = (p) => ({ id: p.id, name: p.n, variant: p.v, price: CATALOG[p.id].price, cost: null });

/* ── Saving ───────────────────────────────────────────────────────────── */

/**
 * Runs the actions one after another, then reloads Shop. One that waits for a second person says so;
 * `f` is the open flow (null for a change made straight from the pane).
 */
function send(calls, f, said) {
  if (!LIVE) return f ? stepFlow('Working', f.steps, f.done, () => render()) : undefined;
  const b = document.querySelector('#modalRoot [data-vgo]');
  if (b) b.disabled = true;
  (async () => {
    const rs = [];
    try {
      for (const [kind, body] of calls) rs.push(await api('POST', `/actions/shop/${kind}`, body));
    } finally {
      await reloadSection('shop').catch(() => undefined);
    }
    return rs;
  })().then(
    (rs) => {
      const waiting = rs.some((r) => r.proposal);
      if (waiting) import('../live/account').then((m) => m.loadWaiting()).catch(() => undefined);
      if (!f) return toast(waiting ? 'Sent for a second person · it changes once someone else approves it' : said || 'Saved');
      stepFlow('Working', f.steps, waiting ? ['Sent for a second person.', 'The store’s price changes once someone else approves it in Needs you.'] : f.done, () => render());
    },
    (e) => {
      if (b) b.disabled = false;
      toast(e.message);
    },
  );
}
/** Reads the flow's fields into its calls, or says what's missing. */
function submit(f, calls) {
  let seq;
  try {
    seq = calls();
  } catch (e) {
    return toast(e.message);
  }
  send(seq, f);
}

/* ── The flows ────────────────────────────────────────────────────────── */

/** The open flow: which, for what, and what's been picked in it. Typed fields survive a redraw. */
const KF = { kind: '', pid: '', vid: '', col: '', src: '', sold: 'sale', tone: 'ink', section: 'goods', pkind: 'tee', colours: new Set(), sizes: new Set(SIZES), featured: false };

export function openCatFlow(kind, pid = '', ds = {}) {
  vars.lastFocus = document.activeElement;
  const c = CATALOG[pid];
  const v = c?.variants?.find((x) => x.id === ds.kvar);
  Object.assign(KF, { kind, pid: pid || '', vid: ds.kvar ?? '', col: ds.kcol ?? '', src: ds.ksrc ?? '', sold: v?.soldOut ? 'out' : 'sale', tone: 'ink', featured: !!c?.featured });
  if (kind === 'add')
    Object.assign(KF, {
      section: 'goods',
      pkind: 'tee',
      colours: new Set(
        palette()
          .slice(0, 1)
          .map((x) => x.id),
      ),
      sizes: new Set(SIZES),
    });
  draw();
}
function draw() {
  const f = build();
  if (f) vModal(f, 'k:' + KF.kind);
}
function redraw() {
  const kept = [...document.querySelectorAll('#modalRoot input[id], #modalRoot textarea[id]')].map((x) => [x.id, x.value]);
  draw();
  for (const [id, v] of kept) {
    const el = document.getElementById(id);
    if (el) el.value = v;
  }
}

const field = (id, label, value, extra = {}) => (
  <label className="field">
    <span className="lbl">{label}</span>
    <input type="text" id={id} defaultValue={value ?? ''} autoComplete="off" {...extra} />
  </label>
);
const area = (id, label, value, rows = 3) => (
  <label className="field">
    <span className="lbl">{label}</span>
    <textarea id={id} rows={rows} defaultValue={value ?? ''} />
  </label>
);
/** One choice of a few, saved in KF[key]. */
function seg(opts, cur, key, aria) {
  return (
    <div className="seg2" role="group" aria-label={aria}>
      {opts.map(([v, t]) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={v === cur}
          onClick={() => {
            KF[key] = v;
            redraw();
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
/** Several choices, each a toggle in the set KF[key]. */
function toggles(opts, key, aria) {
  return (
    <div className="seg2" role="group" aria-label={aria}>
      {opts.map(([v, t]) => (
        <button
          key={v}
          type="button"
          aria-pressed={KF[key].has(v)}
          onClick={(e) => {
            KF[key].has(v) ? KF[key].delete(v) : KF[key].add(v);
            e.currentTarget.setAttribute('aria-pressed', String(KF[key].has(v)));
            if (key === 'colours') redraw();
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
/** A price typed, or none when it's left empty and `optional`. */
function price(id, what, optional = false) {
  const v = num(val(id));
  if (v == null && optional) return null;
  if (v == null || !isFinite(v) || v <= 0) fail(`Type ${what}`);
  return v;
}
const live = (p) => p?.st === 'on';

function build() {
  const p = KF.pid ? prOf(KF.pid) : null;
  const c = KF.pid ? CATALOG[KF.pid] : null;
  const k = KF.kind;
  if (k === 'details' && p && c) return detailsFlow(p, c);
  if (k === 'variant' && p && c) {
    const v = c.variants.find((x) => x.id === KF.vid);
    if (!v) return null;
    const hw = c.section === 'for-shops';
    const f = {
      t: 'Edit a variant',
      lbl: c.title,
      h: v.label,
      p: live(p) ? 'A change to its price or deposit waits for a second person while it’s on the shelf.' : 'It changes on the store at once.',
      pre: (
        <>
          {v.colour ? '' : field('kf-label', 'Name', v.label)}
          <div className="f2">
            {field('kf-price', `Price · empty is ${money(c.price)}`, v.price == null ? '' : money(v.price), { inputMode: 'decimal' })}
            {hw ? field('kf-dep', 'Deposit now', v.deposit == null ? '' : money(v.deposit), { inputMode: 'decimal' }) : field('kf-per', 'After the price · empty is “each”', v.per ?? '')}
          </div>
          <span className="lbl">On the store</span>
          {seg(
            [
              ['sale', 'For sale'],
              ['out', 'Sold out'],
            ],
            KF.sold,
            'sold',
            'On the store',
          )}
        </>
      ),
      rows: [['On hand', v.onHand == null ? '—' : String(v.onHand), 1]],
      post: v.colour ? (
        ''
      ) : (
        <div className="pn-a">
          <button type="button" className="pn-link" onClick={() => send([['variant-remove', { id: p.id, variant: v.id }]], f)}>
            Take it off
          </button>
        </div>
      ),
      btn: 'Save it',
      steps: ['Saved the variant', 'Told the store'],
      done: ['Saved.', 'The store shows it within a minute.'],
    };
    f.go = () =>
      submit(f, () => {
        const pr = price('kf-price', 'a price, or leave it empty', true);
        const dep = hw ? price('kf-dep', 'a deposit, or leave it empty', true) : undefined;
        return [
          [
            'variant-edit',
            {
              id: p.id,
              variant: v.id,
              ...(v.colour ? {} : { label: val('kf-label') || fail('Type its name') }),
              price: pr,
              ...(hw ? { deposit: dep } : { per: val('kf-per') || null }),
              soldOut: KF.sold === 'out',
            },
          ],
        ];
      });
    return f;
  }
  if (k === 'colour' && p && c) {
    const known = palette().filter((x) => !c.colours.some((y) => y.id === x.id));
    const f = {
      t: 'Add a colour',
      lbl: c.title,
      h: 'A new colour',
      p: c.variants.some((v) => v.size) ? `It comes in each of its sizes, with nothing on hand yet.` : 'It’s a new option to pick, with nothing on hand yet.',
      pre: (
        <>
          {known.length ? (
            <>
              <span className="lbl">One the shop already makes</span>
              <div className="seg2" role="group" aria-label="Colours">
                {known.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => {
                      document.getElementById('kf-name').value = x.label;
                      document.getElementById('kf-swatch').value = x.swatch;
                      KF.tone = x.tone;
                      redraw();
                    }}
                  >
                    <i className="sw-c" style={css(`background:${x.swatch}`)} /> {x.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            ''
          )}
          <div className="f2">
            {field('kf-name', 'Name', '', { placeholder: 'Navy' })}
            {field('kf-swatch', 'Swatch', '', { placeholder: '#252B3B' })}
          </div>
          <span className="lbl">Drawn on</span>
          {seg(TONES, KF.tone, 'tone', 'Drawn on')}
        </>
      ),
      btn: 'Add it',
      steps: ['Added the colour', 'Added its sizes, with nothing on hand', 'Told the store'],
      done: ['Added.', 'It shows on the store once it’s on the shelf.'],
    };
    f.go = () =>
      submit(f, () => {
        const label = val('kf-name') || fail('Type the colour’s name');
        const swatch = val('kf-swatch').toUpperCase();
        if (!/^#[0-9A-F]{6}$/.test(swatch)) fail('A swatch is a colour like #252B3B');
        return [['colour-add', { id: p.id, colour: { id: slugOf(label), label, swatch, tone: KF.tone } }]];
      });
    return f;
  }
  if (k === 'colour-remove' && p && c) {
    const col = c.colours.find((x) => x.id === KF.col);
    if (!col) return null;
    const f = {
      t: 'Take a colour off',
      lbl: c.title,
      h: `Take off ${col.label}?`,
      p: 'Its sizes leave the store. While any are on hand, it stays.',
      rows: [['Sizes', String(c.variants.filter((v) => v.colour === col.id).length), 1]],
      btn: 'Take it off',
      steps: ['Took the colour off', 'Told the store'],
      done: ['Taken off.', 'Add it again any time.'],
    };
    f.go = () => submit(f, () => [['colour-remove', { id: p.id, colour: col.id }]]);
    return f;
  }
  if (k === 'option' && p && c) {
    const hw = c.section === 'for-shops';
    const f = {
      t: 'Add an option',
      lbl: c.title,
      h: `A new ${String(c.variantLabel || 'option').toLowerCase()}`,
      p: live(p) ? 'With a price of its own, it waits for a second person while the product’s on the shelf.' : 'It shows on the store at once.',
      pre: (
        <>
          {field('kf-label', 'Name', '', { placeholder: hw ? 'Counter' : 'Circle' })}
          <div className="f2">
            {field('kf-price', `Price · empty is ${money(c.price)}`, '', { inputMode: 'decimal' })}
            {hw ? field('kf-dep', 'Deposit now', '', { inputMode: 'decimal' }) : field('kf-per', 'After the price · empty is “each”', '')}
          </div>
        </>
      ),
      btn: 'Add it',
      steps: ['Added the option', 'Told the store'],
      done: ['Added.', 'It shows on the store with the rest.'],
    };
    f.go = () =>
      submit(f, () => [
        [
          'variant-add',
          {
            id: p.id,
            label: val('kf-label') || fail('Type its name'),
            price: price('kf-price', 'a price, or leave it empty', true),
            ...(hw ? { deposit: price('kf-dep', 'a deposit, or leave it empty', true) } : { per: val('kf-per') || null }),
          },
        ],
      ]);
    return f;
  }
  if (k === 'photo' && p && c) {
    const im = (c.images || []).find((x) => x.src === KF.src);
    if (!im) return null;
    const f = {
      t: 'Describe a photo',
      lbl: c.title,
      h: 'What it shows',
      p: 'Read aloud to someone who can’t see it, and shown if it doesn’t load.',
      pre: (
        <>
          <img src={im.src} alt="" style={css('width:100%;max-height:240px;object-fit:contain;background:var(--raised)')} />
          {field('kf-alt', 'Description', im.alt, { placeholder: 'The black Logo Tee, front, on a hanger' })}
        </>
      ),
      btn: 'Save it',
      steps: ['Saved the description', 'Told the store'],
      done: ['Saved.', 'The store shows it within a minute.'],
    };
    f.go = () => submit(f, () => [['photo-alt', { id: p.id, src: im.src, alt: val('kf-alt') || fail('Say what it shows') }]]);
    return f;
  }
  if (k === 'add') return addFlow();
  return null;
}

/** The store's details for one product: everything but its options, colours and photos. */
function detailsFlow(p, c) {
  const hw = c.section === 'for-shops';
  const f = {
    t: 'Edit the store’s details',
    lbl: STORE + c.slug,
    h: c.title,
    p: live(p) ? 'Its words change on the store at once. A new price waits for a second person while it’s on the shelf.' : 'It’s not on the shelf: everything changes at once.',
    pre: (
      <>
        {field('kf-title', 'Name on the store', c.title)}
        {field('kf-tag', 'Under the name', c.tagline)}
        {area('kf-desc', 'Description', c.description, 4)}
        {area('kf-details', 'Details · one a line', (c.details || []).join('\n'), 4)}
        <div className="f2">
          {field('kf-price', hw ? 'Price in full' : 'Price', money(c.price), { inputMode: 'decimal' })}
          {field('kf-weight', 'Packed weight, oz', c.weightOz ?? '', { inputMode: 'decimal' })}
        </div>
        <div className="f2">
          {field('kf-ships', hw ? 'Reserved for · a month' : 'Ships · a month', c.ships ?? '', { placeholder: 'Jan 2027' })}
          {field('kf-slug', 'Page address', c.slug)}
        </div>
        <div className="f2">
          {field('kf-cat', 'Shelf', c.category)}
          {field('kf-also', 'Also on · commas between', (c.alsoIn || []).join(', '))}
        </div>
        {hw ? (
          <>
            {area('kf-fcc', 'FCC notice · empty for none', c.fccNotice ?? '', 3)}
            {field('kf-founding', 'Founding partners note', c.founding ?? '')}
          </>
        ) : (
          ''
        )}
        <span className="lbl">On the shelf</span>
        {seg(
          [
            [false, 'A tile'],
            [true, 'The large tile'],
          ],
          KF.featured,
          'featured',
          'Tile',
        )}
      </>
    ),
    btn: 'Save changes',
    steps: ['Saved the details', 'Logged the old and new', 'Told the store'],
    done: ['Saved.', 'The store shows it within a minute.'],
  };
  f.go = () =>
    submit(f, () => {
      const slug = val('kf-slug');
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail('A page address is lowercase letters, numbers and dashes');
      const w = num(val('kf-weight'));
      if (w == null || !isFinite(w) || w <= 0) fail('Type its packed weight in ounces');
      return [
        [
          'product-edit',
          {
            ...base(p),
            price: price('kf-price', 'its price'),
            title: val('kf-title') || fail('Type its name'),
            tagline: val('kf-tag'),
            description: val('kf-desc'),
            details: lines(val('kf-details')),
            weightOz: w,
            ships: val('kf-ships') || null,
            slug,
            category: val('kf-cat'),
            alsoIn: list(val('kf-also')),
            featured: KF.featured,
            ...(hw ? { fccNotice: val('kf-fcc') || null, founding: val('kf-founding') || null } : {}),
          },
        ],
      ];
    });
  return f;
}

/** A new product, into the catalog as a draft. */
function addFlow() {
  const hw = KF.section === 'for-shops';
  const pal = palette();
  const inColours = !hw && KF.colours.size > 0;
  const kinds = hw ? HW_KINDS : GOODS_KINDS;
  if (!kinds.includes(KF.pkind)) KF.pkind = kinds[0];
  const f = {
    t: 'Add a product',
    lbl: 'The store’s catalog',
    h: 'A new product',
    p: 'It goes in as a draft: the store shows it only once it’s put on the shelf.',
    pre: (
      <>
        {seg(
          [
            ['goods', 'Goods'],
            ['for-shops', 'For shops'],
          ],
          KF.section,
          'section',
          'Section',
        )}
        {field('kf-title', 'Name', '', { placeholder: hw ? 'Clear Kiosk' : 'Logo Crewneck' })}
        {field('kf-slug', 'Page address · empty makes one from the name', '', { placeholder: 'logo-crewneck' })}
        <span className="lbl">Drawn as</span>
        {seg(
          kinds.map((x) => [x, x]),
          KF.pkind,
          'pkind',
          'Kind',
        )}
        {field('kf-tag', 'Under the name', '')}
        {area('kf-desc', 'Description', '', 3)}
        <div className="f2">
          {field('kf-price', hw ? 'Price in full' : 'Price', '', { inputMode: 'decimal' })}
          {hw ? field('kf-dep', 'Deposit now', '', { inputMode: 'decimal' }) : field('kf-weight', 'Packed weight, oz', '', { inputMode: 'decimal' })}
        </div>
        <div className="f2">
          {hw ? field('kf-weight', 'Packed weight, oz', '', { inputMode: 'decimal' }) : ''}
          {field('kf-ships', hw ? 'Reserved for · a month' : 'Ships · a month', '', { placeholder: 'Jan 2027' })}
          {field('kf-cat', 'Shelf', hw ? 'For shops' : 'Wear')}
        </div>
        {!hw && pal.length ? (
          <>
            <span className="lbl">Colours · none for a product without</span>
            {toggles(
              pal.map((x) => [x.id, x.label]),
              'colours',
              'Colours',
            )}
          </>
        ) : (
          ''
        )}
        {inColours ? (
          <>
            <span className="lbl">Sizes · none for one size</span>
            {toggles(
              SIZES.map((x) => [x, x.toUpperCase()]),
              'sizes',
              'Sizes',
            )}
          </>
        ) : (
          field('kf-options', 'Options · commas between, empty for one', '', { placeholder: hw ? 'Table, Counter' : 'Square, Circle' })
        )}
      </>
    ),
    btn: 'Add the draft',
    steps: ['Added it as a draft', 'Set its stock at 0', 'Reserved the page address'],
    done: ['Added as a draft.', 'Put it on the shelf once its photos and stock are in.'],
  };
  f.go = () =>
    submit(f, () => {
      const title = val('kf-title') || fail('Type its name');
      const slug = val('kf-slug') || slugOf(title);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail('A page address is lowercase letters, numbers and dashes');
      const w = num(val('kf-weight'));
      if (w == null || !isFinite(w) || w <= 0) fail('Type its packed weight in ounces');
      const colours = inColours ? pal.filter((x) => KF.colours.has(x.id)) : [];
      return [
        [
          'catalog-add',
          {
            title,
            slug,
            section: KF.section,
            kind: KF.pkind,
            category: val('kf-cat') || fail('Type its shelf'),
            tagline: val('kf-tag'),
            description: val('kf-desc'),
            price: price('kf-price', 'its price'),
            deposit: hw ? price('kf-dep', 'its deposit') : null,
            variantLabel: inColours && KF.sizes.size ? 'Size' : null,
            colours,
            sizes: inColours ? SIZES.filter((x) => KF.sizes.has(x)) : [],
            options: inColours ? [] : list(val('kf-options')),
            weightOz: w,
            ships: val('kf-ships') || null,
          },
        ],
      ];
    });
  return f;
}
