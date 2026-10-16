import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClearSteps } from '../clear/Steps';
import { MI_CASA_SESSION, previewModalApi, previewStep } from '../lib/preview';
import { ModalShell } from './Shell';

/** Connecting is by app or code: never a QR code on a phone (§2). The sheet is what draws under 640px. */
const STEPS = ['start', 'enter', 'check', 'check-email', 'member', 'new', 'window', 'done'];
const draw = (name: string, sheet: boolean) =>
  renderToStaticMarkup(
    <ModalShell session={MI_CASA_SESSION} sheet={sheet} onClose={() => {}}>
      <ClearSteps api={previewModalApi()} session={MI_CASA_SESSION} layout={sheet ? 'sheet' : 'modal'} initial={previewStep(name)} />
    </ModalShell>,
  );
const looksLikeQr = (html: string) => /qr|<canvas|scan/i.test(html);

describe('no QR under 640px', () => {
  for (const name of STEPS) {
    test(`${name}, as the phone sheet`, () => {
      const html = draw(name, true);
      expect(html).toContain('pay-sheet');
      expect(looksLikeQr(html)).toBe(false);
    });
  }
  test('the phone sheet opens on Approve with Clear, Use email or phone, Pay by card', () => {
    const html = draw('start', true);
    for (const t of ['Approve with Clear', 'Use email or phone', 'Pay by card']) expect(html).toContain(t);
  });
});
