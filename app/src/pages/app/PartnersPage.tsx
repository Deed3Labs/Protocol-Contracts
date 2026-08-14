import { useState } from 'react';
import { Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Card from '@/components/clear/Card';
import FilterChips from '@/components/clear/FilterChips';
import PartnerRows from '@/components/clear/PartnerRows';
import { PARTNERS_DATA } from '@/data/clearPlaceholder';
import { partnerCategories, type PartnersData } from '@/lib/clearModel';

/**
 * Clear Partners — design spec §7. Businesses that take Clear Pay.
 *
 * Reached from Send rather than the tab bar: it's a directory you consult when
 * you're about to pay someone, not a place to sit. The line under the title is
 * the whole argument for the page — a partner is paid instantly with no
 * processing fee, and the money stays inside the co-op.
 */
export default function PartnersPage({ data = PARTNERS_DATA }: { data?: PartnersData }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const categories = partnerCategories(data.partners);

  const term = query.trim().toLowerCase();
  const partners = data.partners.filter(
    (p) =>
      (category === 'all' || p.category === category) &&
      (term === '' ||
        p.name.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term) ||
        p.city.toLowerCase().includes(term)),
  );

  const list = (
    <PartnerRows
      partners={partners}
      emptyMessage={
        term || category !== 'all'
          ? 'No partners match — try another category.'
          : 'No partners near you yet.'
      }
    />
  );

  const refer = (
    <Card>
      <p className="mb-1.5 text-xs text-foreground-secondary">Know a business?</p>
      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        <span className="hidden lg:inline">Members refer most partners. </span>They get paid
        instantly with no processing fee.
      </p>
      <Button variant="clear" size="xs" className="w-full">
        Refer a business
      </Button>
    </Card>
  );

  return (
    <>
      <div className="mb-1.5 hidden items-center gap-2.5 lg:flex">
        <Store
          aria-hidden
          className="h-[18px] w-[18px] shrink-0 text-foreground-secondary"
          strokeWidth={1.75}
        />
        <h1 className="text-[17px] font-medium lg:text-xl">Clear Partners</h1>
      </div>
      <p className="mb-4 text-xs text-foreground-secondary">
        <span className="hidden lg:inline">
          {data.count} businesses in {data.region} accept Clear Pay. Paying them keeps money inside
          the co-op.
        </span>
        <span className="lg:hidden">{data.count} businesses accept Clear Pay nearby.</span>
      </p>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start lg:gap-6">
        <div>
          {/* Desktop keeps the field and the chips on one line; on a phone the
              chips need the full width to scroll. */}
          <div className="mb-3 lg:mb-4 lg:flex lg:items-center lg:gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search partners"
              aria-label="Search partners"
              className="h-9 min-w-0 text-xs lg:flex-1"
            />
            <FilterChips
              className="mt-3 lg:mt-0 lg:shrink-0"
              options={categories}
              value={category}
              onChange={setCategory}
            />
          </div>

          {list}
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:mt-0">
          {/* Map is a placeholder until there's a tile source — the note under it
              is the part that answers "why these?", so it ships either way. */}
          <Card className="hidden overflow-hidden p-0 lg:block">
            <div className="flex h-[150px] items-center justify-center bg-secondary text-xs text-muted-foreground">
              Map view
            </div>
            <p className="px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
              {data.radiusNote}
            </p>
          </Card>

          {refer}
        </div>
      </div>
    </>
  );
}
