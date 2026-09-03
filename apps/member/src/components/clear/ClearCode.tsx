import { QRCodeSVG } from 'qrcode.react';
import Card from './Card';

/**
 * Your Clear code — design spec §7.
 *
 * Two treatments. On mobile the code leads the page, so it's larger and needs no
 * heading — the caption carries it. On desktop it sits in the right-hand column
 * beside the search, smaller and titled, because showing a monitor to a camera
 * isn't how a desktop payment starts.
 *
 * The QR keeps fixed colors in every theme rather than following the tokens.
 * Inverting a code (light modules on dark) is legal but not universally
 * supported by scanners, and a code that fails to scan is worse than one that
 * doesn't match the page. Same reasoning as the card face.
 */
export default function ClearCode({
  handle,
  codeUrl,
  variant = 'lead',
}: {
  handle: string;
  codeUrl: string;
  /** `lead` — mobile, large and captioned. `titled` — desktop, smaller with a heading. */
  variant?: 'lead' | 'titled';
}) {
  const size = variant === 'lead' ? 130 : 110;

  return (
    <Card className="flex flex-col items-center py-4 text-center">
      <div
        className={variant === 'lead' ? 'mb-2.5 rounded-lg p-3' : 'mb-3 rounded-lg p-2.5'}
        style={{ backgroundColor: '#F1EFE8' }}
      >
        <QRCodeSVG
          value={codeUrl}
          size={size}
          bgColor="#F1EFE8"
          fgColor="#2C2C2A"
          level="M"
          title={`Clear code for ${handle}`}
        />
      </div>

      {variant === 'titled' ? (
        <>
          <p className="mb-[3px] text-[13px]">Your Clear code</p>
          <p className="text-xs text-muted-foreground">Show this to get paid · {handle}</p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Show to get paid · {handle}</p>
      )}
    </Card>
  );
}
