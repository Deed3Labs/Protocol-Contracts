import { QRCodeSVG } from 'qrcode.react';
import Card from './Card';

/**
 * Your Clear code — design spec §7. Leads the page on mobile, because showing it
 * is the fastest way to get paid.
 *
 * The QR keeps fixed colors in every theme rather than following the tokens.
 * Inverting a code (light modules on dark) is legal but not universally
 * supported by scanners, and a code that fails to scan is worse than one that
 * doesn't match the page. Same reasoning as the card face.
 */
export default function ClearCode({ handle, codeUrl }: { handle: string; codeUrl: string }) {
  return (
    <Card className="flex flex-col items-center py-4">
      <div className="mb-2.5 rounded-lg p-3" style={{ backgroundColor: '#F1EFE8' }}>
        <QRCodeSVG
          value={codeUrl}
          size={130}
          bgColor="#F1EFE8"
          fgColor="#2C2C2A"
          level="M"
          title={`Clear code for ${handle}`}
        />
      </div>
      <p className="text-xs text-muted-foreground">Show to get paid · {handle}</p>
    </Card>
  );
}
