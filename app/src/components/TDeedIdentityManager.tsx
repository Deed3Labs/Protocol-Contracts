import { useEffect, useState } from 'react';
import { useXMTP } from '@/context/XMTPContext';
import { useXMTPConnection } from '@/hooks/useXMTPConnection';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Shield, 
  CheckCircle, 
  AlertCircle,
  MessageCircle,
  Loader2
} from 'lucide-react';

interface TDeedIdentityManagerProps {
  ownerAddress: string;
  tokenId: string;
  assetType: string;
}

export function TDeedIdentityManager({ ownerAddress, tokenId, assetType }: TDeedIdentityManagerProps) {
  const { isConnected: isXMTPConnected, createConversation, checkIdentityStatus } = useXMTP();
  const { handleConnect, isConnecting } = useXMTPConnection();
  const [identityStatus, setIdentityStatus] = useState<'checking' | 'exists' | 'not-found' | 'error'>('checking');
  const [isCreating, setIsCreating] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [setupStep, setSetupStep] = useState<'initial' | 'creating' | 'complete'>('initial');

  // Check if T-Deed owner has XMTP identity
  useEffect(() => {
    const checkIdentity = async () => {
      try {
        setIdentityStatus('checking');
        console.log('TDeedIdentityManager: Checking identity for:', ownerAddress);
        const isReachable = await checkIdentityStatus(ownerAddress);
        console.log('TDeedIdentityManager: Identity check result:', isReachable);
        setIdentityStatus(isReachable ? 'exists' : 'not-found');
        
        if (isReachable) {
          setSuccess('T-Deed owner has XMTP identity and can receive messages');
          setSetupStep('complete');
        }
      } catch (err) {
        console.error('Error checking identity:', err);
        setIdentityStatus('error');
      }
    };

    // Check identity immediately when component mounts
    checkIdentity();
  }, [ownerAddress, checkIdentityStatus]);

  // Cache identity status to avoid repeated checks
  const [identityChecked, setIdentityChecked] = useState(false);

  // Also check identity when XMTP connection status changes (in case identity was created)
  useEffect(() => {
    if (isXMTPConnected && !identityChecked && identityStatus === 'checking') {
      const checkIdentity = async () => {
        try {
          setIdentityStatus('checking');
          console.log('TDeedIdentityManager: Re-checking identity after XMTP connection for:', ownerAddress);
          const isReachable = await checkIdentityStatus(ownerAddress);
          console.log('TDeedIdentityManager: Re-check result:', isReachable);
          setIdentityStatus(isReachable ? 'exists' : 'not-found');
          setIdentityChecked(true);
          
          if (isReachable) {
            setSuccess('T-Deed owner has XMTP identity and can receive messages');
            setSetupStep('complete');
          }
        } catch (err) {
          console.error('Error checking identity:', err);
          setIdentityStatus('error');
        }
      };

      checkIdentity();
    }
  }, [isXMTPConnected, ownerAddress, identityChecked, identityStatus, checkIdentityStatus]);

  const handleCreateIdentity = async () => {
    if (!isXMTPConnected) {
      // Connect to XMTP first
      try {
        await handleConnect();
      } catch (err) {
        console.error('Failed to connect to XMTP for setup:', err);
        return;
      }
    }

    setIsCreating(true);
    setSuccess(null);
    setSetupStep('creating');

    try {
      // Create a conversation with the T-Deed owner
      // This will automatically create their XMTP identity if they don't have one
      await createConversation(ownerAddress);
      
      setSuccess('✅ Messaging environment set up successfully! The T-Deed owner can now receive secure messages. Click "XMTP Direct Message" below to start messaging.');
      setIdentityStatus('exists');
      setIdentityChecked(true);
      setSetupStep('complete');
    } catch (err) {
      console.error('Error creating identity:', err);
      setSetupStep('initial');
    } finally {
      setIsCreating(false);
    }
  };



  const getStatusBadge = () => {
    switch (identityStatus) {
      case 'checking':
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Checking Setup
          </Badge>
        );
      case 'exists':
        return (
          <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            <CheckCircle className="w-3 h-3 mr-1" />
            Ready to Message
          </Badge>
        );
      case 'not-found':
        return (
          <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
            <AlertCircle className="w-3 h-3 mr-1" />
            Setup Required
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="secondary" className="bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200">
            <AlertCircle className="w-3 h-3 mr-1" />
            Setup Error
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
      <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                      <Shield className="h-5 w-5" />
                      XMTP Setup
                    </CardTitle>
                    <CardDescription>
                      Set up secure messaging environment for {assetType} #{tokenId} owner
                    </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              Owner: {ownerAddress.slice(0, 6)}...{ownerAddress.slice(-4)}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {assetType} #{tokenId}
            </p>
          </div>
          {getStatusBadge()}
        </div>

                            {identityStatus === 'not-found' && (
                      <div className="space-y-3">
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>
                            The T-Deed owner needs XMTP setup to receive secure messages. Click below to set up their messaging environment.
                          </AlertDescription>
                        </Alert>
                        <Button 
                          onClick={handleCreateIdentity}
                          disabled={isCreating || isConnecting}
                          className="w-full h-12"
                        >
                          {isCreating || isConnecting ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <MessageCircle className="w-4 h-4 mr-2" />
                          )}
                          {setupStep === 'creating' ? 'Creating Conversation...' : 'Set Up Secure Environment'}
                        </Button>
                      </div>
                    )}

                            {identityStatus === 'exists' && (
                      <Alert>
                        <CheckCircle className="h-4 w-4" />
                        <AlertDescription>
                          ✅ Messaging environment is ready! The T-Deed owner can now receive secure XMTP messages. Click "XMTP Direct Message" below to start messaging.
                        </AlertDescription>
                      </Alert>
                    )}



        {success && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
} 