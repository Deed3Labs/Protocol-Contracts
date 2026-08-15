import type { MemberProfile } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * The member's own avatar — their photo if they've set one, their initials if
 * not.
 *
 * Initials are the fallback rather than a grey silhouette: a person's initials
 * are still them, and an empty avatar icon reads as "we don't know who you are".
 *
 * Distinct from `Avatar`, which colours *other* people deterministically by id.
 * This one is always the same person, so it always takes the accent tint. Shape
 * comes from the caller: a rounded square where it's you being configured, a
 * circle where you're one face among several.
 */
export default function MemberAvatar({
  profile,
  className,
}: {
  profile: Pick<MemberProfile, 'initials' | 'name' | 'avatarUrl'>;
  className?: string;
}) {
  if (profile.avatarUrl) {
    return (
      <img
        src={profile.avatarUrl}
        alt=""
        className={cn('shrink-0 object-cover', className)}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center bg-tier-boost/10 text-tier-boost-fg',
        className,
      )}
    >
      {profile.initials}
    </span>
  );
}
