import { useState } from 'react';
import { Input } from '@/components/ui/input';
import SettingRows from '@/components/clear/SettingRows';
import type { HelpTopic } from '@/lib/clearModel';

/**
 * Help — questions first, people second.
 *
 * The four questions are the ones this product actually generates, not a generic
 * FAQ: the limit, the credits, the rebalance, the home. "Get in touch" names how
 * long support takes, because an unanswered "we'll get back to you" is worse than
 * no promise at all.
 */
export default function HelpPanel({
  topics,
  onDispute,
}: {
  topics: HelpTopic[];
  onDispute?: () => void;
}) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const matched = term ? topics.filter((t) => t.question.toLowerCase().includes(term)) : topics;

  return (
    <>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search help"
        aria-label="Search help"
        className="mb-4 h-9 text-xs"
      />

      <p className="mb-0.5 text-[11px] text-foreground-secondary">Common questions</p>
      {matched.length === 0 ? (
        <p className="py-3 text-xs text-muted-foreground">
          Nothing matches that. Message support and someone will answer.
        </p>
      ) : (
        <SettingRows rows={matched.map((t) => ({ label: t.question }))} />
      )}

      <p className="mb-0.5 mt-4 text-[11px] text-foreground-secondary">Get in touch</p>
      <SettingRows
        rows={[
          { label: 'Message support', value: 'Replies in ~4 hrs' },
          { label: 'Report a transaction' },
          { label: 'Dispute resolution', onSelect: onDispute },
        ]}
      />
    </>
  );
}
