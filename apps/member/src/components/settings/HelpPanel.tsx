import { useState } from 'react';
import { CMain, Rows } from '@/components/clear/brand/anatomy';
import { KvRow, Pane } from './SettingsKit';
import type { HelpTopic } from '@/lib/clearModel';

/**
 * Help — questions first, people second.
 *
 * The questions are the ones this product actually generates, not a generic FAQ. "Message support"
 * names how long support takes, because an unanswered "we'll get back to you" is worse than no
 * promise at all. Not drawn in the settings reference: the pane anatomy with the existing content.
 */
export default function HelpPanel({ topics, onDispute }: { topics: HelpTopic[]; onDispute?: () => void }) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const matched = term ? topics.filter((t) => t.question.toLowerCase().includes(term)) : topics;

  return (
    <>
      <div className="c-searchrow mb-s3">
        <input
          className="c-field"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help"
          aria-label="Search help"
        />
      </div>

      <Pane label="Common questions">
        <CMain>
          {matched.length === 0 ? (
            <p className="c-det">Nothing matches that. Message support and someone will answer.</p>
          ) : (
            <Rows>
              {matched.map((t) => (
                <div key={t.id}>
                  <KvRow label={t.question} onSelect={() => {}} />
                </div>
              ))}
            </Rows>
          )}
        </CMain>
      </Pane>

      <Pane label="Get in touch" className="mt-s3">
        <CMain>
          <Rows>
            <div>
              <KvRow label="Message support" value="Replies in ~4 hrs" onSelect={() => {}} />
            </div>
            <div>
              <KvRow label="Report a transaction" onSelect={() => {}} />
            </div>
            <div>
              <KvRow label="Dispute resolution" onSelect={onDispute} />
            </div>
          </Rows>
        </CMain>
      </Pane>
    </>
  );
}
