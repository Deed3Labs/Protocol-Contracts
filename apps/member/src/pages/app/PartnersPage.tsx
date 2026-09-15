import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Btn, CBar, CFoot, CHead, CMain, Cell, Line, SecHead } from '@/components/clear/brand/anatomy';
import { BackIcon, ChevronIcon, SearchIcon } from '@/components/clear/brand/icons';
import MenuButton from '@/components/clear/brand/MenuButton';
import PartnerRows from '@/components/clear/PartnerRows';
import PartnerSheet from '@/components/clear/PartnerSheet';
import { PARTNERS_DATA } from '@/data/clearPlaceholder';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { partnerCategories, type Partner, type PartnersData } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/** How many partners the list opens with. */
const SHORTLIST = 6;

/**
 * Clear Partners — the directory Send's See all opens. A pane, not a modal, because it is a place.
 *
 * The list keeps the same row as Contacts and the same control bar as every other growing list, so
 * the only page-specific parts are the map and the referral note — and the referral note is the one
 * that matters, because members refer most partners. On desktop the list spans both rows of the
 * slab, beside the two short cells.
 */
export default function PartnersPage({ data = PARTNERS_DATA }: { data?: PartnersData }) {
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [alphabetical, setAlphabetical] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Partner | null>(null);

  const categories = partnerCategories(data.partners).map((c) => (c.id === 'all' ? { ...c, label: 'All categories' } : c));
  const term = query.trim().toLowerCase();
  const matching = data.partners.filter(
    (p) =>
      (category === 'all' || p.category === category) &&
      (term === '' ||
        p.name.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term) ||
        p.city.toLowerCase().includes(term)),
  );
  // Nearest is the order the directory arrives in; there is no distance to sort by yet.
  const ordered = alphabetical ? [...matching].sort((a, b) => a.name.localeCompare(b.name)) : matching;
  const shown = showAll ? ordered : ordered.slice(0, SHORTLIST);
  const narrowed = term !== '' || category !== 'all';
  const total = narrowed ? matching.length : data.count;

  const search = (
    <label className="c-searchfield">
      <span className="c-ic">
        <SearchIcon />
      </span>
      <input
        className="c-field c-bare"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search partners"
        aria-label="Search partners"
      />
    </label>
  );
  const buttons = (
    <>
      <MenuButton
        label={categories.find((c) => c.id === category)!.label}
        options={categories}
        value={category}
        onChange={setCategory}
      />
      <Btn className="c-linkish" aria-pressed={!alphabetical} onClick={() => setAlphabetical((a) => !a)}>
        {alphabetical ? 'A to Z' : 'Nearest'}
      </Btn>
    </>
  );

  const list = (
    <Cell className={cn(desktop && 'c-tall')}>
      <CHead>
        <SecHead label="Clear Partners">
          <span className="c-det">
            {data.count} within {data.radiusMiles} miles
          </span>
        </SecHead>
      </CHead>
      <CBar>
        {desktop ? (
          <div className="c-listctl">
            {search}
            {buttons}
          </div>
        ) : (
          <div className="c-ctlstack">
            {search}
            <div className="c-listctl c-nowrap">{buttons}</div>
          </div>
        )}
      </CBar>
      <CMain>
        <PartnerRows
          partners={shown}
          onSelect={setSelected}
          emptyMessage={narrowed ? 'No partners match. Try another category or search.' : 'No partners near you yet.'}
        />
      </CMain>
      <CFoot>
        <Line className="items-center!">
          <span className="c-det">
            {shown.length} of {total} shown &middot; Credit means you can split there
          </span>
          {ordered.length > shown.length && (
            <button type="button" onClick={() => setShowAll(true)} className="c-det inline-flex! items-center gap-1 hover:text-ink">
              Show all {ordered.length}
              <ChevronIcon />
            </button>
          )}
        </Line>
      </CFoot>
    </Cell>
  );

  const nearYou = (
    <Cell>
      <CHead>
        <SecHead label="Near you">
          <span className="c-det">{data.near}</span>
        </SecHead>
      </CHead>
      <CMain>
        <div className="c-mapbox" role="img" aria-label="Map of partners near you, not available yet">
          Map
        </div>
      </CMain>
      <CFoot>
        <p className="c-det">
          Partners shown are within {data.radiusMiles} miles. Change your ZIP in Settings to look somewhere else.
        </p>
      </CFoot>
    </Cell>
  );

  const refer = (
    <Cell>
      <CHead>
        <SecHead label="Know a business?">
          <p className="c-fig c-fig-sec">{data.referrals === 0 ? 'None' : data.referrals}</p>
        </SecHead>
      </CHead>
      <CMain>
        <p className="c-det">
          Members refer most partners. They are paid instantly when you pay from your balance, with no processing fee
          taken out of it.
        </p>
      </CMain>
      <CFoot>
        <Btn lg>Refer a business</Btn>
      </CFoot>
    </Cell>
  );

  return (
    <>
      {desktop && (
        <Link to="/send" className="c-paneback mb-[6px]! w-fit">
          <BackIcon className="text-ink-50" />
          <span className="c-panetitle">Clear Partners</span>
        </Link>
      )}
      <p className="c-det mb-s3 max-w-[66ch]">
        {desktop
          ? `${data.count} businesses in ${data.region} accept Clear. Paying them keeps money inside the co-op, and those marked Credit also let you split a purchase over cycles.`
          : `${data.count} businesses accept Clear within ${data.radiusMiles} miles.`}
      </p>

      <div className={cn('c-slab', !desktop && 'c-one')}>
        {list}
        {nearYou}
        {refer}
      </div>

      {selected && (
        <PartnerSheet
          partner={selected}
          open={selected !== null}
          onOpenChange={(o) => !o && setSelected(null)}
          onPay={() => navigate('/scan')}
        />
      )}
    </>
  );
}
