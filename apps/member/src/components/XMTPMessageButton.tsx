import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';
import XMTPMessaging from './XMTPMessaging';

interface XMTPMessageButtonProps {
  ownerAddress: string;
  tokenId: string;
  assetType: string;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

const XMTPMessageButton: React.FC<XMTPMessageButtonProps> = ({
  ownerAddress,
  tokenId,
  assetType,
  variant = 'default',
  size = 'default',
  className = '',
}) => {
  const [showMessaging, setShowMessaging] = useState(false);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setShowMessaging(true)}
        className={className}
      >
        <MessageSquare className="w-4 h-4 mr-2" />
        Message Owner
      </Button>

      <XMTPMessaging
        isOpen={showMessaging}
        onClose={() => setShowMessaging(false)}
        ownerAddress={ownerAddress}
        tokenId={tokenId}
        assetType={assetType}
      />
    </>
  );
};

export default XMTPMessageButton; 