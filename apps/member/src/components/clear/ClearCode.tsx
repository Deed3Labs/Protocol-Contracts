import { QRCodeSVG } from 'qrcode.react';

/**
 * The member's Clear code — the QR itself, square, on paper-2 with 8px of quiet zone.
 *
 * Border-box: padding on a content-box element inside a fixed-width container overflowed its own box
 * and read as shifted left. Ink modules on paper-2 are dark-on-light, which every scanner reads.
 */
export default function ClearCode({ handle, codeUrl, width }: { handle: string; codeUrl: string; width: number }) {
  return (
    <div className="mx-auto" style={{ width }}>
      <div className="box-border bg-paper-2 p-s1">
        <QRCodeSVG
          value={codeUrl}
          size={width - 16}
          bgColor="var(--paper-2)"
          fgColor="var(--ink)"
          level="M"
          title={`Clear code for ${handle}`}
          style={{ display: 'block', width: '100%', height: 'auto' }}
        />
      </div>
    </div>
  );
}
