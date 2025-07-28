import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import { 
  Shield, 
  CheckCircle,
  AlertCircle,
  Loader2,
  Settings,
  User,
  Wallet
} from 'lucide-react';

export function SWIXAuth() {
  const {
    isConnected,
    isAuthenticated,
    address,
    user,
    checkAuthentication,
    setSessionMetadata,
    siwx,
  } = useAppKitAuth();

  const [error, setError] = useState<string | null>(null);
  const [isSettingMetadata, setIsSettingMetadata] = useState(false);
  const [metadataKey, setMetadataKey] = useState('');
  const [metadataValue, setMetadataValue] = useState('');

  const handleAuthenticate = async () => {
    setError(null);
    try {
      console.log('Checking SWIX authentication...');
      const result = await checkAuthentication();
      console.log('SWIX authentication result:', result);
      if (result) {
        setError(null);
      } else {
        setError('SWIX authentication check failed');
      }
    } catch (err) {
      console.error('Error checking SWIX authentication:', err);
      setError('Failed to check SWIX authentication status');
    }
  };

  const handleSetMetadata = async () => {
    if (!metadataKey.trim() || !metadataValue.trim()) {
      setError('Please provide both key and value');
      return;
    }

    if (!siwx) {
      setError('SWIX not available');
      return;
    }

    setIsSettingMetadata(true);
    setError(null);

    try {
      console.log('Setting SWIX session metadata:', { [metadataKey]: metadataValue });
      await setSessionMetadata({
        [metadataKey]: metadataValue
      });
      setMetadataKey('');
      setMetadataValue('');
      // Refresh authentication status
      await checkAuthentication();
      console.log('SWIX session metadata updated successfully');
    } catch (err) {
      console.error('Error setting SWIX session metadata:', err);
      setError('Failed to set SWIX session metadata');
    } finally {
      setIsSettingMetadata(false);
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const getSocialProviderIcon = (provider: string) => {
    switch (provider.toLowerCase()) {
      case 'google':
        return '🔍';
      case 'x':
      case 'twitter':
        return '🐦';
      case 'github':
        return '🐙';
      case 'discord':
        return '🎮';
      case 'apple':
        return '🍎';
      case 'facebook':
        return '📘';
      case 'farcaster':
        return '📡';
      default:
        return '👤';
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          SWIX Authentication
        </CardTitle>
        <CardDescription>
          SWIX (Sign In With X) authentication status and session metadata management
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Connection Status */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Wallet Status:</span>
          <Badge variant={isConnected ? "default" : "secondary"}>
            {isConnected ? (
              <CheckCircle className="h-3 w-3 mr-1" />
            ) : (
              <AlertCircle className="h-3 w-3 mr-1" />
            )}
            {isConnected ? "Connected" : "Disconnected"}
          </Badge>
        </div>

        {/* Authentication Status */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Authentication:</span>
          <Badge variant={isAuthenticated ? "default" : "secondary"}>
            {isAuthenticated ? (
              <Shield className="h-3 w-3 mr-1" />
            ) : (
              <AlertCircle className="h-3 w-3 mr-1" />
            )}
            {isAuthenticated ? "Authenticated" : "Not Authenticated"}
          </Badge>
        </div>

        {/* User Information */}
        {user && (
          <div className="space-y-2">
            <Separator />
            <div className="flex items-center gap-2">
              <User className="h-4 w-4" />
              <span className="text-sm font-medium">User Info:</span>
            </div>
            <div className="text-sm space-y-1">
              {user.email && (
                <div>Email: {user.email}</div>
              )}
              {user.social && (
                <div className="flex items-center gap-1">
                  <span>Social:</span>
                  <span>{getSocialProviderIcon(user.social.provider)}</span>
                  <span>{user.social.provider}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Wallet Address */}
        {address && (
          <div className="space-y-2">
            <Separator />
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              <span className="text-sm font-medium">Address:</span>
            </div>
            <div className="text-sm font-mono bg-muted p-2 rounded">
              {formatAddress(address)}
            </div>
          </div>
        )}

        {/* Session Metadata */}
        {isAuthenticated && (
          <div className="space-y-2">
            <Separator />
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              <span className="text-sm font-medium">Session Metadata:</span>
            </div>
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  placeholder="Key"
                  value={metadataKey}
                  onChange={(e) => setMetadataKey(e.target.value)}
                  className="flex-1"
                />
                <Input
                  placeholder="Value"
                  value={metadataValue}
                  onChange={(e) => setMetadataValue(e.target.value)}
                  className="flex-1"
                />
              </div>
              <Button 
                onClick={handleSetMetadata}
                disabled={isSettingMetadata || !metadataKey.trim() || !metadataValue.trim()}
                size="sm"
                className="w-full"
              >
                {isSettingMetadata ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Settings className="h-4 w-4 mr-2" />
                )}
                Set Metadata
              </Button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-2">
          <Button 
            onClick={handleAuthenticate} 
            variant="outline" 
            className="w-full"
          >
            <Shield className="h-4 w-4 mr-2" />
            Check Authentication
          </Button>
        </div>

        {/* Error Display */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
} 