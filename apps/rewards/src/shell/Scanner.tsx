import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { PREVIEW } from '../lib/env';

/**
 * The camera, reading Clear's QR codes (a Point, a counter charge, a shop's join code). The browser's
 * own BarcodeDetector where there is one, else jsQR on a small canvas, as the Clear app's scanner
 * does. With no camera (or in the preview) it's the spec's viewfinder, and nothing is read.
 */
export function Scanner({ prompt, onCode, height, box }: { prompt: string; onCode: (raw: string) => void; height?: number; box?: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState(false);
  const done = useRef(false);
  // The latest handler, without restarting the camera each render.
  const handler = useRef(onCode);
  handler.current = onCode;

  useEffect(() => {
    if (PREVIEW || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
    const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
    const tick = async () => {
      if (stopped || done.current) return;
      const v = video.current;
      if (v && v.readyState >= 2) {
        let raw: string | null = null;
        if (detector) raw = (await detector.detect(v).catch(() => []))[0]?.rawValue ?? null;
        else {
          const w = 480;
          const h = Math.round((v.videoHeight / v.videoWidth) * w) || 480;
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(v, 0, 0, w, h);
            raw = jsQR(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? null;
          }
        }
        if (raw) {
          done.current = true;
          handler.current(raw);
          return;
        }
      }
      raf = requestAnimationFrame(() => void tick());
    };
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
          setLive(true);
          raf = requestAnimationFrame(() => void tick());
        }
      })
      .catch(() => setLive(false));
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className={`sa-vf${live ? ' live' : ''}`} style={height ? { height } : undefined}>
      <video ref={video} muted playsInline className={live ? '' : 'r-hide'} />
      <div className="sa-vfbox" style={box ? { width: box, height: box } : undefined} />
      <p>{prompt}</p>
    </div>
  );
}
