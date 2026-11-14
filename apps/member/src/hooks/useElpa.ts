import { useEffect, useState } from 'react';
import { elpaBooksStub, type ElpaSource, type ElpaState } from '@/lib/elpa';

/**
 * The member's ELPA, from Clear's books (lib/elpa). Off chain: no contract is read.
 *
 * Starts at "none" and stays there on a failed read, so a member never sees a figure that was not
 * read. Today the source is the typed stub, which answers "none" for everyone.
 */
export function useElpa(source: ElpaSource = elpaBooksStub): ElpaState {
  const [elpa, setElpa] = useState<ElpaState>({ status: 'none' });
  useEffect(() => {
    let cancelled = false;
    source
      .read()
      .then((state) => {
        if (!cancelled) setElpa(state);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [source]);
  return elpa;
}
