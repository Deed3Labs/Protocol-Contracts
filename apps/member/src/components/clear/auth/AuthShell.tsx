import type { ReactNode } from 'react';
import { CFoot, CHead, CMain, Cell, SecHead } from '../brand/anatomy';
import Wordmark from '@/components/shell/Wordmark';
import { cn } from '@/lib/utils';

/**
 * The split shell — brand panel left, flow right, one seam between them.
 *
 * The flow panel is a component like any other: the step label is the header, the fields are main,
 * and the action with its fine print is the footer. Nothing inside either the header or the footer
 * draws its own rule, because the anatomy already draws both.
 *
 * The left panel is the only place in the app that uses Bricolage at statement size, and its copy
 * changes per step so the argument moves with the form. A phone drops it: there is no room to say
 * two things at once, and the statement is on the site the member just came from.
 *
 * Every step is one screen height, so the action sits on the floor of the screen at each of them
 * rather than wherever that step's fields happen to end.
 */
export default function AuthShell({
  statement,
  blurb,
  label,
  count,
  children,
  footer,
  footnote,
  /** Rides above the panel on the counter path: the visit's total, which is not part of any step. */
  pending,
  /** No brand column at any width — the counter path, where the shop's code made the argument. */
  solo,
}: {
  statement?: string;
  blurb?: string;
  /** The step marker: "1 · Enter". */
  label: ReactNode;
  /** "1 of 3", or nothing on the screens that are not a step in a sequence. */
  count?: ReactNode;
  children: ReactNode;
  /** The action, and anything stacked with it. */
  footer: ReactNode;
  /** The centred line under the action. Plain text — the footer rule is the anatomy's. */
  footnote?: ReactNode;
  pending?: ReactNode;
  solo?: boolean;
}) {
  return (
    /*
     * Paper, explicitly: these screens render outside the app shell, which is what paints the
     * ground everywhere else. Without it the panel sat on the browser's white and read as a card
     * floating on a different page.
     *
     * The floor is 40px up from the bottom edge on a phone, because the action lives down there and
     * the last inch of a tall screen is the hardest part of it to reach.
     */
    <div className="flex min-h-[100dvh] flex-col justify-center bg-paper px-s2 pb-s4 pt-s2 lg:items-center lg:p-s3">
      {/* A phone has no brand column, so the lockup stands where it would have been. The counter
          path carries no lockup at all: the shop's code is what brought the member here. */}
      {!solo && (
        <div className="c-paneback mb-s2 lg:hidden">
          <Wordmark sm plain />
        </div>
      )}
      {/* The visit's total is as wide as the panel it rides above, not as wide as its own words. */}
      {pending && <div className={cn('w-full', solo ? 'max-w-[380px]' : 'max-w-[880px]')}>{pending}</div>}
      <div className={cn('c-authshell w-full', solo && 'c-solo')}>
        {!solo && (
          <div className="c-brandpanel">
            <Wordmark plain />
            <p className="c-statement">{statement}</p>
            <p className="c-det max-w-[34ch] leading-[1.7]">{blurb}</p>
          </div>
        )}
        <Cell>
          <CHead>
            <SecHead label={label}>{count && <span className="c-det">{count}</span>}</SecHead>
          </CHead>
          <CMain>{children}</CMain>
          <CFoot>
            {footer}
            {footnote && <p className="c-det mt-s1 text-center">{footnote}</p>}
          </CFoot>
        </Cell>
      </div>
    </div>
  );
}

/** A step's title and its one line of explanation, in the shape every one of them uses. */
export function StepHead({ title, lede }: { title: string; lede: ReactNode }) {
  return (
    <>
      <p className="c-fig c-fig-sec">{title}</p>
      <p className="c-det mt-[6px] leading-[1.6]">{lede}</p>
    </>
  );
}

/** A labelled field, the label in the guide's mono caps. */
export function LabelledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="c-label mb-[6px] block">{label}</span>
      {children}
    </label>
  );
}
