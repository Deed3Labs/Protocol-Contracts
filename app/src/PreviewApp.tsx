import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { ThemeProvider } from '@/context/ThemeContext';
import AppChrome from '@/components/shell/AppChrome';
import RebuildPlaceholder from '@/pages/app/RebuildPlaceholder';

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
 * here is what renders in the app once the data is wired.
 */
export default function PreviewApp() {
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
            <Route path="/" element={<RebuildPlaceholder page="Home" />} />
            <Route path="/savings" element={<RebuildPlaceholder page="Savings" />} />
            <Route path="/earn" element={<RebuildPlaceholder page="Earn" />} />
            <Route path="/send" element={<RebuildPlaceholder page="Send" />} />
            <Route path="/activity" element={<RebuildPlaceholder page="Activity" />} />
            <Route path="/card" element={<RebuildPlaceholder page="Card" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppChrome>
      </ThemeProvider>
    </BrowserRouter>
  );
}
