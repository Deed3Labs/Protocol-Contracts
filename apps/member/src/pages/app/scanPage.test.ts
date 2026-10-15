import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('./ScanPage.tsx', import.meta.url), 'utf8');

/**
 * The stream comes back from a permission prompt and the element comes from a render, in an order
 * nothing guarantees. Assigning inside the getUserMedia callback ran while the video was still
 * unmounted, so the assignment was skipped and the camera recorded into nothing: indicator on, aim
 * window drawn, empty frame behind it.
 */
describe('the stream reaches the element', () => {
  test('the getUserMedia callback does not touch the element', () => {
    const cb = SOURCE.slice(SOURCE.indexOf('.getUserMedia('), SOURCE.indexOf('.catch(()'));
    expect(cb).not.toContain('videoRef.current.srcObject');
    expect(cb).not.toContain('videoRef.current.play');
  });

  test('an effect attaches it instead, so it runs after the element mounts', () => {
    expect(SOURCE).toContain('video.srcObject = stream;');
  });

  test('it watches the stream, so a replacement is not missed once scanning', () => {
    expect(SOURCE).toContain('}, [stream, status]);');
  });

  test('inline playback is set on the element, not left to the markup alone', () => {
    expect(SOURCE).toContain('video.muted = true;');
    expect(SOURCE).toContain('video.playsInline = true;');
  });
});

/**
 * `navigator.mediaDevices` is undefined on an insecure origin, not just on an old browser — the
 * exact case a member hits opening the app over plain http on a phone.
 */
describe('a browser with no camera API says so', () => {
  test('the check happens before the call, not after it', () => {
    const start = SOURCE.indexOf('if (!navigator.mediaDevices?.getUserMedia)');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(SOURCE.indexOf('.getUserMedia({ video:'));
  });
});

/** An awaited detect resolves after unmount; cancelling the frame does not reach it. */
describe('the scan loop stops when the screen goes', () => {
  test('the loop checks a cancelled flag, and the cleanup sets it', () => {
    expect(SOURCE).toContain('if (cancelled) return;');
    expect(SOURCE).toContain('cancelled = true;');
  });

  test('a stream arriving after unmount is stopped rather than kept', () => {
    const cb = SOURCE.slice(SOURCE.indexOf('.getUserMedia('), SOURCE.indexOf('.catch(()'));
    expect(cb).toContain('stream.getTracks().forEach((t) => t.stop());');
  });
});

/** Clear Terminal, section 13: the scanner knows a Point's code and opens its bill in the pay sheet. */
describe('a Point’s code', () => {
  test('a charge is read first, then a Point', () => {
    const tick = SOURCE.slice(SOURCE.indexOf('if (raw) {'), SOURCE.indexOf('setNotACode(true)'));
    expect(tick.indexOf('chargeCodeFrom(raw)')).toBeLessThan(tick.indexOf('pointCodeFrom(raw)'));
  });

  test('a bill becomes the Clear charge the pay sheet opens; anything else is the Point’s own page', () => {
    const open = SOURCE.slice(SOURCE.indexOf('const openPoint'), SOURCE.indexOf('useEffect(() => {', SOURCE.indexOf('const openPoint')));
    expect(open).toContain("if (page.view !== 'bill')");
    expect(open).toContain('window.location.assign(`/p/${point}`)');
    expect(open).toContain("phoneApi.pay(point, 'clear', intentKey())");
    expect(open).toContain('navigate(`/c/${started.chargeCode}`)');
  });

  test('a Point that can’t be opened says why and keeps scanning', () => {
    const open = SOURCE.slice(SOURCE.indexOf('const openPoint'), SOURCE.indexOf('useEffect(() => {', SOURCE.indexOf('const openPoint')));
    expect(open).toContain('doneRef.current = false;');
    expect(open).toContain('resumeRef.current();');
  });
});
