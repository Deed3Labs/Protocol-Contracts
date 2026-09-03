import { describe, expect, test } from 'bun:test';
import { toIsoDob, toFormattedSsn } from '../../lib/identityFields';

/*
 * The two fields a member types, and the two formats Lithic will not negotiate on: `YYYY-MM-DD`
 * and `000-00-0000`. Getting either wrong is a 400 after the SSN has already been sent, which is
 * the worst possible moment to discover a formatting bug.
 */
describe('what the member types becomes what the issuer wants', () => {
  test('a date is reordered, not just reformatted', () => {
    expect(toIsoDob('04/12/1985')).toBe('1985-04-12');
    expect(toIsoDob(' 04 / 12 / 1985 ')).toBe('1985-04-12');
  });

  test('an impossible date is refused rather than silently rolled over', () => {
    // `new Date('2001-02-31')` is March 3rd. Without the round-trip check that submits a birthday
    // the member did not type.
    expect(toIsoDob('02/31/2001')).toBeNull();
    expect(toIsoDob('13/01/1990')).toBeNull();
  });

  test('so is a date that would make them a child', () => {
    const nextYear = new Date().getFullYear() + 1;
    expect(toIsoDob(`01/01/${nextYear}`)).toBeNull();
    expect(toIsoDob(`01/01/${new Date().getFullYear() - 5}`)).toBeNull();
  });

  test('and anything that is not a date at all', () => {
    for (const bad of ['', '1985-04-12', '4/12/1985', 'not a date']) {
      expect(toIsoDob(bad)).toBeNull();
    }
  });

  test('an SSN is accepted however it is typed and sent one way', () => {
    for (const typed of ['123456789', '123-45-6789', '123 45 6789']) {
      expect(toFormattedSsn(typed)).toBe('123-45-6789');
    }
  });

  test('a wrong-length one is refused before it is sent', () => {
    for (const bad of ['', '12345678', '1234567890', 'abcdefghi']) {
      expect(toFormattedSsn(bad)).toBeNull();
    }
  });
});

/*
 * The handling rules that follow from "Clear never keeps it" being on the screen.
 */
describe('the sensitive fields do not outlive the modal', () => {
  const raw = require('node:fs').readFileSync(
    require('node:path').join(import.meta.dirname, 'VerifyIdentityModal.tsx'), 'utf8',
  ) as string;
  /*
   * Comments stripped, for the third time in this codebase.
   *
   * The docblock in that file says "no draft in localStorage" — and the first version of this test
   * failed on its own prose. A rule about what the code does has to be checked against the code.
   */
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  test('nothing is written to storage', () => {
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
  });

  test('nothing is sent to analytics', () => {
    expect(source).not.toMatch(/\btrack\(/);
  });

  test('the SSN field cannot be saved by the browser', () => {
    const ssnField = source.slice(source.indexOf('Social security number'), source.indexOf('editingDetails ?'));
    expect(ssnField).toContain("autoComplete=\"off\"");
    expect(ssnField).toContain('type="password"');
  });

  test('and both are cleared as soon as they have been sent, whatever the answer', () => {
    const submit = source.slice(source.indexOf('const submit ='), source.indexOf('const field ='));
    const afterSend = submit.slice(submit.indexOf('setBusy(false)'));
    expect(afterSend).toContain("setSsn('')");
    expect(afterSend).toContain("setDob('')");
    // Before the branch on success, so a failure does not leave them sitting in state.
    expect(afterSend.indexOf("setSsn('')")).toBeLessThan(afterSend.indexOf('if (!result.ok)'));
  });
});
