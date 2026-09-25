import { createContext, useContext } from 'react';

/**
 * What a page can ask of the shell about the shift: open "Who's on the counter?" to hand the
 * tablet over, or end the current shift. The shell owns both, because the PIN sheets and the lock
 * live there.
 */
export interface ShiftActions {
  changeShift: () => void;
  endShift: () => void;
  /** The owner's sign-in, as a padlocked nav item opens it. */
  ownerSignIn: () => void;
}

export const ShiftActionsContext = createContext<ShiftActions>({ changeShift: () => undefined, endShift: () => undefined, ownerSignIn: () => undefined });

export const useShiftActions = () => useContext(ShiftActionsContext);
