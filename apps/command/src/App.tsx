import { css } from './runtime/dom';

/** The Clear mark at app sizes (the solid mark, drawn in the current colour). */
export function BrandMark() {
  return (
    <svg viewBox="0 0 336 336" role="img" aria-label="Clear">
      <g transform="translate(168 168)" fill="currentColor" stroke="currentColor">
        <path d="M 148.28 -64 A 161.5 161.5 0 1 0 148.28 64 L 74.22 64 A 98 98 0 1 1 74.22 -64 Z" strokeWidth="4" />
        <path d="M 0 -8 H 114 V 8 H 0 Z" stroke="none" />
        <circle cx="0" cy="0" r="34" stroke="none" />
        <circle cx="131.5" cy="0" r="25.25" strokeWidth="15.5" fill="none" />
      </g>
    </svg>
  );
}

/**
 * The shell's fixed parts, drawn once. The menu (`#railNav`), the page (`#main`), the phone tabs
 * (`#tabs`) and the name in the top bar (`.who-n`) are left empty here: the sections draw into them.
 */
export function App() {
  return (
    <>
      <header className="top">
        <div className="brand">
          <BrandMark />
          <b>Command Center</b>
        </div>
        <div className="top-main">
          <label className="search" htmlFor="q">
            <svg className="i sm" viewBox="0 0 20 20">
              <circle cx="9" cy="9" r="5" />
              <path d="M13 13l4 4" />
            </svg>
            <input id="q" type="search" placeholder="Search members, shops, contracts" autoComplete="off" />
            <kbd>/</kbd>
          </label>
          <div className="top-r">
            <span className="chip underway" title="Data comes from the testnet and demo providers">
              <span className="dot" />
              Testnet
            </span>
            <button className="who" type="button" data-pf-open="" aria-haspopup="dialog" aria-expanded="false" aria-label="Your profile, settings and theme">
              <span className="av" aria-hidden="true">
                KK
              </span>
              <span className="small who-n" />
              <svg className="i sm who-c" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M6 8l4 4 4-4" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      <nav className="rail" aria-label="Sections">
        <div className="rail-main" id="railNav" />
        <div className="rail-ft">
          <button type="button" className="rail-tog" data-rail-tog="" aria-expanded="true" title="Collapse the menu ( [ )">
            <svg className="i" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M3.5 4v12" />
              <path d="M13 6l-4 4 4 4" />
              <path d="M9 10h8" />
            </svg>
            <span>Collapse</span>
            <kbd>[</kbd>
          </button>
          <button type="button" data-go="money" title="Plaid is 3h behind">
            <span className="dot" aria-hidden="true" />
            <span>
              <span style={css('color:var(--fg)')}>Plaid is 3h behind</span>
              <br />3 other feeds synced
            </span>
          </button>
        </div>
      </nav>
      <main className="main" id="main" tabIndex={-1} />
      <nav className="tabs" aria-label="Sections" id="tabs" />
    </>
  );
}
