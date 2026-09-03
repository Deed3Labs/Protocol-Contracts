import { Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MemberAvatar from '@/components/clear/MemberAvatar';
import type { MemberProfile } from '@/lib/clearModel';

/**
 * The photo at the top of Personal information — design spec §10.
 *
 * The avatar itself is the control, with the camera badge saying so; Change is
 * there for anyone who doesn't read a picture as a button. Both open the same
 * surface, where taking, choosing and removing live together.
 */
export default function ProfilePhotoRow({
  profile,
  onOpen,
}: {
  profile: MemberProfile;
  onOpen?: () => void;
}) {
  return (
    <div className="mb-0.5 flex items-center gap-3.5 border-b-[0.5px] border-border pb-3.5 pt-0.5">
      <button
        type="button"
        onClick={onOpen}
        aria-label="Change profile photo"
        className="relative shrink-0"
      >
        <MemberAvatar profile={profile} className="h-[60px] w-[60px] rounded-[20px] text-lg" />
        <span
          aria-hidden
          className="absolute -bottom-[3px] -right-[3px] flex h-6 w-6 items-center justify-center rounded-[9px] border-2 border-background bg-foreground text-background"
        >
          <Camera className="h-3 w-3" strokeWidth={1.9} />
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <p className="text-[13px]">Profile photo</p>
        <p className="mt-[3px] text-[11px] leading-relaxed text-muted-foreground">
          Members see this when you send or request money.
        </p>
      </div>

      <Button variant="clear" size="xs" className="shrink-0" onClick={onOpen}>
        Change
      </Button>
    </div>
  );
}
