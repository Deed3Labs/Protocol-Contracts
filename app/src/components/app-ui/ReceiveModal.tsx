import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, QrCode } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAppKitAccount } from '@/lib/walletCompat';

/*
 * "Receive" — shows the user's deposit address (their smart wallet for email/social, their own EOA for
 * external) as a QR + copyable string. Send USDC on Base here; it lands in their account. The smart
 * wallet is counterfactual (not deployed until the first tx), but ERC-20 transfers to its address are
 * safe — the funds are there when it deploys.
 */
export default function ReceiveModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { address } = useAppKitAccount();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[420px]">
        <div className="p-5">
          <div className="mb-1 flex items-center gap-2 text-base font-semibold text-foreground">
            <QrCode className="h-[18px] w-[18px]" /> Receive
          </div>
          <p className="mb-5 text-xs text-muted-foreground">
            Send <span className="font-medium text-foreground">USDC on Base</span> to this address — it lands in your account.
          </p>

          {address ? (
            <>
              <div className="mx-auto mb-4 w-fit rounded-2xl bg-white p-3 shadow-sm">
                <QRCodeSVG value={address} size={184} bgColor="#ffffff" fgColor="#000000" level="M" />
              </div>

              <div className="rounded-xl border border-border bg-secondary/40 p-3">
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">Your deposit address</div>
                <div className="break-all font-mono text-xs leading-relaxed text-foreground">{address}</div>
              </div>

              <button
                type="button"
                onClick={copy}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" /> Copy address
                  </>
                )}
              </button>

              <p className="mt-3 text-center text-[11px] text-muted-foreground">
                Only send assets on <span className="font-medium text-foreground">Base</span> to this address.
              </p>
            </>
          ) : (
            <div className="rounded-xl border border-border bg-secondary/40 p-4 text-center text-sm text-muted-foreground">
              Setting up your wallet… check back in a moment.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
