import ActionModal from "@/components/portfolio/ActionModal";
import SendFundsModal from "@/components/portfolio/SendFundsModal";
import { TradeModal } from "@/components/portfolio/TradeModal";
import SearchModal from "@/components/portfolio/SearchModal";
import XMTPMessaging from "@/components/XMTPMessaging";
import { useGlobalModals } from "@/context/GlobalModalsContext";

/**
 * Global Modals Component
 * Renders ActionModal, TradeModal, SearchModal, and XMTPMessaging that are shared across all pages
 * State is managed via GlobalModalsContext
 */
export default function GlobalModals() {
  const {
    actionModalOpen,
    setActionModalOpen,
    sendFundsModalOpen,
    setSendFundsModalOpen,
    tradeModalOpen,
    setTradeModalOpen,
    tradeModalType,
    tradeModalAsset,
    searchModalOpen,
    setSearchModalOpen,
    searchQuery,
    setSearchQuery,
    selectedCategories,
    setSelectedCategories,
    xmtpModalOpen,
    setXmtpModalOpen,
    xmtpConversationId,
    openTradeModal,
    openSendFundsModal,
  } = useGlobalModals();

  // Filter categories for search (same as HeaderNav)
  const filterCategories = [
    'Technology',
    'Finance',
    'Healthcare',
    'Energy',
    'Real Estate',
    'Consumer',
    'Crypto & DeFi',
    'ESG',
    'Growth',
    'Value',
    'Dividend',
  ];

  const handleCategoryToggle = (category: string) => {
    setSelectedCategories((prev: string[]) => {
      if (prev.includes(category)) {
        return prev.filter((c: string) => c !== category);
      } else {
        return [...prev, category];
      }
    });
  };

  const handleSearchModalClose = () => {
    setSearchModalOpen(false);
  };

  return (
    <>
      {/* Global ActionModal - accessible from any page */}
      <ActionModal
        isOpen={actionModalOpen}
        onClose={() => setActionModalOpen(false)}
        onSwapClick={() => openTradeModal('swap', null)}
        onSendFundsClick={() => openSendFundsModal()}
      />

      <SendFundsModal
        open={sendFundsModalOpen}
        onOpenChange={setSendFundsModalOpen}
      />
      
      {/* Global TradeModal - accessible from any page */}
      <TradeModal
        open={tradeModalOpen}
        onOpenChange={setTradeModalOpen}
        initialTradeType={tradeModalType}
        initialAsset={tradeModalAsset}
      />
      
      {/* Global SearchModal - accessible from any page */}
      <SearchModal
        isOpen={searchModalOpen}
        onClose={handleSearchModalClose}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedCategories={selectedCategories}
        onCategoryToggle={handleCategoryToggle}
        filterCategories={filterCategories}
      />
      
      {/* Global XMTPMessaging - accessible from any page */}
      <XMTPMessaging
        isOpen={xmtpModalOpen}
        onClose={() => setXmtpModalOpen(false)}
        initialConversationId={xmtpConversationId}
      />
      
      {/* ProfileMenu is rendered in HeaderNav (needs relative positioning) but uses global state */}
    </>
  );
}
