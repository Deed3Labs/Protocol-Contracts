import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScanLine } from 'lucide-react';
import jsQR from 'jsqr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Card from '@/components/clear/Card';
import { chargeCodeFrom } from '@/lib/clearCode';

/**
 * Scan to pay — design spec §7.
 *
 * The camera fills the screen because there is exactly one thing to do here. "Enter a code
 * instead" is the escape hatch that keeps the page usable when the camera is refused, the light is
 * bad, or the code is on a screen too small to read — which is most of the times this fails.
 *
 * **Two decoders, and the native one first.** `BarcodeDetector` is hardware-accelerated where it
 * exists; jsQR is the fallback that works everywhere else, which matters because iOS Safari is the
 * platform a member is most likely holding while standing at a counter. The scan loop is the same
 * either way, so a browser gaining support changes nothing here.
 *
 * A decoded code goes straight to `/c/<code>` — the same screen the emailed link opens — so
 * scanning and tapping a text converge on one approval flow rather than two.
 */

/** Not in lib.dom yet. Declared narrowly rather than pulling in a shim for one method. */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

export default function ScanPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const doneRef = useRef(false);

  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'starting' | 'scanning' | 'blocked' | 'unsupported'>(
    'starting',
  );
  const [notACode, setNotACode] = useState(false);
  /**
   * State as well as a ref. The ref is what cleanup and `finish` reach for on the way out; the
   * state is what the attach effect watches, so a second stream replacing a first is a change the
   * effect can see. Keying that effect on `status` alone would miss it -- the status is already
   * 'scanning' by then, and the element would hold a stopped stream.
   */
  const [stream, setStream] = useState<MediaStream | null>(null);

  /** One place to leave, so a scan cannot fire twice and the camera always stops. */
  const finish = useCallback(
    (found: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      navigate(`/c/${found}`);
    },
    [navigate],
  );

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    let detector: BarcodeDetectorLike | null = null;

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
          const [first] = await detector.detect(video);
          if (cancelled) return;
          raw = first?.rawValue ?? null;
        } catch {
          // A detector that throws mid-stream is not worth retrying every frame.
          detector = null;
        }
      }

      if (raw === null) {
        // Downscale before decoding: a full-resolution frame costs more than it finds, and a QR
        // held at arm's length is legible at a fraction of the sensor's size.
        const w = 480;
        const h = Math.round((video.videoHeight / video.videoWidth) * w) || 480;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          raw = jsQR(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? null;
        }
      }

      if (raw) {
        const found = chargeCodeFrom(raw);
        if (found) {
          finish(found);
          return;
        }
        // Something scanned and it was not ours. Say so rather than looking broken.
        setNotACode(true);
      }

      raf = requestAnimationFrame(tick);
    }

    // Checked before the call, not after. `navigator.mediaDevices` is undefined on an insecure
    // origin as well as on an old browser, and `?.getUserMedia(...).then(...)` reads `.then` of
    // undefined -- the effect threw before it could reach a branch that says so.
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      setManual(true);
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        // Only recorded here. Attaching it is the other effect's job, because the element it
        // attaches to does not exist until this line has rendered.
        streamRef.current = stream;
        setStream(stream);
        setStatus('scanning');
        raf = requestAnimationFrame(tick);
      })
      .catch(() => {
        // Refused, or no camera. Both mean: type it instead.
        setStatus('blocked');
        setManual(true);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [finish]);

  /**
   * Point the element at the stream, once both exist.
   *
   * These two arrive in an order that cannot be relied on -- the stream comes back from a
   * permission prompt, the element from a render -- and the previous version assigned inside the
   * `getUserMedia` callback, when the video had not mounted yet and the ref was still null. The
   * assignment was skipped, silently, and the result was a live camera with an empty frame: the
   * recording indicator on, the aim window drawn, and nothing behind it.
   *
   * `muted` is set here as well as in the markup because iOS refuses to play a stream inline
   * without both it and `playsinline`, and an attribute React has not yet flushed does not count.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream || video.srcObject === stream) return;
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    void video.play().catch(() => {
      // Autoplay refused. The stream is attached, so the frame is there either way; a browser that
      // wants a gesture gets one from the tap that opened this screen.
    });
  }, [stream, status]);

  const typed = chargeCodeFrom(code);

  return (
    <div className="lg:mx-auto lg:max-w-[420px]">
      <h1 className="mb-4 hidden text-xl font-medium lg:block">Scan to pay</h1>

      <Card className="relative mb-3 flex aspect-square flex-col items-center justify-center gap-3 overflow-hidden bg-secondary">
        {status === 'scanning' ? (
          <>
            <video
              ref={videoRef}
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />
            {/* A window rather than a full frame: it tells you where to aim without hiding the code. */}
            <div className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-white/70" />
            <p className="absolute bottom-3 rounded-full bg-black/50 px-3 py-1 text-xs text-white">
              {notACode ? 'That is not a Clear code' : 'Point at a Clear code'}
            </p>
          </>
        ) : (
          <>
            <ScanLine aria-hidden className="h-10 w-10 text-muted-foreground" strokeWidth={1.25} />
            <p className="px-6 text-center text-xs text-muted-foreground">
              {status === 'starting'
                ? 'Starting the camera…'
                : status === 'blocked'
                  ? 'The camera is not available. Type the code under the merchant’s QR instead.'
                  : 'This browser cannot use the camera. Type the code instead.'}
            </p>
          </>
        )}
      </Card>

      <canvas ref={canvasRef} className="hidden" />

      {manual ? (
        <>
          <label className="mb-1.5 block text-xs text-foreground-secondary" htmlFor="clear-code">
            Clear code
          </label>
          <Input
            id="clear-code"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && typed) finish(typed);
            }}
            placeholder="8 characters"
            className="mb-3 h-9 text-xs"
          />
          <Button size="xs" className="w-full" disabled={!typed} onClick={() => typed && finish(typed)}>
            Continue
          </Button>
        </>
      ) : (
        <Button variant="clear" size="sm" className="w-full text-xs" onClick={() => setManual(true)}>
          Enter a code instead
        </Button>
      )}
    </div>
  );
}
