import React, { useState } from "react";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { 
  X, 
  MessageCircle, 
  ExternalLink, 
  Copy,
  CheckCircle,
  Mail
} from "lucide-react";

interface MessageOwnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  ownerAddress: string;
  tokenId: string;
  assetType: string;
}

// Custom DialogContent for mobile slide-up animation
const MobileDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 grid w-full gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        // Mobile: slide up from bottom, Desktop: centered with zoom
        "left-0 bottom-0 md:left-[50%] md:top-[50%] md:translate-x-[-50%] md:translate-y-[-50%] md:max-w-6xl",
        // Mobile animations
        "data-[state=closed]:slide-out-to-bottom-full data-[state=open]:slide-in-from-bottom-full",
        // Desktop animations
        "md:data-[state=closed]:zoom-out-95 md:data-[state=open]:zoom-in-95 md:data-[state=closed]:slide-out-to-left-1/2 md:data-[state=closed]:slide-out-to-top-[48%] md:data-[state=open]:slide-in-from-left-1/2 md:data-[state=open]:slide-in-from-top-[48%]",
        "md:rounded-lg",
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
MobileDialogContent.displayName = DialogPrimitive.Content.displayName;

const MessageOwnerModal: React.FC<MessageOwnerModalProps> = ({
  isOpen,
  onClose,
  ownerAddress,
  tokenId,
  assetType,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(ownerAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenBlockscan = () => {
    const blockscoutUrl = `https://base-sepolia.blockscout.com/address/${ownerAddress}`;
    window.open(blockscoutUrl, '_blank');
  };

  const handleOpenBlockscanMessaging = () => {
    const blockscanMessagingUrl = `https://chat.blockscan.com/connect-wallet#`;
    window.open(blockscanMessagingUrl, '_blank');
  };

  const handleOpenEmail = () => {
    const subject = `Inquiry about T-Deed (${assetType} #${tokenId})`;
    const body = `Hi! I'm interested in your T-Deed (${assetType} #${tokenId}). Could you tell me more about this asset and whether it's available for purchase or collaboration?`;
    const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailtoUrl, '_blank');
  };

  // Truncate wallet address for display
  const truncateAddress = (address: string) => {
    if (address.length <= 10) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <MobileDialogContent className="max-w-6xl w-full h-full md:max-h-[90vh] border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm overflow-hidden">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0 pb-0 border-b-0">
          <div>
            <DialogTitle className="text-xl font-bold text-gray-900 dark:text-white flex items-center space-x-2">
              <MessageCircle className="w-5 h-5" />
              <span>Message T-Deed Owner</span>
            </DialogTitle>
            <p className="text-gray-600 dark:text-gray-300 mt-1">
              Contact the owner of {assetType} #{tokenId}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-10 w-10 p-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </DialogHeader>

        <div className="overflow-y-auto h-full max-h-[calc(100vh-120px)] md:max-h-[calc(90vh-120px)]">
          <div className="space-y-4 p-0 md:p-3
          ">
            {/* Two Column Layout for Desktop/Landscape */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-3">
              {/* Left Column - T-Deed and Owner Information */}
              <div className="space-y-3 md:space-y-3">
                {/* T-Deed Information */}
                <Card className="border-black/10 dark:border-white/10 bg-white/50 dark:bg-[#141414]/50 backdrop-blur-sm">
                  <CardHeader className="pb-0">
                    <CardTitle className="text-lg text-gray-900 dark:text-white">
                      T-Deed Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm text-gray-500 dark:text-gray-400">Asset Type</Label>
                        <p className="text-gray-900 dark:text-white font-medium">{assetType}</p>
                      </div>
                      <div>
                        <Label className="text-sm text-gray-500 dark:text-gray-400">Token ID</Label>
                        <p className="text-gray-900 dark:text-white font-medium">#{tokenId}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Owner Information */}
                <Card className="border-black/10 dark:border-white/10 bg-white/50 dark:bg-[#141414]/50 backdrop-blur-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg text-gray-900 dark:text-white">
                      Owner Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label className="text-sm text-gray-500 dark:text-gray-400">Owner Address</Label>
                      <div className="flex items-center space-x-2 mt-1">
                        <p className="text-gray-900 dark:text-white font-mono text-sm">
                          {truncateAddress(ownerAddress)}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCopyAddress}
                          className="border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-8 px-2"
                        >
                          {copied ? <CheckCircle className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Right Column - Messaging Options and Template */}
              <div className="space-y-3 md:space-y-3">
                {/* Messaging Options */}
                <Card className="border-black/10 dark:border-white/10 bg-white/50 dark:bg-[#141414]/50 backdrop-blur-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg text-gray-900 dark:text-white">
                      Messaging Options
                    </CardTitle>
                    <CardDescription className="text-gray-600 dark:text-gray-300">
                      Choose how you'd like to contact the T-Deed owner
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-3">
                      <Button
                        onClick={handleOpenBlockscanMessaging}
                        className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white h-11"
                      >
                        <MessageCircle className="w-4 h-4 mr-2" />
                        Open Blockscan Chat
                      </Button>
                      
                      <Button
                        onClick={handleOpenEmail}
                        className="w-full bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white h-11"
                      >
                        <Mail className="w-4 h-4 mr-2" />
                        Send Email
                      </Button>
                      
                      <Button
                        variant="outline"
                        onClick={handleOpenBlockscan}
                        className="w-full border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11"
                      >
                        <ExternalLink className="w-4 h-4 mr-2" />
                        View on Blockscout
                      </Button>
                    </div>
                    
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                      <p className="text-blue-800 dark:text-blue-200 text-sm">
                        <strong>Note:</strong> Blockscan Chat allows you to send encrypted messages to the T-Deed owner. 
                        You'll need to connect your wallet and sign in to start messaging. Email option opens your default email client.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* Quick Message Template */}
                <Card className="border-black/10 dark:border-white/10 bg-white/50 dark:bg-[#141414]/50 backdrop-blur-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg text-gray-900 dark:text-white">
                      Quick Message Template
                    </CardTitle>
                    <CardDescription className="text-gray-600 dark:text-gray-300">
                      Copy this template to get started with your message
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      value={`Hi! I'm interested in your T-Deed (${assetType} #${tokenId}). Could you tell me more about this asset and whether it's available for purchase or collaboration?`}
                      readOnly
                      className="border-black/10 dark:border-white/10 bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white min-h-[100px]"
                    />
                    <div className="mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const template = `Hi! I'm interested in your T-Deed (${assetType} #${tokenId}). Could you tell me more about this asset and whether it's available for purchase or collaboration?`;
                          navigator.clipboard.writeText(template);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
                      >
                        {copied ? <CheckCircle className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                        Copy Template
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </MobileDialogContent>
    </Dialog>
  );
};

export default MessageOwnerModal; 