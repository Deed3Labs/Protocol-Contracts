import { useEffect, useState } from 'react';
import type { MemberProfile } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * The member's own avatar — their photo if they've set one, their initials if
 * not.
 *
 * Initials are the fallback rather than a grey silhouette: a person's initials
 * are still them, and an empty avatar icon reads as "we don't know who you are".
 * They're also the fallback when the photo *fails to load* — a stored URL can
 * 404, or come back truncated from a field too small to hold it, and a broken
 * image glyph in the header is the worst of the three outcomes.
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
  const [failed, setFailed] = useState(false);

  // A new photo deserves a fresh attempt — otherwise one bad URL poisons every
  // later one for the life of the component.
  useEffect(() => setFailed(false), [profile.avatarUrl]);

  if (profile.avatarUrl && !failed) {
    return (
      <img
        src={profile.avatarUrl}
        alt=""
        onError={() => setFailed(true)}
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
