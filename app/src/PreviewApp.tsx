import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { ThemeProvider } from '@/context/ThemeContext';
import AppChrome from '@/components/shell/AppChrome';
import HomePage from '@/pages/app/HomePage';
import RebuildPlaceholder from '@/pages/app/RebuildPlaceholder';
import { HOME_IN_USE, HOME_DAY_ONE } from '@/data/clearPlaceholder';

/**
 * Dev-only visual harness for the member-app rebuild.
 *
 * The real app mounts behind AppKitProvider + ProtectedRoute, so it can't render
 * without a wallet — which makes the shell and pages impossible to look at while
 * building them. This mounts AppChrome and the pages directly, with no providers
 * and no auth. Reach it at `/?preview=1` in dev; it is never bundled in prod
 * (main.tsx only imports it under `import.meta.env.DEV`).
 *
 * Pages are built presentational-first against placeholder data, so what renders
 * here is what renders in the app once the data is wired. The toggle switches
 * every page between its populated and empty states.
 */
export default function PreviewApp() {
  const [empty, setEmpty] = useState(false);

  return (
    <BrowserRouter>
      <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
        <AppChrome
          trailing={
            <button type="button" aria-label="Notifications" className="p-1 text-foreground-secondary">
              <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </button>
          }
        >
          <Routes>
            <Route path="/" element={<HomePage data={empty ? HOME_DAY_ONE : HOME_IN_USE} />} />
            <Route path="/savings" element={<RebuildPlaceholder page="Savings" />} />
            <Route path="/earn" element={<RebuildPlaceholder page="Earn" />} />
            <Route path="/send" element={<RebuildPlaceholder page="Send" />} />
            <Route path="/activity" element={<RebuildPlaceholder page="Activity" />} />
            <Route path="/card" element={<RebuildPlaceholder page="Card" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppChrome>

        {/* Harness control — not part of the app */}
        <button
          type="button"
          onClick={() => setEmpty((e) => !e)}
          className="fixed right-3 top-[62px] z-[60] rounded-md border-[0.5px] border-border bg-background/90 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-sm"
        >
          state: {empty ? 'empty' : 'populated'}
        </button>
      </ThemeProvider>
    </BrowserRouter>
  );
}
