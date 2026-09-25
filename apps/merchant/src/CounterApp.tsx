import { BrowserRouter } from 'react-router-dom';
import App from '@/App';
import { AuthProvider } from '@/auth/AuthProvider';

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
