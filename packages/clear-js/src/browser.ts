/** `js.useclear.org/v1`: puts `Clear` on the window. A second copy of the script keeps the first. */
import Clear from './index';

const w = window as unknown as { Clear?: { version?: string } };
if (!w.Clear?.version) (w as { Clear?: unknown }).Clear = Clear;
