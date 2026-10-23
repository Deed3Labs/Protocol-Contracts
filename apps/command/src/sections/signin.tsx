// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { LIVE } from '../live/env';
import { BrandMark } from '../App';
import { attrs, css, html } from '../runtime/dom';
import { closePf } from './core';
import { KEY, ROLES, S, SG } from './data';
import { closeModal, go, setWho, vLevel } from './shell';
export function sgnArt() {
  /* the squares motif, decorative: a band of people and shops */
  const rows = 12,
    cols = 24,
    n = rows * cols,
    cut = [0.36, 0.43, 0.62];
  let h = [];
  for (let i = 0; i < n; i++) {
    const f = i / n;
    h.push(<i className={f < cut[0] ? 'a' : f < cut[1] ? 'b' : f < cut[2] ? 'c' : ''} />);
  }
  return (
    <div className="sgn-art" style={css(`--r:${rows}`)} aria-hidden="true">
      {h}
    </div>
  );
}
export function sgnBody() {
  const s = SG.step;
  if (s === 'passkey')
    return (
      <>
        <div className="sgn-hd">
          <span className="lbl">Passkey</span>
          <h1 className="h1">Confirm it’s you.</h1>
          <p>Use your fingerprint, face or device PIN when your browser asks.</p>
        </div>
        <div className="sgn-wait">
          <span className="dot pulse" />
          <span>
            <b>Waiting for your passkey</b>
            <span className="small quiet">This page moves on by itself</span>
          </span>
        </div>
        <div className="sgn-row">
          <button type="button" className="sgn-link" data-sgn="back">
            Use a code by email instead
          </button>
        </div>
      </>
    );
  if (s === 'code' || s === 'verify')
    return (
      <>
        <div className="sgn-hd">
          <span className="lbl">Check your email</span>
          <h1 className="h1">Enter the code.</h1>
          <p>
            {'We sent a 6-digit code to '}
            <b style={css('color:var(--fg)')}>{SG.email}</b>. It works for 10 minutes.
          </p>
        </div>
        <div className="sgn-f">
          <div className="sgn-code" id="sgnCode">
            {[0, 1, 2, 3, 4, 5].map((i, __k) => (
              <input
                key={__k}
                inputMode="numeric"
                autoComplete={i ? 'off' : 'one-time-code'}
                maxLength="1"
                aria-label={`Digit ${i + 1}`}
                {...attrs(s === 'verify' ? ' disabled' : '')}
              />
            ))}
          </div>
          {s === 'verify' ? (
            <div className="sgn-wait">
              <span className="dot pulse" />
              <span>
                <b>Checking the code</b>
                <span className="small quiet">Then you’re in</span>
              </span>
            </div>
          ) : (
            ''
          )}
          <div className="sgn-row">
            <button type="button" className="sgn-link" data-sgn="back">
              Use a different email
            </button>
            <button type="button" className="sgn-link" data-sgn="resend" id="sgnResend" disabled>
              Resend in 0:30
            </button>
          </div>
        </div>
      </>
    );
  if (s === 'terms')
    return (
      <>
        <div className="sgn-hd">
          <span className="lbl">Data room · first sign-in</span>
          <h1 className="h1">Before you look.</h1>
          <p>You have read-only access to Clear’s numbers, contracts, votes and records until {LIVE && SG.until ? SG.until : '21 Nov'}. It’s shared with you in confidence.</p>
        </div>
        <div className="sgn-kv sgn-terms">
          <span>Keep it confidential</span>
          <span>Don’t share or copy what you see</span>
          <span>What’s logged</span>
          <span>Every page you open</span>
          <span>Access ends</span>
          <span>{LIVE && SG.until ? SG.until : '21 Nov'}, unless Clear extends it</span>
          <span>Questions</span>
          <span>kai@useclear.org</span>
        </div>
        <div className="sgn-f">
          <button type="button" className="btn btn-p" data-sgn="terms-ok">
            I agree · open the data room
          </button>
          <button type="button" className="sgn-link" data-sgn="back" style={css('align-self:flex-start')}>
            Not now
          </button>
        </div>
      </>
    );
  if (s === 'done')
    return SG.who ? (
      <div className="sgn-hd">
        <span className="lbl">
          {'Signed in · '}
          {ROLES[SG.view.g][0]}
        </span>
        <h1 className="h1">
          {'Welcome, '}
          {SG.who}.
        </h1>
        <p>
          {SG.view.g === 'members'
            ? 'You have the member view: co-op totals, contracts, votes and records. Read-only.'
            : SG.view.g === 'investors'
              ? 'You have the data room: co-op numbers, contracts, votes and records. Read-only.'
              : `You have ${ROLES[SG.view.g][0]} access.`}
        </p>
      </div>
    ) : (
      <div className="sgn-hd">
        <span className="lbl">Signed in · Admin</span>
        <h1 className="h1">Welcome back, {LIVE ? SG.name : 'Kai'}.</h1>
        <p>Opening the Command Center.</p>
      </div>
    );
  return (
    <>
      <div className="sgn-hd">
        <span className="lbl">Clear co-op</span>
        <h1 className="h1">Sign in to the Command Center.</h1>
        <p>Use your Clear app login. Every member gets a read-only view; the team sees what their group allows.</p>
      </div>
      <div className="sgn-f">
        <button type="button" className="btn btn-p" data-sgn="passkey">
          {KEY}Sign in with a passkey
        </button>
        <div className="sgn-or small">or</div>
        <form className="sgn-f" id="sgnForm" noValidate>
          <label className="sgn-in" id="sgnIn">
            <span className="lbl">Email on your Clear account</span>
            <input id="sgnEmail" type="email" autoComplete="username" placeholder="you@example.com" defaultValue={SG.email} />
            <span className="sgn-err">Enter your email.</span>
          </label>
          <button type="submit" className="btn btn-g">
            Email me a code
          </button>
        </form>
        {/* Members who joined with a phone, Google or Apple have no passkey or email here (DECISIONS). */}
        {LIVE ? (
          <div className="sgn-row">
            <button type="button" className="sgn-link" data-sgn="other">
              Other ways to sign in
            </button>
          </div>
        ) : (
          ''
        )}
        <label className="sgn-keep">
          <input type="checkbox" id="sgnKeep" {...attrs(SG.keep ? ' checked' : '')} />
          Keep me signed in on this device for 12 hours
        </label>
      </div>
    </>
  );
}
export function sgnDraw() {
  const root = document.getElementById('loginRoot');
  html(
    root,
    <div className="sgn" role="main">
      <div className="sgn-l">
        <div className="sgn-brand">
          <BrandMark />
          <b>Command Center</b>
          <span className="chip underway">
            <span className="dot" />
            Testnet
          </span>
        </div>
        <div className="sgn-mn" aria-live="polite">
          {sgnBody()}
        </div>
        <div className="sgn-ft">
          <span>Every sign-in is logged with the device and place</span>
        </div>
      </div>
      <aside className="sgn-r">
        {sgnArt()}
        <div className="sgn-facts">
          <span className="lbl">Before you sign in</span>
          <div className="sgn-kv">
            <span>Who can sign in</span>
            <span>Every member, and the team</span>
            <span>How</span>
            <span>Your Clear app login</span>
            <span>Members see</span>
            <span>Totals, contracts, votes, records</span>
            <span>Investors and lenders</span>
            <span>The same, as a data room</span>
            <span>The team sees</span>
            <span>What their group allows</span>
            <span>Money and on-chain actions</span>
            <span>Always need a second person</span>
          </div>
        </div>
      </aside>
    </div>,
  );
  if (SG.step === 'code') {
    const ins = root.querySelectorAll('#sgnCode input');
    ins[0].focus();
    sgnTimer(30);
  }
}
export function sgnTimer(n) {
  clearInterval(SG.t);
  SG.left = n;
  const tick = () => {
    const b = document.getElementById('sgnResend');
    if (!b) {
      clearInterval(SG.t);
      return;
    }
    if (SG.left <= 0) {
      b.disabled = false;
      b.textContent = 'Resend the code';
      clearInterval(SG.t);
      return;
    }
    b.disabled = true;
    b.textContent = `Resend in 0:${String(SG.left).padStart(2, '0')}`;
    SG.left--;
  };
  tick();
  SG.t = setInterval(tick, 1000);
}
export function sgnStep(s) {
  SG.step = s;
  sgnDraw();
}
export function sgnIn() {
  if (SG.view && SG.view.terms) return sgnStep('terms');
  sgnStep('done');
  setTimeout(() => {
    hideLogin();
    if (SG.view) {
      S.view = Object.assign(
        {
          preview: false,
        },
        SG.view,
      );
      setWho(SG.view.who, ROLES[SG.view.g][0].replace(/s$/, ''));
    } else {
      S.view = null;
      setWho(LIVE ? SG.name : 'Kai', 'Admin');
    }
    go(S.view ? (vLevel('home') > 0 ? 'home' : 'growth') : 'home');
  }, 1100);
}
export function showLogin() {
  closeModal();
  closePf && closePf();
  SG.step = 'start';
  SG.who = null;
  SG.view = null;
  S.view = null;
  document.body.classList.add('signed-out');
  sgnDraw();
  try {
    history.replaceState(null, '', '#login');
  } catch (e) {}
}
export function hideLogin() {
  document.body.classList.remove('signed-out');
  html(document.getElementById('loginRoot'), '');
  clearInterval(SG.t);
}
