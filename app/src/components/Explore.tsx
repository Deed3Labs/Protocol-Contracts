import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Eye, RefreshCw } from "lucide-react";
import { useDeedNFTData } from "@/hooks/useDeedNFTData";
import { useState } from "react";
import DeedNFTViewer from "./DeedNFTViewer";
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
    contractAddress
  } = useDeedNFTData();

  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [selectedDeedNFT, setSelectedDeedNFT] = useState<DeedNFT | null>(null);

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

  const handleViewDetails = (deedNFT: DeedNFT) => {
    setSelectedDeedNFT(deedNFT);
  };

  return (
    <main className="container mx-auto py-12 px-4">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white mb-4">
          Explore DeedNFTs
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
          Discover and browse existing DeedNFTs on the protocol.
        </p>
      </div>

      {/* Debug Information */}
      {isConnected && isCorrectNetwork && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-blue-800 dark:text-blue-200 text-sm">
            <strong>Debug Info:</strong> Chain ID: {currentChainId}, Contract: {contractAddress}, 
            Total DeedNFTs: {deedNFTs.length}, Filtered: {filteredDeedNFTs.length}
          </p>
        </div>
      )}

      {/* Connection Status */}
      {!isConnected && (
        <div className="text-center mb-8">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-yellow-800 dark:text-yellow-200">
              Please connect your wallet to explore DeedNFTs
            </p>
          </div>
        </div>
      )}

      {!isCorrectNetwork && isConnected && (
        <div className="text-center mb-8">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-red-800 dark:text-red-200">
              Please switch to a supported network to explore DeedNFTs
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

      {/* Search and Filter Bar */}
      <div className="max-w-4xl mx-auto mb-8">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search DeedNFTs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-black/10 dark:border-white/10 rounded-lg bg-white dark:bg-[#141414] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent"
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-4 py-3 border border-black/10 dark:border-white/10 rounded-lg bg-white dark:bg-[#141414] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent"
          >
            <option value="all">All Types</option>
            <option value="validated">Validated</option>
            <option value="pending">Pending</option>
            <option value="land">Land</option>
            <option value="vehicle">Vehicle</option>
            <option value="estate">Estate</option>
            <option value="equipment">Equipment</option>
          </select>
          <Button 
            onClick={fetchDeedNFTs}
            disabled={loading}
            variant="outline" 
            className="border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-white mx-auto"></div>
          <p className="text-gray-600 dark:text-gray-300 mt-4">Loading DeedNFTs from blockchain...</p>
        </div>
      )}

      {/* No Results */}
      {!loading && filteredDeedNFTs.length === 0 && (
        <div className="text-center py-12">
          <Eye className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p className="text-gray-600 dark:text-gray-300 text-lg">
            {deedNFTs.length === 0 ? "No DeedNFTs found on this network" : "No DeedNFTs match your search"}
          </p>
          <p className="text-gray-500 dark:text-gray-400 mt-2">
            {deedNFTs.length === 0 ? "Be the first to mint a DeedNFT!" : "Try adjusting your search or filter criteria"}
          </p>
        </div>
      )}

      {/* DeedNFTs Grid */}
      {!loading && filteredDeedNFTs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {filteredDeedNFTs.map((deedNFT) => {
            const validationStatus = getValidationStatus(deedNFT);
            const assetTypeLabel = getAssetTypeLabel(deedNFT.assetType);
            
            return (
              <Card key={deedNFT.tokenId} className="group hover:shadow-xl transition-all duration-300 border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-lg text-gray-900 dark:text-white">
                      {assetTypeLabel} #{deedNFT.tokenId}
                    </CardTitle>
                    <Badge 
                      variant="secondary" 
                      className={`${
                        validationStatus.color === "green" 
                          ? "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300"
                          : "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300"
                      }`}
                    >
                      {validationStatus.status}
                    </Badge>
                  </div>
                  <CardDescription className="text-gray-600 dark:text-gray-300">
                    {deedNFT.definition.length > 50 
                      ? `${deedNFT.definition.substring(0, 50)}...` 
                      : deedNFT.definition
                    }
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Asset Type:</span>
                      <span className="text-gray-900 dark:text-white font-medium">{assetTypeLabel}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Owner:</span>
                      <span className="text-gray-900 dark:text-white font-mono text-xs">
                        {deedNFT.owner.substring(0, 6)}...{deedNFT.owner.substring(deedNFT.owner.length - 4)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Token ID:</span>
                      <span className="text-gray-900 dark:text-white font-medium">#{deedNFT.tokenId}</span>
                    </div>
                    {deedNFT.uri && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500 dark:text-gray-400">Metadata:</span>
                        <span className="text-gray-900 dark:text-white font-medium">Available</span>
                      </div>
                    )}
                  </div>
                  <Button variant="outline" className="w-full border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]" onClick={() => handleViewDetails(deedNFT)}>
                    <Eye className="w-4 h-4 mr-2" />
                    View Details
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Results Count */}
      {!loading && filteredDeedNFTs.length > 0 && (
        <div className="text-center mt-8">
          <p className="text-gray-500 dark:text-gray-400">
            Showing {filteredDeedNFTs.length} of {deedNFTs.length} DeedNFTs
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
    </main>
  );
};

export default Explore; 