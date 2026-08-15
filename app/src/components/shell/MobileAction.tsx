import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { LucideIcon } from 'lucide-react';

export interface MobileAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
}

const MobileActionContext = createContext<{
  action: MobileAction | null;
  setAction: (action: MobileAction | null) => void;
}>({ action: null, setAction: () => {} });

/**
 * The one thing the current page is for, surfaced as the mobile nav's action
 * button — design spec §1.
 *
 * A page declares it; the shell renders it. Without this the button would have to
 * know what every page's primary action is, which puts page logic in the chrome
 * and makes adding a page a two-file change.
 *
 * Pages that don't set one get the default: the quick-actions fan.
 */
export function MobileActionProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<MobileAction | null>(null);
  const value = useMemo(() => ({ action, setAction }), [action]);

  return <MobileActionContext.Provider value={value}>{children}</MobileActionContext.Provider>;
}

export function useMobileAction() {
  return useContext(MobileActionContext).action;
}

/**
 * Declare this page's primary action for as long as the page is mounted.
 *
 * The callback is held in a ref and invoked through a stable wrapper, so a page
 * can pass a fresh closure on every render — which every page does — without the
 * effect re-firing, re-setting context, and re-rendering forever.
 */
export function useSetMobileAction(action: MobileAction | null) {
  const { setAction } = useContext(MobileActionContext);
  const latest = useRef(action);
  latest.current = action;

  const label = action?.label;
  const icon = action?.icon;

  useEffect(() => {
    if (!label || !icon) {
      setAction(null);
      return;
    }
    setAction({ label, icon, onSelect: () => latest.current?.onSelect() });
    return () => setAction(null);
  }, [setAction, label, icon]);
}
