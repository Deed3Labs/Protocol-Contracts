/**
 * @useclear/js: Pay with Clear on any website. The shop's own button opens Clear's modal.
 *
 *   Clear("clear_pk_live_…").attach("#pay", {
 *     price: "price_tacotray12", quantity: 1,
 *     onSuccess: (p) => location.href = "/thanks?order=" + p.id,
 *   });
 *
 * The page gets `{ id, status, reference }` and nothing else. Fulfil from the `payment.succeeded`
 * webhook, not from `onSuccess`.
 */
import { makeConfig, type Config } from './config';
import { VERSION } from './constants';
import { start, type Env } from './controller';
import { domView } from './modal';
import { ignoredOptions, plan } from './options';
import type { Attachment, ClearConfig, ClearInstance, Target } from './types';

export type {
  Attachment, AttachOptions, Callbacks, ClearConfig, ClearError, ClearInstance, ModalOptions, PaymentMethod, PaymentResult, PayTarget, Target,
} from './types';

const NAME = 'Pay with Clear';

function browserEnv(): Env {
  return {
    fetch: (url, init) => fetch(url, init),
    location,
    listen(fn) {
      const handler = (e: MessageEvent) => fn(e);
      addEventListener('message', handler);
      return () => removeEventListener('message', handler);
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    report: (e) => setTimeout(() => {
      throw e;
    }),
    error: (m) => console.error(m),
  };
}

function attach(config: Config, target: Target, first?: unknown, second?: unknown): Attachment {
  const p = plan(first, second);
  if (p.problem) console.error(`${NAME}: ${p.problem}`);
  const ignored = ignoredOptions(first, second);
  if (ignored.includes('amount')) console.warn(`${NAME}: amount is ignored. The amount never comes from the page: use a price, or a payment your server makes.`);
  const others = ignored.filter((k) => k !== 'amount');
  if (others.length) console.warn(`${NAME}: ignoring ${others.join(', ')}.`);

  const openFrom = (from: Element | null) => {
    start(config, p, () => domView(from), browserEnv());
  };

  let selector: string | null = null;
  let elements: Element[] = [];
  if (typeof target === 'string') {
    try {
      const found = document.querySelector(target);
      selector = target;
      if (!found && document.readyState !== 'loading') console.warn(`${NAME}: nothing on the page matches "${target}" yet.`);
    } catch {
      console.error(`${NAME}: "${target}" isn't a CSS selector.`);
    }
  } else if (target instanceof Element) {
    elements = [target];
  } else if (target && typeof (target as ArrayLike<Element>).length === 'number') {
    elements = Array.from(target as ArrayLike<Element>).filter((e) => e instanceof Element);
  }
  if (!selector && !elements.length) console.error(`${NAME}: attach needs your button: a CSS selector, or the element.`);

  /** A click on the shop's element (or inside it): its own action is replaced by the modal. */
  const onClick = (e: Event) => {
    let from: Element | null = null;
    if (selector) {
      const t = e.target;
      from = t instanceof Element ? t.closest(selector) : null;
      if (!from) return;
    } else {
      from = e.currentTarget as Element;
    }
    e.preventDefault();
    openFrom(from);
  };

  if (selector) document.addEventListener('click', onClick);
  for (const e of elements) e.addEventListener('click', onClick);

  return {
    detach() {
      if (selector) document.removeEventListener('click', onClick);
      for (const e of elements) e.removeEventListener('click', onClick);
      selector = null;
      elements = [];
    },
    open() {
      openFrom(document.activeElement);
    },
  };
}

/**
 * `Clear(publishableKey)`: an instance for this page. Throws only here, for a key that can't be in a
 * page; nothing after this throws.
 */
function Clear(publishableKey: string, options?: ClearConfig): ClearInstance {
  const config = makeConfig(publishableKey, options);
  if (typeof config === 'string') throw new Error(`${NAME}: ${config}`);
  return {
    mode: config.mode,
    attach: ((target: Target, first?: unknown, second?: unknown) => attach(config, target, first, second)) as ClearInstance['attach'],
  };
}
Clear.version = VERSION;

export default Clear;
export { Clear };
