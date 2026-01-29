import ActionModal from "@/components/portfolio/ActionModal";
import { TradeModal } from "@/components/portfolio/TradeModal";
import { useGlobalModals } from "@/context/GlobalModalsContext";

/**
 * Global Modals Component
 * Renders ActionModal and TradeModal that are shared across all pages
 * State is managed via GlobalModalsContext
 */
export default function GlobalModals() {
  const {
    actionModalOpen,
    setActionModalOpen,
    tradeModalOpen,
    setTradeModalOpen,
    tradeModalType,
    tradeModalAsset,
    openTradeModal,
  } = useGlobalModals();

  return (
    <>
      {/* Global ActionModal - accessible from any page */}
      <ActionModal
        isOpen={actionModalOpen}
        onClose={() => setActionModalOpen(false)}
        onSwapClick={() => openTradeModal('swap', null)}
      />
      
      {/* Global TradeModal - accessible from any page */}
      <TradeModal
        open={tradeModalOpen}
        onOpenChange={setTradeModalOpen}
        initialTradeType={tradeModalType}
        initialAsset={tradeModalAsset}
      />
    </>
  );
}
