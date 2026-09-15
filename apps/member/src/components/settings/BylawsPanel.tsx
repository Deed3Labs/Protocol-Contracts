import { useState } from 'react';
import { Btn, CBar, CMain } from '@/components/clear/brand/anatomy';
import { Pane } from './SettingsKit';
import type { Bylaws } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * The bylaws, in full.
 *
 * Long-form legal text is unreadable as a wall, so jumping to an article and searching the text are
 * the page, pinned in the footer while you read. The version and date sit in the header because
 * these are amendable by member vote — which version you're reading is a real question here.
 */
export default function BylawsPanel({ bylaws }: { bylaws: Bylaws }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [jumping, setJumping] = useState(false);

  const term = query.trim().toLowerCase();
  const articles = term
    ? bylaws.articles
        .map((a) => ({
          ...a,
          clauses: a.clauses.filter(
            (c) => c.text.toLowerCase().includes(term) || a.title.toLowerCase().includes(term),
          ),
        }))
        .filter((a) => a.clauses.length > 0)
    : bylaws.articles;

  return (
    <Pane
      label={bylaws.version}
      aside={<span className="c-det">Updated {bylaws.updated}</span>}
      foot={
        <div className="c-pair">
          <Btn aria-pressed={jumping} onClick={() => setJumping((v) => !v)}>
            Jump to article
          </Btn>
          <Btn aria-pressed={searching} onClick={() => setSearching((v) => !v)}>
            Search
          </Btn>
        </div>
      }
    >
      {searching && (
        <CBar>
          <div className="c-searchrow">
            <input
              autoFocus
              className="c-field"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the bylaws"
              aria-label="Search the bylaws"
            />
          </div>
        </CBar>
      )}

      {jumping && (
        <CBar>
          <p className="c-label mb-s1">Jump to article</p>
          <div className="flex flex-wrap gap-s1">
            {bylaws.articles.map((article) => (
              <Btn
                key={article.id}
                className="h-[30px]! px-[12px]! text-detail!"
                onClick={() => {
                  setJumping(false);
                  document.getElementById(`article-${article.id}`)?.scrollIntoView({ block: 'start' });
                }}
              >
                {article.title.replace(' — ', ': ')}
              </Btn>
            ))}
          </div>
        </CBar>
      )}

      <CMain className="max-h-[420px] overflow-y-auto">
        {articles.length === 0 ? (
          <p className="c-det">Nothing in the bylaws matches that.</p>
        ) : (
          articles.map((article, i) => (
            <div key={article.id} id={`article-${article.id}`} className={cn(i > 0 && 'mt-s3')}>
              <p className="mb-s1 text-sec font-semibold">{article.title}</p>
              {article.clauses.map((clause) => (
                <p key={clause.number} className="mb-s1 text-sec text-ink-70">
                  <span className="text-ink">{clause.number}</span> {clause.text}
                </p>
              ))}
            </div>
          ))
        )}
      </CMain>
    </Pane>
  );
}
