/**
 * Inventory — in the nav now, built in Phase 4 from docs/merchant-reference/clear-merchant-inventory.html.
 *
 * The reference puts Inventory in the nav for every role, so the destination exists before the
 * page does. Until then it says so plainly rather than borrowing the reference's empty state,
 * which would claim the shop has no items.
 */
export default function InventoryPage() {
  return (
    <div className="c-slab c-one">
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Inventory</p>
          </div>
        </div>
        <div className="c-cmain">
          <p className="c-det">Coming with the Inventory page.</p>
        </div>
      </div>
    </div>
  );
}
