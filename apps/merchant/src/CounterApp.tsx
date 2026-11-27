import { BrowserRouter } from 'react-router-dom';
import App from '@/App';
import { AuthProvider } from '@/auth/AuthProvider';
import { merchantApi } from '@/data/merchantApi';

// Chosen before any screen asks: with the mock, this also stands it in for the older client's
// Clear-side calls, which screens make directly.
merchantApi();

/** The counter app: routing, the device and shift session, and the app itself. Loaded on demand. */
export default function CounterApp() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  );
}
