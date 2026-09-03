import { ChevronLeft } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { dollars } from '@clear/domain';
import { Button, Inset } from '@/shell/ui';

/**
 * Showing the code — reference section 03.
 *
 * The default path, reached in two taps. There is no "how are they paying" screen before it and
 * there must not be one.
 *
 * **This code is not the customer's code.** The merchant's QR carries the charge — this amount, at
 * this shop — which is why the screen can say the amount is in it. The *customer's* code, offered
 * as a shortcut below, is identity only and carries no amount: a scanned customer code can never
 * move money on its own, because the figure being approved is the one the writer typed and the
 * payer can see.
 *
 * A tablet in a stand is what makes this natural: you turn the screen toward them, you never hand
 * over your device.
 */
export function ChargeCode({
  amount,
  merchantName,
  onBack,
  onSent,
}: {
  amount: number;
  merchantName: string;
  onBack: () => void;
  onSent: () => void;
}) {
  // The payload carries the charge, not the member: scanning it opens this amount at this shop.
  const payload = `https://merchants.useclear.org/c/${encodeURIComponent(
    `${merchantName}|${amount.toFixed(2)}`,
  )}`;

  return (
    <div className="mx-auto w-full max-w-[400px]">
      <div className="mb-4 flex items-center gap-2.5">
        <button type="button" onClick={onBack} aria-label="Back" className="text-[var(--clear-text-secondary)]">
          <ChevronLeft size={20} />
        </button>
        <span className="text-[16px] font-medium tabular-nums">{dollars(amount)}</span>
      </div>

      <p className="m-0 mb-4 text-[13px] text-[var(--clear-text-secondary)]">
        Turn the screen toward them.
      </p>

      <div className="mx-auto max-w-[230px]">
        <QRCodeSVG
          value={payload}
          level="M"
          marginSize={2}
          bgColor="#FAF9F5"
          fgColor="#2C2C2A"
          className="block h-auto w-full rounded-[10px]"
          title={`Charge for ${dollars(amount)} at ${merchantName}`}
        />
      </div>

      <p className="m-0 mb-[3px] mt-[18px] text-center text-[26px] font-medium tabular-nums">
        {dollars(amount)}
      </p>
      <p className="m-0 mb-[18px] text-center text-[12px] text-[var(--clear-text-muted)]">
        {merchantName} · the amount is in the code
      </p>

      <Inset className="mb-4 !py-3">
        <p className="m-0 text-[12px] leading-[1.6] text-[var(--clear-text-secondary)]">
          New to Clear? Scanning installs the app and starts signup with this charge already
          waiting.
        </p>
      </Inset>

      {/*
        The two shortcuts, under a rule and styled secondary. They are for a member who already has
        their code open or whose phone is dead — never a decision the writer has to make first.
      */}
      <div className="flex gap-2 border-t-[0.5px] border-[var(--clear-border)] pt-[13px]">
        <Button onClick={onSent} className="flex-1 !text-[12px]">
          Scan their code instead
        </Button>
        <Button onClick={onSent} className="flex-1 !text-[12px]">
          Enter phone number
        </Button>
      </div>
    </div>
  );
}
