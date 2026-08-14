import { useState } from 'react';
import { ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Card from '@/components/clear/Card';

/**
 * Scan to pay — design spec §7.
 *
 * The camera fills the screen because there's exactly one thing to do here.
 * "Enter a code instead" is the escape hatch that keeps the page usable when the
 * camera is refused, the light is bad, or the code is on a screen too small to
 * read — which is most of the times this fails.
 *
 * The viewfinder is a placeholder until camera permission is wired; the layout
 * and the fallback are what the page needs either way.
 */
export default function ScanPage() {
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');

  return (
    <div className="lg:mx-auto lg:max-w-[420px]">
      <h1 className="mb-4 hidden text-xl font-medium lg:block">Scan to pay</h1>

      <Card className="mb-3 flex aspect-square flex-col items-center justify-center gap-3 bg-secondary">
        <ScanLine
          aria-hidden
          className="h-10 w-10 text-muted-foreground"
          strokeWidth={1.25}
        />
        <p className="text-xs text-muted-foreground">Point at a Clear code</p>
      </Card>

      {manual ? (
        <>
          <label className="mb-1.5 block text-xs text-foreground-secondary" htmlFor="clear-code">
            Clear code or @handle
          </label>
          <Input
            id="clear-code"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="@kaim"
            className="mb-3 h-9 text-xs"
          />
          <Button size="xs" className="w-full" disabled={!code.trim()}>
            Continue
          </Button>
        </>
      ) : (
        <Button variant="clear" size="sm" className="w-full text-xs" onClick={() => setManual(true)}>
          Enter a code instead
        </Button>
      )}
    </div>
  );
}
