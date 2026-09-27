import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

/**
 * The tablet's camera, reading QR codes: for "Scan their code" at the counter.
 *
 * The same two decoders as the member app's scanner (apps/member ScanPage): `BarcodeDetector` where
 * the browser has it, jsQR everywhere else (iOS Safari has no BarcodeDetector). The back camera is
 * asked for first; a tablet on a stand may only have the front one, which is used instead. Each
 * decoded value goes to `onCode`, which says whether it was the kind wanted; the camera stops once
 * one is.
 */

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

export type CameraState = 'starting' | 'scanning' | 'blocked' | 'unsupported';

export function CodeScanner({ onCode, onState }: { onCode: (raw: string) => boolean; onState?: (s: CameraState) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>('starting');
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => onState?.(state), [state, onState]);

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    let active: MediaStream | null = null;
    let detector: BarcodeDetectorLike | null = null;
    let last = '';
    let lastAt = 0;
    let pass = 0;
    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (Ctor) {
      try {
        detector = new Ctor({ formats: ['qr_code'] });
      } catch {
        detector = null;
      }
    }

    async function tick() {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        raf = requestAnimationFrame(tick);
        return;
      }
      let raw: string | null = null;
      if (detector) {
        try {
          raw = (await detector.detect(video))[0]?.rawValue ?? null;
          if (cancelled) return;
        } catch {
          detector = null;
        }
      }
      if (raw === null) {
        /*
         * A member's code is a phone held up to the tablet: small in the frame. Shrunk to 480px wide
         * it was one or two pixels a square and jsQR never read it, so nothing happened. Two passes,
         * one a frame: the middle of the frame, where they hold it, at the camera's own resolution;
         * then the whole frame at 960px, for a code held off to one side.
         */
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 480;
        const centre = pass++ % 2 === 0;
        const [sx, sy, sw, sh] = centre ? [vw * 0.2, vh * 0.15, vw * 0.6, vh * 0.7] : [0, 0, vw, vh];
        const w = Math.min(960, Math.round(sw));
        const h = Math.round((sh / sw) * w) || w;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
          raw = jsQR(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? null;
        }
      }
      // The same code seen frame after frame is one scan -- but one turned down (not ready yet, say)
      // is read again after a moment rather than never.
      if (raw && (raw !== last || Date.now() - lastAt > 1500)) {
        last = raw;
        lastAt = Date.now();
        if (onCodeRef.current(raw)) {
          active?.getTracks().forEach((t) => t.stop());
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unsupported');
      return;
    }
    navigator.mediaDevices
      // As sharp as the camera gives: a phone's code is a small part of what it sees.
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        active = s;
        setStream(s);
        setState('scanning');
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setState('blocked'));

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      active?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Attached once both exist: the stream arrives from a permission prompt, the element from a render.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream || video.srcObject === stream) return;
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    void video.play().catch(() => undefined);
  }, [stream, state]);

  return (
    <>
      {state === 'scanning' ? (
        <video ref={videoRef} muted playsInline aria-label="Camera" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <p className="c-det" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 'var(--s3)', margin: 0 }}>
          {state === 'starting'
            ? 'Starting the camera…'
            : state === 'blocked'
              ? 'The camera is off for this app. Allow it in the tablet’s settings, or send it to their number.'
              : 'This browser can’t use the camera. Send it to their number instead.'}
        </p>
      )}
      <canvas ref={canvasRef} hidden />
    </>
  );
}
