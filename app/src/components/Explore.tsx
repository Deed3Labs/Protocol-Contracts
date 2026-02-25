import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Eye, RefreshCw } from "lucide-react";
import { useDeedNFTData } from "@/hooks/useDeedNFTData";
import { useState } from "react";
import DeedNFTViewer from "./DeedNFTViewer";
import DeedNFTMap from "./DeedNFTMap";
import MakeOfferModal from "./MakeOfferModal";
import DeedCard from "./DeedCard";
import type { DeedNFT } from "@/hooks/useDeedNFTData";

const Explore = () => {
  const {
    deedNFTs,
    loading,
    error,
    fetchDeedNFTs,
    getAssetTypeLabel,
    getValidationStatus,
    isConnected,
    isCorrectNetwork,
    currentChainId,
    contractAddress,
    address
  } = useDeedNFTData();

  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [selectedDeedNFT, setSelectedDeedNFT] = useState<DeedNFT | null>(null);
  const [offerDeedNFT, setOfferDeedNFT] = useState<DeedNFT | null>(null);
  const [isOfferModalOpen, setIsOfferModalOpen] = useState(false);

  const filteredDeedNFTs = deedNFTs.filter(deedNFT => {
    const matchesSearch = deedNFT.definition.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         getAssetTypeLabel(deedNFT.assetType).toLowerCase().includes(searchTerm.toLowerCase()) ||
                         deedNFT.tokenId.includes(searchTerm);
    
    const matchesFilter = filterType === "all" || 
                         (filterType === "validated" && getValidationStatus(deedNFT).status === "Validated") ||
                         (filterType === "pending" && getValidationStatus(deedNFT).status === "Pending") ||
                         (filterType === "land" && deedNFT.assetType === 0) ||
                         (filterType === "vehicle" && deedNFT.assetType === 1) ||
                         (filterType === "estate" && deedNFT.assetType === 2) ||
                         (filterType === "equipment" && deedNFT.assetType === 3);

    return matchesSearch && matchesFilter;
  });

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchTerm(searchInput);
  };

  const handleSearchClear = () => {
    setSearchInput("");
    setSearchTerm("");
  };

  const handleViewDetails = (deedNFT: DeedNFT) => {
    setSelectedDeedNFT(deedNFT);
  };

  const handleMakeOffer = (deedNFT: DeedNFT) => {
    setOfferDeedNFT(deedNFT);
    setIsOfferModalOpen(true);
  };

  const handleCloseOfferModal = () => {
    setIsOfferModalOpen(false);
    setOfferDeedNFT(null);
  };

  return (
    <main className="container mx-auto pt-4 pb-12 px-4">

      {/* Debug Information */}
      {isConnected && isCorrectNetwork && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-blue-800 dark:text-blue-200 text-sm">
            <strong>Debug Info:</strong> Chain ID: {currentChainId}, Contract: {contractAddress}, 
            Total T-Deeds: {deedNFTs.length}, Filtered: {filteredDeedNFTs.length}
          </p>
          <p className="text-blue-700 dark:text-blue-300 text-xs mt-1">
            Connection Status: {isConnected ? 'Connected' : 'Disconnected'} | 
            Network: {isCorrectNetwork ? 'Correct' : 'Incorrect'} | 
            Address: {address ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : 'None'}
          </p>
        </div>
      )}

      {/* Connection Status */}
      {!isConnected && (
        <div className="text-center mb-8">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-yellow-800 dark:text-yellow-200">
              Please connect your wallet to explore T-Deeds
            </p>
          </div>
        </div>
      )}

      {!isCorrectNetwork && isConnected && (
        <div className="text-center mb-8">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-red-800 dark:text-red-200">
              Please switch to a supported network to explore T-Deeds
            </p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="text-center mb-8">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        </div>
      )}

      {/* Map Section - Only show if connected and on correct network */}
      {isConnected && isCorrectNetwork && !loading && deedNFTs.length > 0 && (
        <div className="mb-8">
          <DeedNFTMap
            deedNFTs={deedNFTs}
            onDeedNFTSelect={handleViewDetails}
            getAssetTypeLabel={getAssetTypeLabel}
            getValidationStatus={getValidationStatus}
          />
        </div>
      )}

      {/* Search and Filter Bar */}
      <div className="w-full mb-8">
        <div className="flex flex-row gap-2">
          {/* Search Input - Takes up 2/3 of the space */}
          <form onSubmit={handleSearchSubmit} className="flex-[2] min-w-0 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search T-Deeds... (Press Enter to search)"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-black/10 dark:border-white/10 rounded-lg bg-white dark:bg-[#141414] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent h-11"
            />
            {(searchInput || searchTerm) && (
              <button
                type="button"
                onClick={handleSearchClear}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                ✕
              </button>
            )}
          </form>
          
          {/* Filter Dropdown - Takes up 1/3 of the space */}
          <div className="flex-1 min-w-0">
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-full h-11 border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="validated">Validated</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="land">Land</SelectItem>
                <SelectItem value="vehicle">Vehicle</SelectItem>
                <SelectItem value="estate">Estate</SelectItem>
                <SelectItem value="equipment">Equipment</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Refresh Button */}
          <div className="flex-shrink-0">
            <Button 
              onClick={fetchDeedNFTs}
              disabled={loading}
              variant="outline" 
              className="h-11 w-11 md:w-auto md:px-4 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] dark:bg-[#141414] flex-shrink-0"
            >
              <RefreshCw className={`w-4 h-4 md:mr-1 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">Refresh</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-white mx-auto"></div>
          <p className="text-gray-600 dark:text-gray-300 mt-4">Loading T-Deeds from blockchain...</p>
        </div>
      )}

      {/* No Results */}
      {!loading && filteredDeedNFTs.length === 0 && (
        <div className="text-center py-12">
          <Eye className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p className="text-gray-600 dark:text-gray-300 text-lg">
            {deedNFTs.length === 0 ? "No T-Deeds found on this network" : "No T-Deeds match your search"}
          </p>
          <p className="text-gray-500 dark:text-gray-400 mt-2">
            {deedNFTs.length === 0 ? "Be the first to mint a T-Deed!" : "Try adjusting your search or filter criteria"}
          </p>
        </div>
      )}

      {/* T-Deeds Grid */}
      {!loading && filteredDeedNFTs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
          {filteredDeedNFTs.map((deedNFT) => {
            const validationStatus = getValidationStatus(deedNFT);
            const assetTypeLabel = getAssetTypeLabel(deedNFT.assetType);
            
            return (
              <DeedCard
                key={deedNFT.tokenId}
                deedNFT={deedNFT}
                validationStatus={validationStatus}
                assetTypeLabel={assetTypeLabel}
                onViewDetails={handleViewDetails}
                onMakeOffer={handleMakeOffer}
              />
            );
          })}
        </div>
      )}

      {/* Results Count */}
      {!loading && filteredDeedNFTs.length > 0 && (
        <div className="text-center mt-8">
          <p className="text-gray-500 dark:text-gray-400">
            Showing {filteredDeedNFTs.length} of {deedNFTs.length} T-Deeds
          </p>
        </div>
      )}

      {/* DeedNFT Viewer Modal */}
      {selectedDeedNFT && (
        <DeedNFTViewer 
          deedNFT={selectedDeedNFT} 
          isOpen={!!selectedDeedNFT}
          onClose={() => setSelectedDeedNFT(null)}
          getAssetTypeLabel={getAssetTypeLabel}
          getValidationStatus={getValidationStatus}
        />
      )}

      {/* Make Offer Modal */}
      {offerDeedNFT && (
        <MakeOfferModal
          isOpen={isOfferModalOpen}
          onClose={handleCloseOfferModal}
          assetType="deed"
          assetId={offerDeedNFT.tokenId}
          assetName={getAssetTypeLabel(offerDeedNFT.assetType)}
        />
      )}
    </main>
  );
};

export default Explore; 