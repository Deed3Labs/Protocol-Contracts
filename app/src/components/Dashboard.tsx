import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BarChart3, Wallet, FileText, Settings, TrendingUp, Activity, RefreshCw } from "lucide-react";
import { useDeedNFTData } from "@/hooks/useDeedNFTData";
import { Link } from "react-router-dom";
import DeedNFTViewer from "./DeedNFTViewer";
import type { DeedNFT } from "@/hooks/useDeedNFTData";
import { useState } from "react";

const Dashboard = () => {
  const {
    userDeedNFTs,
    stats,
    loading,
    error,
    fetchDeedNFTs,
    getAssetTypeLabel,
    getValidationStatus,
    isConnected,
    isCorrectNetwork
  } = useDeedNFTData();

  const [selectedDeedNFT, setSelectedDeedNFT] = useState<DeedNFT | null>(null);

  const handleViewDeedNFT = (deedNFT: DeedNFT) => {
    setSelectedDeedNFT(deedNFT);
  };

  const handleCloseDeedNFTViewer = () => {
    setSelectedDeedNFT(null);
  };

  return (
    <main className="container mx-auto py-12 px-4">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white mb-4">
          Dashboard
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
          Manage your T-Deeds and track your activity on the protocol.
        </p>
      </div>

      {/* Connection Status */}
      {!isConnected && (
        <div className="text-center mb-8">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-yellow-800 dark:text-yellow-200">
              Please connect your wallet to view your T-Deeds
            </p>
          </div>
        </div>
      )}

      {!isCorrectNetwork && isConnected && (
        <div className="text-center mb-8">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-red-800 dark:text-red-200">
              Please switch to a supported network to view your T-Deeds
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

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="p-2 bg-gray-100 dark:bg-[#141414] rounded-lg">
                <Wallet className="w-6 h-6 text-gray-600 dark:text-gray-300" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Total T-Deeds</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {loading ? "..." : stats.totalDeedNFTs}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="p-2 bg-green-100 dark:bg-green-900/20 rounded-lg">
                <FileText className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Validated</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {loading ? "..." : stats.validatedDeedNFTs}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="p-2 bg-yellow-100 dark:bg-yellow-900/20 rounded-lg">
                <Activity className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Pending</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {loading ? "..." : stats.pendingDeedNFTs}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="p-2 bg-gray-100 dark:bg-[#141414] rounded-lg">
                <TrendingUp className="w-6 h-6 text-gray-600 dark:text-gray-300" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Your T-Deeds</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {loading ? "..." : stats.userDeedNFTs}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Your T-Deeds */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Your T-Deeds</h2>
          <Button
            onClick={fetchDeedNFTs}
            disabled={loading}
            variant="outline"
            size="sm"
            className="border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11 px-4"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-white mx-auto"></div>
            <p className="text-gray-600 dark:text-gray-300 mt-4">Loading your T-Deeds...</p>
          </div>
        ) : userDeedNFTs.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p className="text-gray-600 dark:text-gray-300 text-lg">No T-Deeds found</p>
            <p className="text-gray-500 dark:text-gray-400 mt-2">Mint your first T-Deed to get started</p>
            <Button asChild className="mt-4 bg-white hover:bg-gray-100 dark:bg-white dark:hover:bg-gray-100 text-black dark:text-black border border-gray-300 dark:border-gray-300 h-11">
              <Link to="/mint">Mint T-Deed</Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {userDeedNFTs.map((deedNFT) => {
              const validationStatus = getValidationStatus(deedNFT);
              const assetTypeLabel = getAssetTypeLabel(deedNFT.assetType);
              
              return (
                <Card key={deedNFT.tokenId} className="group hover:border-black/20 dark:hover:border-white/20 transition-all duration-300 border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
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
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500 dark:text-gray-400">Token ID:</span>
                        <span className="text-gray-900 dark:text-white font-medium">#{deedNFT.tokenId}</span>
                      </div>
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
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500 dark:text-gray-400">Validation Progress:</span>
                        <span className="text-gray-900 dark:text-white font-medium">
                          {validationStatus.status === "Validated" ? "100%" : "0%"}
                        </span>
                      </div>
                      <Progress 
                        value={validationStatus.status === "Validated" ? 100 : 0} 
                        className="h-2" 
                      />
                    </div>
                    <div className="flex space-x-2">
                      <Button variant="outline" size="sm" className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11" onClick={() => handleViewDeedNFT(deedNFT)}>
                        View
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11">
                        Transfer
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm hover:border-black/20 dark:hover:border-white/20 transition-all duration-300">
            <CardContent className="p-6">
              <div className="text-center">
                <div className="p-3 bg-gray-100 dark:bg-[#141414] rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                  <FileText className="w-8 h-8 text-gray-600 dark:text-gray-300" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Mint New T-Deed</h3>
                <p className="text-gray-600 dark:text-gray-300 mb-4">Create a new digital deed with custom metadata</p>
                <Button asChild className="w-full bg-white hover:bg-gray-100 dark:bg-white dark:hover:bg-gray-100 text-black dark:text-black border border-gray-300 dark:border-gray-300 h-11">
                  <Link to="/mint">Start Minting</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm hover:border-black/20 dark:hover:border-white/20 transition-all duration-300">
            <CardContent className="p-6">
              <div className="text-center">
                <div className="p-3 bg-gray-100 dark:bg-[#141414] rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                  <BarChart3 className="w-8 h-8 text-gray-600 dark:text-gray-300" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">View Analytics</h3>
                <p className="text-gray-600 dark:text-gray-300 mb-4">Track your T-Deed performance and statistics</p>
                <Button variant="outline" className="w-full border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11">
                  View Analytics
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm hover:border-black/20 dark:hover:border-white/20 transition-all duration-300">
            <CardContent className="p-6">
              <div className="text-center">
                <div className="p-3 bg-gray-100 dark:bg-[#141414] rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                  <Settings className="w-8 h-8 text-gray-600 dark:text-gray-300" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Settings</h3>
                <p className="text-gray-600 dark:text-gray-300 mb-4">Manage your account preferences and settings</p>
                <Button variant="outline" className="w-full border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11">
                  Open Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* DeedNFT Viewer Modal */}
      {selectedDeedNFT && (
        <DeedNFTViewer 
          deedNFT={selectedDeedNFT} 
          isOpen={!!selectedDeedNFT}
          onClose={handleCloseDeedNFTViewer}
          getAssetTypeLabel={getAssetTypeLabel}
          getValidationStatus={getValidationStatus}
        />
      )}
    </main>
  );
};

export default Dashboard; 