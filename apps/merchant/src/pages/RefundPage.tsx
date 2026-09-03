import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Inset } from '@/shell/ui';
import { ALL_CHARGES } from '@/data/stubs';

/**
 * The refund flow — reference section 16.
 *
 * Three steps with a visible transfer of authority: a writer reviews, an owner authorises, and
 * nothing is said to the customer until the owner approves. Built next.
 *
 * A placeholder rather than no route: "Start a refund" is a control a writer will press, and a
 * control that silently returns them to Home teaches them the button is broken.
 */
export default function RefundPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const charge = ALL_CHARGES.find((c) => c.id === id);
  if (!charge) return <Navigate to="/charges" replace />;

  return (
    <div className="mx-auto w-full max-w-[400px]">
      <div className="mb-4 flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => navigate(`/charges/${charge.id}`)}
          aria-label="Back"
          className="text-[var(--clear-text-secondary)]"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="text-[16px] font-medium">Refund</span>
      </div>
      <Inset>
        <p className="m-0 text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
          The three-step refund is built next, from reference section 16. Nothing has been started
          and nothing has moved.
        </p>
      </Inset>
    </div>
  );
}
