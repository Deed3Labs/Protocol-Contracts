import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Modal from '@/components/clear/Modal';
import { Btn } from '@/components/clear/brand/anatomy';
import PinBox from '@/components/clear/auth/PinBox';

/**
 * Setting up an authenticator app — the payment check for a device without Face ID.
 *
 * Scan the code (or type the key), then enter the six digits the app shows, which proves the app has
 * it before anything relies on it. From then on Privy asks for a code from the app before the wallet
 * signs a payment.
 *
 * The QR is drawn here from the otpauth link Privy returns; the secret never leaves this sheet.
 */
export default function AuthenticatorDialog({
  open,
  onOpenChange,
  onStart,
  onConfirm,
  busy,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: () => Promise<{ secret: string; authUrl: string } | null>;
  onConfirm: (code: string) => Promise<boolean>;
  busy: boolean;
  error: string | null;
}) {
  const [setup, setSetup] = useState<{ secret: string; authUrl: string } | null>(null);
  const [code, setCode] = useState('');

  // A fresh secret each time the sheet opens: one abandoned halfway is never reused.
  useEffect(() => {
    if (!open) return;
    setSetup(null);
    setCode('');
    void onStart().then(setSetup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const confirm = async () => {
    if (await onConfirm(code)) onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Authenticator app"
      description="Payments will ask for a code from this app before they go."
      footer={
        <>
          {error && <p className="c-det c-errline mb-s1">{error}</p>}
          <Btn primary lg disabled={!setup || code.length !== 6 || busy} onClick={() => void confirm()}>
            {busy ? 'Checking…' : 'Turn on'}
          </Btn>
          <p className="c-det mt-s1 text-center">Face ID still works where you have it; this is the backup.</p>
        </>
      }
    >
      <p className="c-det mb-s2">
        1. In Google Authenticator, 1Password or any authenticator app, scan this code.
      </p>
      <div className="mb-s2 flex justify-center">
        {setup ? (
          <div className="rounded-md bg-white p-3" aria-label="Authenticator setup code">
            <QRCodeSVG value={setup.authUrl} size={168} level="M" />
          </div>
        ) : (
          <div className="c-skel h-[192px] w-[192px] rounded-md" aria-hidden />
        )}
      </div>
      {setup && (
        <p className="c-det mb-s3 break-all text-center">
          Or type this key: <span className="font-mono text-ink">{setup.secret}</span>
        </p>
      )}
      <p className="c-det mb-s1">2. Enter the six digits it shows.</p>
      <PinBox value={code} onChange={setCode} label="Code from your authenticator app" />
    </Modal>
  );
}
