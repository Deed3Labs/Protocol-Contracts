import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Camera, ImageIcon, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Modal from '@/components/clear/Modal';
import InfoBlock from '@/components/clear/InfoBlock';
import MemberAvatar from '@/components/clear/MemberAvatar';
import { cropToDataUrl, readFileAsDataUrl } from '@/lib/avatar';
import type { MemberProfile } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

const STAGE = 200;
const MASK = 150;

/**
 * Adjust step — position the photo inside the frame before it's saved.
 *
 * Cropping happens here rather than server-side because the member is the only
 * one who knows which part of the picture is them. Drag moves it, the slider
 * zooms; what's inside the mask is exactly what gets written, so there's no
 * surprise between this screen and the avatar.
 */
function Adjust({
  src,
  onCancel,
  onSave,
}: {
  src: string;
  onCancel: () => void;
  onSave: (dataUrl: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setOffset({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <>
      <div
        className="relative mb-3.5 flex h-[200px] touch-none items-center justify-center overflow-hidden rounded-xl bg-secondary"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="max-w-none select-none"
          style={{
            height: STAGE,
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          }}
        />
        {/* The mask is the crop: a ring of shadow rather than a cut-out, so what's
            outside it stays visible while you position. */}
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-[48px] border-2 border-card"
          style={{ width: MASK, height: MASK, boxShadow: '0 0 0 999px rgb(0 0 0 / 0.28)' }}
        />
      </div>

      {/* A native range rather than the project's Slider, which is a two-handle
          range control — one handle is the whole requirement here. */}
      <input
        type="range"
        min={1}
        max={3}
        step={0.01}
        value={zoom}
        onChange={(e) => setZoom(Number(e.target.value))}
        aria-label="Zoom"
        className="mb-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border accent-foreground"
      />
      <p className="mb-3.5 text-center text-[11px] text-muted-foreground">
        Drag to reposition · slide to zoom
      </p>

      <div className="flex gap-2">
        <Button variant="clear" size="xs" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="xs"
          className="flex-1"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              onSave(await cropToDataUrl(src, { stage: STAGE, mask: MASK, zoom, offset }));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? 'Saving…' : 'Save photo'}
        </Button>
      </div>
    </>
  );
}

/**
 * Profile photo — design spec §10. Reached from the avatar on Personal
 * information or from the identity block in the profile menu.
 *
 * Take a photo and Choose from library are separate rows rather than one "upload"
 * button because on a phone they're genuinely different actions, and the OS
 * picker that merges them buries the camera two taps deep.
 */
export default function ProfilePhotoDialog({
  profile,
  open,
  onOpenChange,
  onSave,
  onRemove,
}: {
  profile: MemberProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Handed the cropped data URL, ready to upload. */
  onSave?: (dataUrl: string) => Promise<void> | void;
  onRemove?: () => Promise<void> | void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setPicked(null);
    onOpenChange(false);
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    setPicked(await readFileAsDataUrl(file));
  };

  const actions = [
    { label: 'Take a photo', icon: Camera, onSelect: () => cameraRef.current?.click() },
    { label: 'Choose from library', icon: ImageIcon, onSelect: () => libraryRef.current?.click() },
  ];

  return (
    <Modal
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title={picked ? 'Adjust' : 'Profile photo'}
      description={
        picked
          ? 'Position your photo inside the frame.'
          : 'Add, change or remove the photo other members see.'
      }
      onBack={picked ? () => setPicked(null) : undefined}
    >
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          void onFile(file);
        }}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          void onFile(file);
        }}
      />

      {picked ? (
        <Adjust
          src={picked}
          onCancel={() => setPicked(null)}
          onSave={async (dataUrl) => {
            setBusy(true);
            try {
              await onSave?.(dataUrl);
            } catch {
              // Same again: the photo is already applied optimistically.
            } finally {
              setBusy(false);
              close();
            }
          }}
        />
      ) : (
        <>
          <div className="mb-4 flex justify-center">
            <MemberAvatar
              profile={profile}
              className="h-24 w-24 rounded-[30px] text-[28px]"
            />
          </div>
          <p className="mb-4 text-center text-[11px] leading-relaxed text-muted-foreground">
            Your initials show until you add a photo.
          </p>

          <div className="text-[13px]">
            {actions.map((action, i) => (
              <button
                key={action.label}
                type="button"
                disabled={busy}
                onClick={action.onSelect}
                className={cn(
                  'flex w-full items-center gap-3 py-3 text-left transition-colors hover:text-foreground',
                  i < actions.length - 1 && 'border-b-[0.5px] border-border',
                )}
              >
                <action.icon
                  aria-hidden
                  className="h-4 w-4 shrink-0 text-foreground-secondary"
                  strokeWidth={1.75}
                />
                {action.label}
              </button>
            ))}

            {profile.avatarUrl && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onRemove?.();
                  } catch {
                    // The local clear has already happened; a failed server call
                    // shouldn't strand the member in a sheet they're done with.
                  } finally {
                    setBusy(false);
                    close();
                  }
                }}
                className="flex w-full items-center gap-3 border-t-[0.5px] border-border py-3 text-left text-foreground-secondary transition-colors hover:text-foreground"
              >
                <Trash2 aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                <span>
                  Remove photo
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    Go back to initials
                  </span>
                </span>
              </button>
            )}
          </div>

          <InfoBlock tone="neutral" className="mt-3.5 text-[11px]">
            Visible to members and Clear Partners you transact with. Not shown publicly.
          </InfoBlock>
        </>
      )}
    </Modal>
  );
}
