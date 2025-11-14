import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SWIXAuth } from './SWIXAuth';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import { useAppKitAccount, useAppKitNetwork } from '@reown/appkit/react';
import { getContractAddressForNetwork } from '@/config/networks';
import { useNetworkValidation } from '@/hooks/useNetworkValidation';
import XMTPMessaging from './XMTPMessaging';
import { useXMTP } from '@/context/XMTPContext';
import { useXMTPConnection } from '@/hooks/useXMTPConnection';
import { 
  Shield, 
  Wallet, 
  User, 
  CheckCircle, 
  AlertCircle,
  Settings,
  User as UserIcon,
  Save,
  Loader2,
  Trash2,
  Plus,
  Key,
  Lock,
  Eye,
  EyeOff,
  MessageCircle,
  Mail
} from 'lucide-react';

interface UserProfile {
  email?: string;
  legalName?: string;
  username?: string;
  bio?: string;
  avatar?: string;
  preferences?: {
    theme?: 'light' | 'dark' | 'auto';
    notifications?: boolean;
    privacy?: 'public' | 'private';
  };
  socialAccounts?: Array<{
    provider: string;
    id: string;
    connected: boolean;
  }>;
}

export function SWIXDemo() {
  const { isConnected, isAuthenticated, user, setSessionMetadata, siwx } = useAppKitAuth();
  const { isConnected: isXMTPConnected, conversations } = useXMTP();
  const { handleConnect: handleXMTPConnect } = useXMTPConnection();
  
  const { address, isConnected: isAppKitConnected, embeddedWalletInfo, status } = useAppKitAccount();
  const { caipNetworkId } = useAppKitNetwork();
  const isWalletConnected = isAppKitConnected || (embeddedWalletInfo && status === 'connected');
  const chainId = caipNetworkId ? parseInt(caipNetworkId.split(':')[1]) : undefined;
  const { isCorrectNetwork } = useNetworkValidation();
  const contractAddress = chainId ? getContractAddressForNetwork(chainId) : null;
  
  const [profile, setProfile] = useState<UserProfile>({});
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showInbox, setShowInbox] = useState(false);

  // Load user profile from session metadata
  useEffect(() => {
    const loadProfile = async () => {
      if (siwx && isAuthenticated) {
        try {
          console.log('Loading profile from SWIX session...');
          const sessionAccount = await siwx.getSessionAccount();
          console.log('Session account:', sessionAccount);
          console.log('User object:', user);
          
          if (sessionAccount) {
            const metadata = (sessionAccount as any).metadata;
            console.log('Session metadata:', metadata);
            
            // Detect social accounts from SWIX session
            const detectedSocialAccounts = [];
            if (metadata.social) {
              detectedSocialAccounts.push({
                provider: metadata.social.provider,
                id: metadata.social.id,
                connected: true
              });
              console.log('Found social account in SWIX metadata:', metadata.social);
            }
            
            // Also check if user has social authentication from AppKit
            if (user?.social?.provider && user?.social?.id) {
              console.log('Found social account in user object:', user.social);
              const existingAccount = detectedSocialAccounts.find(acc => 
                acc.provider.toLowerCase() === user.social!.provider.toLowerCase()
              );
              
              if (!existingAccount) {
                detectedSocialAccounts.push({
                  provider: user.social.provider,
                  id: user.social.id,
                  connected: true
                });
                
                // Update SWIX session metadata with the detected social account
                try {
                  await setSessionMetadata({
                    ...metadata,
                    social: user.social,
                    socialAccounts: detectedSocialAccounts
                  });
                  console.log('Updated SWIX session with social account:', user.social);
                } catch (error) {
                  console.error('Error updating SWIX session with social account:', error);
                }
              } else {
                console.log('Social account already exists in detected accounts');
              }
            }
            
            console.log('Final detected social accounts:', detectedSocialAccounts);
            
            setProfile({
              email: metadata.email || user?.email,
              legalName: metadata.legalName || '',
              username: metadata.username || '',
              bio: metadata.bio || '',
              avatar: metadata.avatar || '',
              preferences: metadata.preferences || {
                theme: 'auto',
                notifications: true,
                privacy: 'public'
              },
              socialAccounts: metadata.socialAccounts || detectedSocialAccounts
            });
          }
        } catch (error) {
          console.error('Error loading profile:', error);
        }
      }
    };

    loadProfile();
  }, [siwx, isAuthenticated, user, setSessionMetadata]);

  // Listen for session changes to update social accounts
  useEffect(() => {
    if (siwx) {
      const handleSessionChange = async () => {
        try {
          const sessionAccount = await siwx.getSessionAccount();
          if (sessionAccount) {
            const metadata = (sessionAccount as any).metadata;
            
            // Update social accounts if new ones are detected
            if (metadata.social && !profile.socialAccounts?.some(acc => 
              acc.provider === metadata.social.provider
            )) {
              const newSocialAccount = {
                provider: metadata.social.provider,
                id: metadata.social.id,
                connected: true
              };
              
              setProfile(prev => ({
                ...prev,
                socialAccounts: [...(prev.socialAccounts || []), newSocialAccount]
              }));
              
              setSuccess(`${metadata.social.provider} connected successfully!`);
            }
          }
        } catch (error) {
          console.error('Error handling session change:', error);
        }
      };

      // Set up event listener for session changes
      const unsubscribe = siwx.on('sessionChanged', handleSessionChange);
      
      return () => {
        unsubscribe();
      };
    }
  }, [siwx, profile.socialAccounts]);

  const handleSaveProfile = async () => {
    if (!siwx) return;

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await setSessionMetadata({
        ...profile,
        lastUpdated: new Date().toISOString()
      });
      setSuccess('Profile updated successfully!');
    } catch (error) {
      setError('Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateField = (field: keyof UserProfile, value: any) => {
    setProfile(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleUpdatePreferences = (key: string, value: any) => {
    setProfile(prev => ({
      ...prev,
      preferences: {
        ...prev.preferences,
        [key]: value
      }
    }));
  };

  const handleConnectSocial = async (provider: string) => {
    // Open the SWIX modal with social authentication
    // This will trigger the social auth flow through SWIX
    // Note: The actual social connection will be handled by SWIX
    // and the session will be updated automatically
    setSuccess(`Opening ${provider} authentication...`);
  };

  const handleDisconnectSocial = async (provider: string) => {
    try {
      // Remove the social account from profile
      const updatedSocialAccounts = profile.socialAccounts?.filter(acc => 
        acc.provider.toLowerCase() !== provider.toLowerCase()
      ) || [];
      
      // Update session metadata
      await setSessionMetadata({
        ...profile,
        socialAccounts: updatedSocialAccounts
      });
      
      // Update local state
      setProfile(prev => ({
        ...prev,
        socialAccounts: updatedSocialAccounts
      }));
      
      setSuccess(`${provider} disconnected successfully!`);
    } catch (error) {
      setError(`Failed to disconnect ${provider}`);
    }
  };

  const getSocialProviderIcon = (provider: string) => {
    switch (provider.toLowerCase()) {
      case 'google': return '🔍';
      case 'x':
      case 'twitter': return '🐦';
      case 'github': return '🐙';
      case 'discord': return '🎮';
      case 'apple': return '🍎';
      case 'facebook': return '📘';
      case 'farcaster': return '📡';
      default: return '👤';
    }
  };

  if (!isConnected) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center space-y-4">
          <h1 className="text-5xl lg:text-6xl font-bold font-coolvetica">USER PROFILE & SETTINGS</h1>
          <p className="text-xl text-muted-foreground">
            Connect your wallet to access your profile and settings
          </p>
          <div className="flex justify-center">
            <SWIXAuth />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 pt-4 pb-8 space-y-8">
      {/* Debug Information */}
      {isWalletConnected && isCorrectNetwork && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-blue-800 dark:text-blue-200 text-sm">
            <strong>Debug Info:</strong> Chain ID: {chainId}, Contract: {contractAddress || 'Not found'}, 
            Address: {address ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : 'None'}
            {embeddedWalletInfo && (
              <span className="ml-2">
                | Embedded Wallet: {embeddedWalletInfo.authProvider} ({embeddedWalletInfo.accountType})
              </span>
            )}
          </p>
          <p className="text-blue-700 dark:text-blue-300 text-xs mt-1">
            Connection Status: {isAppKitConnected ? 'Connected' : 'Disconnected'} | 
            Network: {isCorrectNetwork ? 'Correct' : 'Incorrect'}
        </p>
      </div>
      )}

      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Wallet className="h-4 w-4" />
              Wallet Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={isConnected ? "default" : "secondary"}>
              {isConnected ? (
                <CheckCircle className="h-3 w-3 mr-1" />
              ) : (
                <AlertCircle className="h-3 w-3 mr-1" />
              )}
              {isConnected ? "Connected" : "Disconnected"}
            </Badge>
          </CardContent>
        </Card>

        <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Shield className="h-4 w-4" />
              Authentication
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={isAuthenticated ? "default" : "secondary"}>
              {isAuthenticated ? (
                <CheckCircle className="h-3 w-3 mr-1" />
              ) : (
                <AlertCircle className="h-3 w-3 mr-1" />
              )}
              {isAuthenticated ? "Authenticated" : "Not Authenticated"}
            </Badge>
          </CardContent>
        </Card>

        <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4" />
              Profile Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={profile.email ? "default" : "secondary"}>
              {profile.email ? (
                <CheckCircle className="h-3 w-3 mr-1" />
              ) : (
                <AlertCircle className="h-3 w-3 mr-1" />
              )}
              {profile.email ? "Profile Complete" : "Profile Incomplete"}
            </Badge>
          </CardContent>
        </Card>

        <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Mail className="h-4 w-4" />
              Messages
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Badge variant={isXMTPConnected ? "default" : "secondary"}>
              {isXMTPConnected ? (
                <CheckCircle className="h-3 w-3 mr-1" />
              ) : (
                <AlertCircle className="h-3 w-3 mr-1" />
              )}
              {isXMTPConnected ? `${conversations.length} Conversations` : "Not Connected"}
            </Badge>
            {isConnected && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowInbox(true)}
                className="w-full mt-2"
              >
                <MessageCircle className="h-4 w-4 mr-2" />
                Open Inbox
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid w-full grid-cols-5 bg-gray-100 dark:bg-[#0e0e0e] border border-black/10 dark:border-white/10">
          <TabsTrigger value="profile" className="data-[state=active]:bg-white dark:data-[state=active]:bg-[#141414]">
            Profile
          </TabsTrigger>
          <TabsTrigger value="authentication" className="data-[state=active]:bg-white dark:data-[state=active]:bg-[#141414]">
            Auth
          </TabsTrigger>
          <TabsTrigger value="preferences" className="data-[state=active]:bg-white dark:data-[state=active]:bg-[#141414]">
            Preferences
          </TabsTrigger>
          <TabsTrigger value="security" className="data-[state=active]:bg-white dark:data-[state=active]:bg-[#141414]">
            Security
          </TabsTrigger>
          <TabsTrigger value="messages" className="data-[state=active]:bg-white dark:data-[state=active]:bg-[#141414]">
            Messages
          </TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-6 mt-6">
          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserIcon className="h-5 w-5" />
                Personal Information
              </CardTitle>
              <CardDescription>
                Update your personal information and profile details
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={profile.email || ''}
                    onChange={(e) => handleUpdateField('email', e.target.value)}
                    placeholder="your@email.com"
                  />
                </div>
                <div className="space-y-3">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={profile.username || ''}
                    onChange={(e) => handleUpdateField('username', e.target.value)}
                    placeholder="username"
                  />
                </div>
              </div>
              
              <div className="space-y-3">
                <Label htmlFor="legalName">Legal Name</Label>
                <Input
                  id="legalName"
                  value={profile.legalName || ''}
                  onChange={(e) => handleUpdateField('legalName', e.target.value)}
                  placeholder="Your full legal name"
                />
              </div>

              <div className="space-y-3">
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  value={profile.bio || ''}
                  onChange={(e) => handleUpdateField('bio', e.target.value)}
                  placeholder="Tell us about yourself..."
                  rows={3}
                />
              </div>

              <div className="space-y-3">
                <Label htmlFor="avatar">Avatar URL</Label>
                <Input
                  id="avatar"
                  type="url"
                  value={profile.avatar || ''}
                  onChange={(e) => handleUpdateField('avatar', e.target.value)}
                  placeholder="https://example.com/avatar.jpg"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Authentication Tab */}
        <TabsContent value="authentication" className="space-y-6 mt-6">
          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Authentication Methods
              </CardTitle>
              <CardDescription>
                Manage your authentication methods and social connections
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pb-6">
              {/* SWIX Authentication Component */}
              <div className="mb-6">
                <SWIXAuth />
              </div>

              {/* Social Accounts */}
              <div className="space-y-6">
                <h3 className="text-lg font-semibold">Connected Social Accounts</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {['Google', 'X (Twitter)', 'GitHub', 'Discord', 'Apple', 'Facebook', 'Farcaster'].map((provider) => {
                    const isConnected = profile.socialAccounts?.some(acc => 
                      acc.provider.toLowerCase() === provider.toLowerCase()
                    );
                    
                    return (
                      <div key={provider} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{getSocialProviderIcon(provider)}</span>
                          <div>
                            <div className="font-medium">{provider}</div>
                            <div className="text-sm text-muted-foreground">
                              {isConnected ? 'Connected' : 'Not connected'}
                            </div>
                          </div>
                        </div>
                        <Button
                          variant={isConnected ? "destructive" : "outline"}
                          size="sm"
                          onClick={() => isConnected ? 
                            handleDisconnectSocial(provider) : 
                            handleConnectSocial(provider)
                          }
                        >
                          {isConnected ? <Trash2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Preferences Tab */}
        <TabsContent value="preferences" className="space-y-6 mt-6">
          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                User Preferences
              </CardTitle>
              <CardDescription>
                Customize your experience and notification settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pb-6">
              <div className="space-y-6">
                <div className="space-y-3">
                  <Label>Theme</Label>
                  <div className="flex gap-2">
                    {['light', 'dark', 'auto'].map((theme) => (
                      <Button
                        key={theme}
                        variant={profile.preferences?.theme === theme ? "default" : "outline"}
                        size="sm"
                        onClick={() => handleUpdatePreferences('theme', theme)}
                      >
                        {theme.charAt(0).toUpperCase() + theme.slice(1)}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <Label>Privacy</Label>
                  <div className="flex gap-2">
                    {['public', 'private'].map((privacy) => (
                      <Button
                        key={privacy}
                        variant={profile.preferences?.privacy === privacy ? "default" : "outline"}
                        size="sm"
                        onClick={() => handleUpdatePreferences('privacy', privacy)}
                      >
                        {privacy.charAt(0).toUpperCase() + privacy.slice(1)}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="notifications"
                    checked={profile.preferences?.notifications || false}
                    onChange={(e) => handleUpdatePreferences('notifications', e.target.checked)}
                    className="rounded"
                  />
                  <Label htmlFor="notifications">Enable notifications</Label>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="space-y-6 mt-6">
          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                Security Settings
              </CardTitle>
              <CardDescription>
                Manage your security settings and authentication
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pb-6">
              <div className="space-y-6">
                <div className="space-y-3">
                  <Label htmlFor="newPassword">New Password</Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                  />
                </div>

                <Button 
                  disabled={!newPassword || newPassword !== confirmPassword}
                  className="w-full"
                >
                  <Key className="h-4 w-4 mr-2" />
                  Update Password
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Messages Tab */}
        <TabsContent value="messages" className="space-y-6 mt-6">
          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                XMTP Messages
              </CardTitle>
              <CardDescription>
                View and manage your XMTP conversations and messages
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pb-6">
              {!isXMTPConnected ? (
                <div className="text-center space-y-4">
                  <MessageCircle className="w-12 h-12 text-gray-400 mx-auto" />
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                      Connect to XMTP
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                      Connect your wallet to XMTP to view your messages and conversations
                    </p>
                    <Button onClick={handleXMTPConnect}>
                      <MessageCircle className="w-4 h-4 mr-2" />
                      Connect XMTP
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                        Your Conversations
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {conversations.length} conversation{conversations.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <Button onClick={() => setShowInbox(true)}>
                      <Mail className="w-4 h-4 mr-2" />
                      Open Inbox
                    </Button>
                  </div>
                  
                  {conversations.length === 0 ? (
                    <div className="text-center py-8">
                      <MessageCircle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        No conversations yet. Start messaging T-Deed owners to see them here.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {conversations.map((conversation) => (
                        <div
                          key={conversation.id}
                          className="p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                          onClick={() => setShowInbox(true)}
                        >
                          <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                              <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-gray-900 dark:text-white">
                                Conversation {conversation.id.slice(0, 8)}...
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                Click to view messages
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Save Button */}
      <div className="flex justify-center">
        <Button 
          onClick={handleSaveProfile}
          disabled={isSaving}
          size="lg"
          className="min-w-[200px]"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {isSaving ? 'Saving...' : 'Save Profile'}
        </Button>
      </div>

      {/* Status Messages */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {/* XMTP Inbox Modal */}
      <XMTPMessaging
        isOpen={showInbox}
        onClose={() => setShowInbox(false)}
      />
    </div>
  );
} 