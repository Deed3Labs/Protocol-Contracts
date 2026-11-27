import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, HandCoins, Shield } from "lucide-react";
import { useDeedName } from "@/hooks/useDeedName";
import type { DeedNFT } from "@/hooks/useDeedNFTData";

interface DeedCardProps {
  deedNFT: DeedNFT;
  validationStatus: { status: string; color: string };
  assetTypeLabel: string;
  onViewDetails: (deedNFT: DeedNFT) => void;
  onMakeOffer?: (deedNFT: DeedNFT) => void;
  onValidate?: (tokenId: string) => void;
  showValidate?: boolean;
}

const DeedCard: React.FC<DeedCardProps> = ({
  deedNFT,
  validationStatus,
  assetTypeLabel,
  onViewDetails,
  onMakeOffer,
  onValidate,
  showValidate = false
}) => {
  const deedName = useDeedName(deedNFT);
  
  // Use name from metadata if available, otherwise fallback to asset type + token ID
  const displayName = deedName || `${assetTypeLabel} #${deedNFT.tokenId}`;

  return (
    <Card className="group hover:border-black/20 dark:hover:border-white/20 transition-all duration-300 border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm hover:scale-[1.02]">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start gap-2 overflow-hidden">
          <CardTitle className="text-lg text-gray-900 dark:text-white truncate min-w-0 flex-1">
            {displayName}
          </CardTitle>
          <Badge 
            variant="secondary" 
            className={`border border-black/10 dark:border-white/10 flex-shrink-0 ${
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
          <div className="flex justify-between text-sm gap-2">
            <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">Asset Type:</span>
            <span className="text-gray-900 dark:text-white font-medium text-right">{assetTypeLabel}</span>
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
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] dark:bg-[#141414] h-11" onClick={() => onViewDetails(deedNFT)}>
            <Eye className="w-4 h-4 mr-1" />
            View Details
          </Button>
          {onMakeOffer && (
            <Button className="flex-1 h-11 bg-blue-600 hover:bg-blue-700 text-white font-medium opacity-100 border border-blue-700 dark:border-blue-500" onClick={() => onMakeOffer(deedNFT)}>
              <HandCoins className="w-4 h-4 mr-1" />
              Make Offer
            </Button>
          )}
          {showValidate && onValidate && (
            <Button className="flex-1 h-11 bg-yellow-600 hover:bg-yellow-700 text-white font-medium opacity-100 border border-yellow-500 dark:border-yellow-500" onClick={() => onValidate(deedNFT.tokenId)}>
              <Shield className="w-4 h-4 mr-1" />
              Validate
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default DeedCard;

