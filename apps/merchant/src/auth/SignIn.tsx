import { useEffect, useState } from 'react';
import { api } from '@/data/apiClient';
import { useAuth } from '@/auth/authContext';
import { FirstPinSheet, PinScreen, WhoIsOnScreen, type ShiftPerson } from '@/auth/screens';
import { usePinAttempts } from '@/auth/pinAttempts';
import { useDigitKeys } from '@/brand/ui';
import { resettersOf } from '@/shell/chrome';
import { rememberedShop } from '@/lib/shopName';

/**
 * Starting a shift — sign-in reference, section 2.
 *
 * **Pick a name, then a PIN, never a PIN alone.** A bare field asks someone to remember which of
 * four codes is theirs, which is the usual reason a colleague's gets borrowed, and a borrowed code
 * makes the name on every charge row a guess. Everyone with access is listed, the owner included:
 * making Mike sign in differently to raise a charge is a reason to hand the tablet to Jen instead.
 *
 * **This is not a login.** A PIN is attribution, not security. The boundary is the enrolled
 * device; nothing that moves money happens from here. There is no owner sign-in on this screen
 * either: the owner starts a shift like anyone else, and signs in only at the moment something
 * needs the owner.
 */
export function SignIn() {
  const { signInWithPin, startFirstShift, device } = useAuth();
  const [roster, setRoster] = useState<ShiftPerson[] | null>(null);
  const [picked, setPicked] = useState<ShiftPerson | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const attempts = usePinAttempts();

  useEffect(() => {
    api
      .roster()
      // Somebody whose PIN isn't set yet (new, or reset) picks one instead of typing it.
      .then((people) => setRoster(people.map(({ pinSet, ...p }) => ({ ...p, first: !pinSet }))))
      .catch(() => setRoster([]));
  }, []);

  // A first shift: four digits, then the same four again.
  const [chosen, setChosen] = useState<string | null>(null);
  const first = !!picked?.first;

  // Four digits is the whole PIN, so it goes on the fourth rather than asking for a confirm tap.
  useEffect(() => {
    if (pin.length !== 4 || !picked || busy || first) return;
    setBusy(true);
    signInWithPin(pin, picked.id)
      .catch((e: unknown) => {
        // The server's own limit, when it is hit, says how long in its words; anything else is a
        // wrong PIN, and the tablet says how many tries are left.
        const status = (e as { status?: number })?.status;
        setError(status === 429 && e instanceof Error ? e.message : attempts.miss());
        setPin('');
      })
      .finally(() => setBusy(false));
  }, [pin, picked, busy, first, signInWithPin, attempts]);

  useEffect(() => {
    if (!first || !picked || busy || pin.length !== 4) return;
    if (chosen === null) {
      setChosen(pin);
      setPin('');
      return;
    }
    if (pin !== chosen) {
      setError('Those didn’t match. Pick your four digits again.');
      setChosen(null);
      setPin('');
      return;
    }
    setBusy(true);
    startFirstShift(pin, picked.id)
      .catch((e: unknown) => {
        const status = (e as { status?: number })?.status;
        // Taken (409) or the shop's PIN limit (429): the server's own sentence says which.
        setError(e instanceof Error && (status === 409 || status === 429) ? e.message : 'That didn’t work. Try again.');
        setChosen(null);
        setPin('');
      })
      .finally(() => setBusy(false));
  }, [first, picked, busy, pin, chosen, startFirstShift]);

  const typing = !!picked && !busy && !attempts.waiting;
  const digit = (d: string) => {
    setError(null);
    setPin((p) => (p.length >= 4 ? p : p + d));
  };
  const del = () => setPin((p) => p.slice(0, -1));
  useDigitKeys(typing, digit, del);

  const shop = rememberedShop() ?? '';

  const back = () => {
    setPicked(null);
    setPin('');
    setChosen(null);
    setError(null);
  };

  if (!picked || first) {
    return (
      <>
        <WhoIsOnScreen
          shop={shop}
          deviceLabel={device?.label ?? ''}
          people={roster ?? []}
          loading={roster === null}
          onPick={(p) => {
            setPicked(p);
            setPin('');
            setError(null);
            attempts.reset();
          }}
        />
        {picked && first && (
          <FirstPinSheet
            name={picked.name}
            role={picked.role}
            choose={chosen === null ? pin.length : 4}
            again={chosen === null ? 0 : pin.length}
            error={error}
            onDigit={digit}
            onDelete={del}
            onClose={back}
          />
        )}
      </>
    );
  }

  return (
    <PinScreen
      shop={shop}
      person={picked}
      filled={pin.length}
      error={error}
      disabled={!typing}
      resetters={resettersOf(roster ?? [])}
      onDigit={digit}
      onDelete={del}
      // Where a clear key would sit. Picking the wrong name is the common mistake, and backing
      // out of it should cost one tap.
      onNotMe={back}
    />
  );
}
