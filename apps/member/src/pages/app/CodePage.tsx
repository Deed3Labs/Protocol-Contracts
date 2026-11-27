import { CFoot, CMain, Cell } from '@/components/clear/brand/anatomy';
import ClearCode from '@/components/clear/ClearCode';
import CodeFoot from '@/components/clear/CodeFoot';
import { SEND_DAY_ONE } from '@/data/clearPlaceholder';
import type { SendData } from '@/lib/clearModel';

/**
 * Your code, full screen — one half of the counter moment. The code is not a payment: it says who
 * you are, the shop enters the figure, and you approve it on your own phone.
 */
export default function CodePage({ data = SEND_DAY_ONE }: { data?: SendData }) {
  const identity = [data.name, data.memberSince && `Member since ${data.memberSince}`].filter(Boolean).join(' · ');

  return (
    <div className="lg:mx-auto lg:max-w-[420px]">
      <div className="py-s3 text-center">
        <ClearCode handle={data.handle} codeUrl={data.codeUrl} width={250} />
        <p className="c-fig c-fig-sec mt-s3">{data.handle}</p>
        {identity && <p className="c-det mt-[6px]">{identity}</p>}
      </div>
      <div className="c-slab c-one">
        <Cell>
          <CMain>
            <p className="c-det">
              Hold it up at the counter. It says who you are, not an amount. The shop enters the figure and you
              approve it on this phone.
            </p>
          </CMain>
          <CFoot>
            <CodeFoot available={data.available ?? 0} atPartners={data.atPartners ?? 0} />
          </CFoot>
        </Cell>
      </div>
    </div>
  );
}
