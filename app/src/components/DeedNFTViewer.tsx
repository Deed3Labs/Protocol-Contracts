import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { 
  X, 
  ExternalLink, 
  Copy, 
  CheckCircle, 
  Clock, 
  MapPin, 
  Car, 
  Building, 
  Wrench,
  FileText,
  Settings,
  Shield,
  Hash,
  Maximize2,
  Minimize2,
  Tag,
  Calendar,
  DollarSign,
  Share2,
  Heart,
  Image as ImageIcon,
  AlertCircle
} from "lucide-react";
import { ethers } from "ethers";
import type { DeedNFT } from "@/hooks/useDeedNFTData";

interface DeedNFTViewerProps {
  deedNFT: DeedNFT;
  isOpen: boolean;
  onClose: () => void;
  getAssetTypeLabel: (assetType: number) => string;
  getValidationStatus: (deedNFT: DeedNFT) => { status: string; color: string };
}

interface TokenMetadata {
  name?: string;
  description?: string;
  image?: string;
  images?: string[];
  attributes?: Array<{
    trait_type: string;
    value: string | number;
  }>;
}

const DeedNFTViewer: React.FC<DeedNFTViewerProps> = ({
  deedNFT,
  isOpen,
  onClose,
  getAssetTypeLabel,
  getValidationStatus
}) => {
  const [isFullPage, setIsFullPage] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);
  const [isLiked, setIsLiked] = useState(false);
  const [metadata, setMetadata] = useState<TokenMetadata | null>(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(true);
  const [images, setImages] = useState<string[]>([]);
  
  const validationStatus = getValidationStatus(deedNFT);
  const assetTypeLabel = getAssetTypeLabel(deedNFT.assetType);

  // Fetch metadata from token URI
  useEffect(() => {
    const fetchMetadata = async () => {
      if (!deedNFT.uri) {
        setIsLoadingMetadata(false);
        return;
      }

      try {
        setIsLoadingMetadata(true);
        const response = await fetch(deedNFT.uri);
        if (!response.ok) throw new Error('Failed to fetch metadata');
        
        const data: TokenMetadata = await response.json();
        setMetadata(data);
        
        // Extract images from metadata
        const imageArray: string[] = [];
        if (data.image) imageArray.push(data.image);
        if (data.images && Array.isArray(data.images)) {
          imageArray.push(...data.images);
        }
        setImages(imageArray);
      } catch (error) {
        console.error('Error fetching metadata:', error);
        setMetadata(null);
        setImages([]);
      } finally {
        setIsLoadingMetadata(false);
      }
    };

    fetchMetadata();
  }, [deedNFT.uri]);

  const getAssetTypeIcon = (assetType: number) => {
    switch (assetType) {
      case 0: return <MapPin className="w-5 h-5" />; // Land
      case 1: return <Car className="w-5 h-5" />; // Vehicle
      case 2: return <Building className="w-5 h-5" />; // Estate
      case 3: return <Wrench className="w-5 h-5" />; // Commercial Equipment
      default: return <FileText className="w-5 h-5" />;
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatAddress = (address: string) => {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  const getValidationProgress = () => {
    return validationStatus.status === "Validated" ? 100 : 0;
  };

  const toggleFullPage = () => {
    setIsFullPage(!isFullPage);
  };

  if (!isOpen) return null;

  const containerClass = isFullPage 
    ? "fixed inset-0 bg-white dark:bg-[#141414] z-50 overflow-y-auto"
    : "fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4";

  const contentClass = isFullPage
    ? "min-h-screen"
    : "bg-white dark:bg-[#141414] rounded-xl shadow-2xl max-w-6xl w-full max-h-[95vh] overflow-y-auto";

  return (
    <div className={containerClass}>
      <div className={contentClass}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-black/10 dark:border-white/10">
          <div className="flex items-center space-x-4">
            <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800">
              {getAssetTypeIcon(deedNFT.assetType)}
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                {metadata?.name || `${assetTypeLabel} #${deedNFT.tokenId}`}
              </h2>
              <p className="text-gray-600 dark:text-gray-300">
                DeedNFT Details
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleFullPage}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              {isFullPage ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <div className="p-8 space-y-8">
          {/* Image Gallery */}
          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm overflow-hidden">
            <CardContent className="p-0">
              <div className="relative">
                {isLoadingMetadata ? (
                  <div className="w-full h-80 md:h-96 bg-gray-200 dark:bg-gray-800 animate-pulse flex items-center justify-center">
                    <div className="text-center">
                      <ImageIcon className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                      <p className="text-gray-500 dark:text-gray-400">Loading images...</p>
                    </div>
                  </div>
                ) : images.length > 0 ? (
                  <>
                    <img
                      src={images[selectedImage]}
                      alt={`${assetTypeLabel} ${deedNFT.tokenId}`}
                      className="w-full h-80 md:h-96 object-cover"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        target.nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                    <div className="hidden w-full h-80 md:h-96 bg-gray-200 dark:bg-gray-800 flex items-center justify-center">
                      <div className="text-center">
                        <ImageIcon className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                        <p className="text-gray-500 dark:text-gray-400">Image failed to load</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-80 md:h-96 bg-gray-200 dark:bg-gray-800 flex items-center justify-center">
                    <div className="text-center">
                      <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                      <p className="text-gray-500 dark:text-gray-400">No images found</p>
                      <p className="text-sm text-gray-400 dark:text-gray-500">This DeedNFT doesn't have any associated images</p>
                    </div>
                  </div>
                )}
                
                <div className="absolute top-4 right-4 flex space-x-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsLiked(!isLiked)}
                    className={`bg-white/90 dark:bg-black/90 backdrop-blur-sm ${
                      isLiked ? "text-red-500" : "text-gray-500"
                    }`}
                  >
                    <Heart className={`w-5 h-5 ${isLiked ? "fill-current" : ""}`} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="bg-white/90 dark:bg-black/90 backdrop-blur-sm text-gray-500"
                  >
                    <Share2 className="w-5 h-5" />
                  </Button>
                </div>
              </div>
              
              {images.length > 1 && (
                <div className="p-6">
                  <div className="flex space-x-3 overflow-x-auto">
                    {images.map((image, index) => (
                      <button
                        key={index}
                        onClick={() => setSelectedImage(index)}
                        className={`flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-all ${
                          selectedImage === index 
                            ? "border-gray-900 dark:border-white shadow-lg" 
                            : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                        }`}
                      >
                        <img
                          src={image}
                          alt={`Thumbnail ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Main Content Tabs */}
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-4 bg-gray-100 dark:bg-gray-800">
              <TabsTrigger value="overview" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700">Overview</TabsTrigger>
              <TabsTrigger value="attributes" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700">Attributes</TabsTrigger>
              <TabsTrigger value="validation" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700">Validation</TabsTrigger>
              <TabsTrigger value="details" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700">Details</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6 mt-6">
              {/* Quick Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
                  <CardContent className="p-6">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800">
                        <Tag className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                      </div>
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Asset Type</p>
                        <p className="text-lg font-semibold text-gray-900 dark:text-white">{assetTypeLabel}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
                  <CardContent className="p-6">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800">
                        <Calendar className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                      </div>
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Minted</p>
                        <p className="text-lg font-semibold text-gray-900 dark:text-white">Recently</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
                  <CardContent className="p-6">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800">
                        <DollarSign className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                      </div>
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Estimated Value</p>
                        <p className="text-lg font-semibold text-gray-900 dark:text-white">$0.00</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Description */}
              <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-gray-900 dark:text-white">Description</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                    {metadata?.description || deedNFT.definition || "No description available for this DeedNFT."}
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="attributes" className="space-y-6 mt-6">
              <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-gray-900 dark:text-white">Traits & Attributes</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="p-4 border border-black/10 dark:border-white/10 rounded-lg bg-white/50 dark:bg-gray-800/50">
                      <p className="text-sm text-gray-500 dark:text-gray-400">Asset Type</p>
                      <p className="text-lg font-semibold text-gray-900 dark:text-white">{assetTypeLabel}</p>
                    </div>
                    <div className="p-4 border border-black/10 dark:border-white/10 rounded-lg bg-white/50 dark:bg-gray-800/50">
                      <p className="text-sm text-gray-500 dark:text-gray-400">Token ID</p>
                      <p className="text-lg font-semibold text-gray-900 dark:text-white">#{deedNFT.tokenId}</p>
                    </div>
                    <div className="p-4 border border-black/10 dark:border-white/10 rounded-lg bg-white/50 dark:bg-gray-800/50">
                      <p className="text-sm text-gray-500 dark:text-gray-400">Validation Status</p>
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
                    {deedNFT.configuration && (
                      <div className="p-4 border border-black/10 dark:border-white/10 rounded-lg bg-white/50 dark:bg-gray-800/50">
                        <p className="text-sm text-gray-500 dark:text-gray-400">Configuration</p>
                        <p className="text-lg font-semibold text-gray-900 dark:text-white break-all">{deedNFT.configuration}</p>
                      </div>
                    )}
                    {metadata?.attributes && metadata.attributes
                      .filter(attr => 
                        !['assetType', 'asset_type', 'Asset Type'].includes(attr.trait_type) &&
                        !['tokenId', 'token_id', 'Token ID'].includes(attr.trait_type) &&
                        !['validationStatus', 'validation_status', 'Validation Status'].includes(attr.trait_type)
                      )
                      .map((attr, index) => (
                        <div key={index} className="p-4 border border-black/10 dark:border-white/10 rounded-lg bg-white/50 dark:bg-gray-800/50">
                          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{attr.trait_type}</p>
                          <p className="text-lg font-semibold text-gray-900 dark:text-white break-all">{String(attr.value)}</p>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="validation" className="space-y-6 mt-6">
              <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2 text-gray-900 dark:text-white">
                    <Shield className="w-5 h-5" />
                    <span>Validation Status</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600 dark:text-gray-300">Status</span>
                    <Badge 
                      variant="secondary" 
                      className={`${
                        validationStatus.color === "green" 
                          ? "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300"
                          : "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300"
                      }`}
                    >
                      {validationStatus.status === "Validated" ? (
                        <CheckCircle className="w-4 h-4 mr-1" />
                      ) : (
                        <Clock className="w-4 h-4 mr-1" />
                      )}
                      {validationStatus.status}
                    </Badge>
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Validation Progress</span>
                      <span className="text-gray-900 dark:text-white font-medium">
                        {getValidationProgress()}%
                      </span>
                    </div>
                    <Progress value={getValidationProgress()} className="h-3" />
                  </div>
                  {deedNFT.validatorAddress !== ethers.ZeroAddress && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 dark:text-gray-300">Validator</span>
                      <div className="flex items-center space-x-2 min-w-0 flex-1">
                        <span className="text-gray-900 dark:text-white font-mono text-sm truncate">
                          {formatAddress(deedNFT.validatorAddress)}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(deedNFT.validatorAddress)}
                          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex-shrink-0"
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="details" className="space-y-6 mt-6">
              {/* Asset Information */}
              <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2 text-gray-900 dark:text-white">
                    <FileText className="w-5 h-5" />
                    <span>Asset Information</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Asset Type</p>
                      <p className="text-gray-900 dark:text-white font-medium">{assetTypeLabel}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Token ID</p>
                      <p className="text-gray-900 dark:text-white font-medium">#{deedNFT.tokenId}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Owner</p>
                      <div className="flex items-center space-x-2">
                        <span className="text-gray-900 dark:text-white font-mono text-sm truncate flex-1">
                          {formatAddress(deedNFT.owner)}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(deedNFT.owner)}
                          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex-shrink-0"
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Minted</p>
                      <p className="text-gray-900 dark:text-white font-medium">
                        {deedNFT.isMinted ? "Yes" : "No"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Metadata */}
              <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2 text-gray-900 dark:text-white">
                    <Settings className="w-5 h-5" />
                    <span>Metadata</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Definition</p>
                    <p className="text-gray-900 dark:text-white">{deedNFT.definition}</p>
                  </div>
                  {deedNFT.configuration && (
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Configuration</p>
                      <p className="text-gray-900 dark:text-white">{deedNFT.configuration}</p>
                    </div>
                  )}
                  {deedNFT.uri && (
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Metadata URI</p>
                      <div className="flex items-start space-x-2">
                        <p className="text-gray-900 dark:text-white font-mono text-sm break-all flex-1">
                          {deedNFT.uri}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.open(deedNFT.uri, '_blank')}
                          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex-shrink-0"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Additional Details */}
              <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2 text-gray-900 dark:text-white">
                    <Hash className="w-5 h-5" />
                    <span>Additional Details</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Payment Token</p>
                      <p className="text-gray-900 dark:text-white font-medium truncate">
                        {deedNFT.token === ethers.ZeroAddress ? "None" : formatAddress(deedNFT.token)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Salt</p>
                      <p className="text-gray-900 dark:text-white font-medium">
                        {deedNFT.salt || "0"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Actions */}
          <div className="flex space-x-4 pt-6">
            <Button
              variant="outline"
              onClick={() => copyToClipboard(deedNFT.tokenId)}
              className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy Token ID
            </Button>
            <Button
              variant="outline"
              onClick={() => copyToClipboard(deedNFT.owner)}
              className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy Owner
            </Button>
            <Button
              onClick={onClose}
              className="flex-1 bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white"
            >
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeedNFTViewer; 