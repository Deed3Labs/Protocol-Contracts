import { createContext, useContext } from 'react';

/**
 * What a page can ask of the shell about the shift: open "Who's on the counter?" to hand the
 * tablet over, or end the current shift. The shell owns both, because the PIN sheets and the lock
 * live there.
 */
export interface ShiftActions {
  changeShift: () => void;
  endShift: () => void;
}

export const ShiftActionsContext = createContext<ShiftActions>({ changeShift: () => undefined, endShift: () => undefined });

export const useShiftActions = () => useContext(ShiftActionsContext);
