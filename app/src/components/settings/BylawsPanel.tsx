import { useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Card from '@/components/clear/Card';
import type { Bylaws } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * The bylaws, in full.
 *
 * Long-form legal text is unreadable as a wall, so the two controls at the bottom
 * are the page: jump to an article, or search the text. Both stay pinned while
 * you read rather than scrolling away at the end.
 *
 * The version and date sit at the top because these are amendable by member vote
 * — which version you're reading is a real question here, not boilerplate.
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
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs text-foreground-secondary">
          {bylaws.version} · Updated {bylaws.updated}
        </span>
        <button
          type="button"
          aria-label="Search the bylaws"
          aria-pressed={searching}
          onClick={() => setSearching((v) => !v)}
          className="text-foreground-secondary transition-colors hover:text-foreground"
        >
          <Search className="h-[15px] w-[15px]" strokeWidth={1.75} />
        </button>
      </div>

      {searching && (
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the bylaws"
          aria-label="Search the bylaws"
          className="mb-3 h-9 text-xs"
        />
      )}

      {jumping && (
        <Card className="mb-3 px-3.5 py-3">
          <p className="mb-1.5 text-[11px] text-foreground-secondary">Jump to article</p>
          <div className="flex flex-wrap gap-1.5">
            {bylaws.articles.map((article) => (
              <Button
                key={article.id}
                variant="clear"
                size="xs"
                onClick={() => {
                  setJumping(false);
                  document
                    .getElementById(`article-${article.id}`)
                    ?.scrollIntoView({ block: 'start' });
                }}
              >
                {article.title.replace(' — ', ': ')}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <div className="max-h-[420px] overflow-y-auto pr-1 text-xs leading-relaxed">
        {articles.length === 0 ? (
          <p className="py-3 text-muted-foreground">Nothing in the bylaws matches that.</p>
        ) : (
          articles.map((article, i) => (
            <div key={article.id} id={`article-${article.id}`} className={cn(i > 0 && 'mt-4')}>
              <p className="mb-1.5 text-[13px] font-medium">{article.title}</p>
              {article.clauses.map((clause) => (
                <p key={clause.number} className="mb-2 text-foreground-secondary">
                  <span className="text-foreground">{clause.number}</span> {clause.text}
                </p>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="mt-3.5 flex gap-2">
        <Button
          variant="clear"
          size="xs"
          className="flex-1"
          aria-pressed={jumping}
          onClick={() => setJumping((v) => !v)}
        >
          Jump to article
        </Button>
        <Button
          variant="clear"
          size="xs"
          className="flex-1"
          aria-pressed={searching}
          onClick={() => setSearching((v) => !v)}
        >
          Search
        </Button>
      </div>
    </>
  );
}
