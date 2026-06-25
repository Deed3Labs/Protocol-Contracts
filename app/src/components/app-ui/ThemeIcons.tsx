import type { SVGProps } from 'react';

/**
 * Theme-switch icons matching the marketing site (useclear.org) — thin-stroke, 20px
 * viewBox geometric set used by its dark/dusk/light switcher. Stroke = currentColor.
 */

export function SunIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <circle cx="10" cy="10" r="3.5" />
      <path
        d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DuskIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2.5 14.5h15" />
      <path d="M6 14.5a4 4 0 0 1 8 0" />
      <path d="M10 4v2.2M4.6 6.6l1.4 1.5M15.4 6.6l-1.4 1.5M2.6 10.8h1.6M15.8 10.8h1.6" />
    </svg>
  );
}

export function MoonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path d="M17.5 12.5A7.5 7.5 0 1 1 7.5 2.5a5.5 5.5 0 0 0 10 10z" strokeLinejoin="round" />
    </svg>
  );
}
