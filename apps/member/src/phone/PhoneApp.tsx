import './phone.css';
import { phoneRoute } from './format';
import { PointPage } from './PointPage';
import { ReceiptPage } from './ReceiptPage';

/**
 * The phone pages (terminal reference, sections 11 and 12): `useclear.org/p/A7K2`, the page behind a
 * Point's code, and `useclear.org/r/<code>`, the sticker receipt. The apex sends both here. No one is
 * signed in and nothing is installed, so this is its own small entry: no wallet, no router.
 */
export default function PhoneApp() {
  const route = phoneRoute(window.location.pathname);
  return (
    <main className="tm-page">
      {!route ? (
        <div className="tm-pbody">
          <p className="tm-psub">That link doesn’t go anywhere</p>
        </div>
      ) : route.page === 'point' ? (
        <PointPage code={route.code} />
      ) : (
        <ReceiptPage code={route.code} />
      )}
    </main>
  );
}
