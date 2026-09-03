import { ChevronRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LegalDoc } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Every document the member is bound by, in one place.
 *
 * Versions are shown because they change: an agreement someone accepted at v2.1
 * isn't the same agreement as today's, and a co-op that amends its own bylaws by
 * member vote has to be able to say which version you agreed to. Download all is
 * the point of the page for anyone who wants their own copy.
 */
export default function LegalPanel({
  docs,
  onOpen,
}: {
  docs: LegalDoc[];
  onOpen?: (doc: LegalDoc) => void;
}) {
  return (
    <>
      <div className="text-[13px]">
        {docs.map((doc, i) => (
          <button
            key={doc.id}
            type="button"
            onClick={() => onOpen?.(doc)}
            className={cn(
              'flex w-full items-center justify-between gap-3 py-2.5 text-left transition-colors',
              i < docs.length - 1 && 'border-b-[0.5px] border-border',
            )}
          >
            <span className="min-w-0">
              <span className="block truncate">{doc.label}</span>
              {doc.detail && (
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {doc.detail}
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {doc.version && <span className="text-xs text-muted-foreground">{doc.version}</span>}
              <ChevronRight className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.75} />
            </span>
          </button>
        ))}
      </div>

      <Button variant="clear" size="xs" className="mt-3.5 w-full">
        <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
        Download all as PDF
      </Button>
    </>
  );
}
