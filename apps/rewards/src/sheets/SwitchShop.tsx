import { useNavigate } from 'react-router-dom';
import { useRead } from '../data/context';
import { Chevron, Tick } from '../icons';
import { tileStyle } from '../lib/brand';
import { Sheet } from '../shell/ui';
import { word } from '../screens/parts';

/** The switcher: a sheet over the shop, the current one ticked. */
export function SwitchShopSheet({ current, onClose }: { current: string; onClose: () => void }) {
  const navigate = useNavigate();
  const shops = useRead((d) => d.myShops(), []);
  return (
    <Sheet onClose={onClose}>
      <div className="sa-m">
        <p className="sa-mono">SWITCH SHOP</p>
      </div>
      <div className="sa-m sa-lines" style={{ paddingTop: 0 }}>
        {(shops.data?.shops ?? []).map((s) => (
          <div key={s.slug} className="sa-shop tap" role="button" onClick={() => (s.slug === current ? onClose() : navigate(`/shops/${s.slug}`))}>
            <span className="sa-logo" style={tileStyle(s.brand)}>
              {s.brand.monogram}
            </span>
            <div>
              <p className="t">{s.name}</p>
              <p className="det">
                {s.unit === 'visits' && s.cardSize ? `${s.points} of ${s.cardSize} ${word(s.pointsName, 2)}` : `${s.points} ${word(s.pointsName, s.points)}`}
                {s.slug === current ? ' · open now' : ''}
              </p>
            </div>
            <span className="sa-end">{s.slug === current ? <Tick /> : <Chevron />}</span>
          </div>
        ))}
      </div>
      <div className="sa-m">
        <button className="sa-btn wide" onClick={() => navigate('/')}>
          All shops
        </button>
        <button className="sa-btn k wide" onClick={() => navigate('/scan')}>
          Add a shop
        </button>
      </div>
    </Sheet>
  );
}
