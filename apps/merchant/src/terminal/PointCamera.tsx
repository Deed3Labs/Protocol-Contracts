import { useState } from 'react';
import { CodeScanner, type CameraState } from '@/charge/CodeScanner';
import { pointCodeFrom } from './pointCode';

/**
 * Add a Point, step 1, on a tablet: the camera behind the reference's aim box, reading the QR on the
 * back of the Point. A code that isn't a Point's is passed over; the camera keeps looking.
 */
export function PointCamera({ onCode }: { onCode: (code: string) => boolean }) {
  const [state, setState] = useState<CameraState>('starting');
  return (
    <div className="c-tm-vf" style={{ position: 'relative', overflow: 'hidden' }}>
      <CodeScanner
        onState={setState}
        onCode={(raw) => {
          const code = pointCodeFrom(raw);
          return code ? onCode(code) : false;
        }}
        offline={{
          blocked: 'The camera is off for this app. Allow it in the tablet’s settings, or type the code instead.',
          unsupported: 'This browser can’t use the camera. Type the code instead.',
        }}
      />
      {state === 'scanning' && (
        <>
          <div className="c-tm-vfbox" style={{ position: 'relative', zIndex: 1 }} />
          <p style={{ position: 'relative', zIndex: 1, margin: 0, textShadow: '0 1px 2px rgba(0,0,0,.6)' }}>Point the camera at the code on the back of the Point</p>
        </>
      )}
    </div>
  );
}
