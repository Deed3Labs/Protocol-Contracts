import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  getRequiredDocuments,
  startDocumentUpload,
  putDocumentImage,
  type RequiredDocumentInfo,
  type UploadTarget,
} from '@/utils/apiClient';

/*
 * The photo step — and the reason it looks like this.
 *
 * The image goes from this component straight to the card issuer's presigned URL. It never reaches
 * a server of ours, which is the whole design: forwarding a member's driver's licence would make us
 * the custodian of every member's government ID, in request logs and in memory on boxes whose
 * retention we do not control. Passing an SSN through and then warehousing passport photos would
 * be a strange place to draw the line.
 *
 * So there is no upload endpoint of ours to point at. `startDocumentUpload` asks the issuer where
 * to put it and gets URLs back; `putDocumentImage` is a bare fetch that deliberately carries none
 * of our session headers to somebody else's storage.
 *
 * How many images are needed is the issuer's call, not ours: a licence wants a front and a back, a
 * passport one, and rather than encode that pairing this renders one capture per target returned.
 */

const LABELS: Record<string, string> = {
  DRIVERS_LICENSE: "Driver's licence",
  PASSPORT: 'Passport',
  PASSPORT_CARD: 'Passport card',
};

const SIDE = { FRONT: 'Front', BACK: 'Back' } as const;

export default function DocumentUpload({ onDone }: { onDone: () => void }) {
  const [required, setRequired] = useState<RequiredDocumentInfo[]>([]);
  const [chosenType, setChosenType] = useState<string | null>(null);
  const [targets, setTargets] = useState<UploadTarget[]>([]);
  const [uploaded, setUploaded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    void getRequiredDocuments().then(setRequired);
  }, []);

  const entityToken = required[0]?.entityToken ?? null;
  const options = required[0]?.validDocuments ?? [];

  const choose = async (documentType: string) => {
    if (!entityToken) return;
    setBusy(true);
    setError(null);
    const result = await startDocumentUpload(documentType, entityToken);
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setChosenType(documentType);
    setTargets(result.targets);
    setUploaded({});
  };

  const send = async (target: UploadTarget, file: File) => {
    setBusy(true);
    setError(null);
    const ok = await putDocumentImage(target.uploadUrl, file);
    setBusy(false);
    if (!ok) {
      // A presigned URL expires. Re-requesting is the fix, and saying so beats a bare failure —
      // but we do not cache the URL to retry with, because a cached one is a live link to
      // somewhere a passport can be written.
      setError('That upload didn’t go through. Choose the document again to get a fresh link.');
      setChosenType(null);
      setTargets([]);
      return;
    }
    setUploaded((prev) => ({ ...prev, [target.uploadToken]: true }));
  };

  const allSent = targets.length > 0 && targets.every((t) => uploaded[t.uploadToken]);

  if (!entityToken) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-[13px] text-foreground-secondary">Nothing is waiting on a photo right now.</p>
        <Button variant="clear" className="w-full" onClick={onDone}>Done</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5 text-center">
        <p className="text-lg text-foreground">One more thing</p>
        <p className="text-[13px] leading-relaxed text-foreground-secondary">
          We couldn&rsquo;t match your details automatically. A photo of your ID sorts it out.
        </p>
      </div>

      {!chosenType ? (
        <div className="space-y-2">
          {options.map((documentType) => (
            <Button key={documentType} variant="clear" className="w-full" disabled={busy}
              onClick={() => void choose(documentType)}>
              {LABELS[documentType] ?? documentType}
            </Button>
          ))}
          <p className="text-center text-[11px] leading-relaxed text-foreground-secondary">
            Lay it flat, all four corners in frame.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {targets.map((target) => (
            <div key={target.uploadToken}>
              {/*
                * `capture` opens the camera on a phone and is ignored on a desktop, where the same
                * input becomes a file picker. One control for "take a photo" and "choose from
                * library" rather than two that do the same thing.
                */}
              <input
                ref={(el) => { inputs.current[target.uploadToken] = el; }}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void send(target, file);
                  // Clear it so re-picking the same file fires change again.
                  e.target.value = '';
                }}
              />
              <Button
                variant="clear"
                className="w-full"
                disabled={busy}
                onClick={() => inputs.current[target.uploadToken]?.click()}
              >
                {uploaded[target.uploadToken]
                  ? `${SIDE[target.imageType]} added`
                  : `Add the ${SIDE[target.imageType].toLowerCase()}`}
              </Button>
            </div>
          ))}
        </div>
      )}

      {error && <p role="status" className="text-[12px] text-foreground">{error}</p>}

      {allSent && (
        <div className="space-y-2">
          <p className="text-center text-[13px] text-foreground">Sent. Usually reviewed within a day.</p>
          <Button variant="clear" className="w-full" onClick={onDone}>Done</Button>
        </div>
      )}

      <p className="text-center text-[11px] leading-relaxed text-foreground-secondary">
        Sent straight to our card issuer. Clear never sees the photo.
      </p>
    </div>
  );
}
