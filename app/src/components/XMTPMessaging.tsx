import React, { useState, useEffect, useRef } from 'react';
import { useXMTP } from '@/context/XMTPContext';
import { useXMTPConnection } from '@/hooks/useXMTPConnection';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  MessageCircle, 
  Send, 
  User, 
  Loader2, 
  AlertCircle,
  CheckCircle,
  X,
  Search,
  RefreshCw,
  Plus,
  ChevronLeft
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface XMTPMessagingProps {
  ownerAddress?: string;
  tokenId?: string;
  assetType?: string;
  isOpen: boolean;
  onClose: () => void;
}

const XMTPMessaging: React.FC<XMTPMessagingProps> = ({
  ownerAddress,
  tokenId,
  assetType,
  isOpen,
  onClose,
}) => {
  const { 
    conversations, 
    messages, 
    isLoading, 
    error, 
    sendMessage, 
    loadMessages, 
    loadConversations,
    createConversation,
    manualSync,
    canMessage,
    getCurrentInboxId,
    isConnected 
  } = useXMTP();
  
  const { handleConnect, isConnecting, isEmbeddedWallet, address } = useXMTPConnection();
  
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [newDmAddress, setNewDmAddress] = useState('');
  const [isCreatingDm, setIsCreatingDm] = useState(false);
  const [showNewDmDialog, setShowNewDmDialog] = useState(false);
  const [currentUserInboxId, setCurrentUserInboxId] = useState<string | null>(null);
  const [isConversationListCollapsed, setIsConversationListCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Debug logging for current user address
  useEffect(() => {
    console.log('XMTP: Current user address debug:', {
      address,
      isConnected,
      isConnecting
    });
  }, [address, isConnected, isConnecting]);
  
  // Load current user's inbox ID when connected
  useEffect(() => {
    if (isConnected && !currentUserInboxId) {
      getCurrentInboxId().then((inboxId) => {
        console.log('XMTP: Current user inbox ID:', inboxId);
        setCurrentUserInboxId(inboxId);
      }).catch((err) => {
        console.error('XMTP: Failed to get current inbox ID:', err);
      });
    }
  }, [isConnected, currentUserInboxId, getCurrentInboxId]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedConversation]);

  // Connect to XMTP when modal opens and not already connected
  useEffect(() => {
    if (isOpen && !isConnected && !isConnecting) {
      console.log('XMTP: Modal opened, connecting to XMTP...');
      handleConnect().catch((err) => {
        console.error('XMTP: Failed to connect when modal opened:', err);
      });
    }
  }, [isOpen, isConnected, isConnecting, handleConnect]);

  // Auto-create conversation with owner if provided
  const [autoCreationAttempted, setAutoCreationAttempted] = useState(false);
  
  useEffect(() => {
    console.log('XMTP: Auto-creation check:', { 
      isConnected, 
      ownerAddress, 
      conversationsLength: conversations.length,
      autoCreationAttempted
    });
    
    // Only attempt auto-creation once per modal session
    if (isConnected && ownerAddress && !autoCreationAttempted) {
      console.log('XMTP: Auto-creating conversation with owner:', ownerAddress);
      setAutoCreationAttempted(true);
      
      createConversation(ownerAddress).then((conversation) => {
        console.log('XMTP: Auto-created conversation:', conversation.id);
        setSelectedConversation(conversation.id);
        loadMessages(conversation.id);
      }).catch((err) => {
        console.error('XMTP: Failed to auto-create conversation:', err);
        // Reset the flag so user can try again
        setAutoCreationAttempted(false);
      });
    }
  }, [isConnected, ownerAddress, autoCreationAttempted, createConversation, loadMessages, conversations.length]);
  
  // Reset auto-creation flag when modal closes
  useEffect(() => {
    if (!isOpen) {
      setAutoCreationAttempted(false);
    }
  }, [isOpen]);

  // Handle creating new DM
  const handleCreateNewDm = async () => {
    if (!newDmAddress.trim()) return;
    
    const address = newDmAddress.trim();
    
    // Basic address validation
    if (!address.startsWith('0x') || address.length !== 42) {
      alert('Please enter a valid Ethereum address (0x followed by 40 characters)');
      return;
    }
    
    setIsCreatingDm(true);
    try {
      console.log('XMTP: Creating new DM with address:', address);
      
      // Check if wallet is reachable first
      console.log('XMTP: Checking if wallet is reachable before creating conversation...');
      const isReachable = await canMessage(address);
      console.log('XMTP: Wallet reachability check:', { address, isReachable });
      
      const conversation = await createConversation(address);
      console.log('XMTP: Created new DM:', conversation.id);
      
      // Reload conversations to include the new one
      await loadConversations();
      
      // Select the new conversation
      setSelectedConversation(conversation.id);
      await loadMessages(conversation.id);
      
      // Close dialog and reset
      setShowNewDmDialog(false);
      setNewDmAddress('');
    } catch (err) {
      console.error('XMTP: Failed to create new DM:', err);
      alert('Failed to create conversation. The wallet might not have XMTP installed.');
    } finally {
      setIsCreatingDm(false);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    try {
      console.log('XMTP: handleSendMessage called with selectedConversation:', selectedConversation);
      
      // If no conversation is selected but we have an owner address, create one
      if (!selectedConversation && ownerAddress) {
        console.log('XMTP: No conversation selected, creating one with owner:', ownerAddress);
        
        try {
          const conversation = await createConversation(ownerAddress);
          console.log('XMTP: Created conversation:', conversation.id);
          setSelectedConversation(conversation.id);
          
          // Reload conversations to ensure the new one appears in the UI
          await loadConversations();
          await loadMessages(conversation.id);
          
          // Now send the message using the normal sendMessage function
          console.log('XMTP: Sending message to newly created conversation:', conversation.id);
          await sendMessage(conversation.id, newMessage.trim());
          setNewMessage('');
          return;
        } catch (createErr) {
          console.error('XMTP: Failed to create conversation in handleSendMessage:', createErr);
          // Don't clear the message so user can try again
          return;
        }
      }

      if (!selectedConversation) {
        console.error('No conversation selected and no owner address provided');
        return;
      }

      console.log('XMTP: Sending message to conversation:', selectedConversation);
      await sendMessage(selectedConversation, newMessage.trim());
      setNewMessage('');
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatTimestamp = (timestamp: Date) => {
    const now = new Date();
    const diffInHours = (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      // Today - show time
      return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffInHours < 48) {
      // Yesterday
      return 'Yesterday';
    } else {
      // Older - show date
      return timestamp.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const filteredConversations = conversations.filter(conversation =>
    conversation.id.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const currentMessages = selectedConversation ? messages[selectedConversation] || [] : [];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-6xl h-full max-h-[95vh] flex flex-col">
        {/* Main Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <MessageCircle className="w-6 h-6 text-blue-600" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {ownerAddress ? 'XMTP Messaging' : 'XMTP Inbox'}
                </h2>
                {ownerAddress ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {assetType} #{tokenId} • {formatAddress(ownerAddress)}
                  </p>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Your conversations and messages
                  </p>
                )}
              </div>
            </div>
            
            {/* Status Badge */}
            {isConnected ? (
              <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                <CheckCircle className="w-3 h-3 mr-1" />
                <span className="hidden sm:inline">{isEmbeddedWallet ? "XMTP (Smart Account)" : "XMTP Connected"}</span>
                <span className="sm:hidden">Connected</span>
              </Badge>
            ) : isConnecting ? (
              <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                Connecting...
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200">
                <AlertCircle className="w-3 h-3 mr-1" />
                Not Connected
              </Badge>
            )}
          </div>
        </div>

        {/* Action Buttons Subheader */}
        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {/* New DM Button */}
              {isConnected && (
                <Dialog open={showNewDmDialog} onOpenChange={setShowNewDmDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="px-3">
                      <Plus className="w-4 h-4 mr-2" />
                      <span>New DM</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create New Direct Message</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Wallet Address
                        </label>
                        <Input
                          placeholder="0x..."
                          value={newDmAddress}
                          onChange={(e) => setNewDmAddress(e.target.value)}
                          className="font-mono text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Enter the Ethereum address of the person you want to message
                        </p>
                      </div>
                      <div className="flex justify-end space-x-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowNewDmDialog(false);
                            setNewDmAddress('');
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleCreateNewDm}
                          disabled={!newDmAddress.trim() || isCreatingDm}
                        >
                          {isCreatingDm ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Creating...
                            </>
                          ) : (
                            <>
                              <MessageCircle className="w-4 h-4 mr-2" />
                              Create DM
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
              
              {/* Sync Button */}
              {isConnected && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={manualSync}
                  disabled={isLoading}
                  title="Sync messages"
                  className="px-3"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  <span>Sync</span>
                </Button>
              )}
            </div>
            
            {/* Close Button */}
            <Button variant="outline" size="sm" onClick={onClose} className="px-3">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Mobile Conversation List View */}
          <div className="md:hidden flex-1 flex flex-col">
            {!selectedConversation ? (
              <>
                {/* Mobile Search */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <Input
                      placeholder="Search conversations..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>

                {/* Mobile Conversation List */}
                <div className="flex-1 overflow-y-auto">
                  {!isConnected ? (
                    <div className="p-4">
                      <Card>
                        <CardContent className="p-4">
                          <div className="text-center">
                            <MessageCircle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                              {isConnecting 
                                ? "Connecting to XMTP..." 
                                : isConnected 
                                  ? "XMTP is connected and ready"
                                  : "Connect your wallet to start messaging"
                              }
                            </p>
                            {!isConnected && !isConnecting && (
                              <Button 
                                onClick={handleConnect} 
                                disabled={isConnecting}
                                className="w-full"
                              >
                                <MessageCircle className="w-4 h-4 mr-2" />
                                Connect XMTP
                              </Button>
                            )}
                            {isConnecting && (
                              <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Connecting...</span>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  ) : (
                    <div className="p-2">
                      <div className="text-xs text-gray-500 px-2 py-1 mb-2">
                        {filteredConversations.length} conversation{filteredConversations.length !== 1 ? 's' : ''}
                      </div>
                      {filteredConversations.map((conversation) => (
                        <div
                          key={conversation.id}
                          onClick={() => {
                            setSelectedConversation(conversation.id);
                            loadMessages(conversation.id);
                          }}
                          className={cn(
                            "p-3 rounded-lg cursor-pointer transition-colors mb-2",
                            selectedConversation === conversation.id
                              ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
                              : "hover:bg-gray-50 dark:hover:bg-gray-800"
                          )}
                        >
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center flex-shrink-0">
                              <User className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                {formatAddress(conversation.id)}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                Direct Message
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                      {filteredConversations.length === 0 && (
                        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                          <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
                            No conversations yet
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Mobile Conversation Header */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                        {formatAddress(selectedConversation || '')}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Direct Message
                      </p>
                    </div>
                    <div className="flex items-center space-x-3">
                      {isConnected && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={manualSync}
                          disabled={isLoading}
                          title="Sync messages"
                          className="px-3"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedConversation(null)}
                        className="px-3"
                      >
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        <span>Back</span>
                      </Button>
                    </div>
                  </div>
                </div>
                
                {/* Mobile Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {currentMessages.map((message, index) => {
                    // Determine if this message is from the current user using inbox ID
                    const messageSender = message.senderInboxId;
                    
                    // Compare sender inbox ID with current user's inbox ID
                    const isFromCurrentUser = messageSender && currentUserInboxId && 
                      messageSender === currentUserInboxId;
                    
                    // Debug logging to understand message structure
                    console.log('XMTP: Message debug:', {
                      index,
                      messageId: message.id,
                      content: message.content,
                      senderInboxId: message.senderInboxId,
                      currentUserInboxId,
                      isFromCurrentUser,
                      messageKeys: Object.keys(message)
                    });
                    
                    return (
                      <div
                        key={index}
                        className={cn(
                          "flex",
                          isFromCurrentUser ? "justify-end" : "justify-start"
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[85%] px-4 py-3 rounded-lg",
                            isFromCurrentUser
                              ? "bg-blue-500 text-white" // Sent message styling
                              : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white" // Received message styling
                          )}
                        >
                          {/* Message content */}
                          <p className="text-sm leading-relaxed">
                            {typeof message.content === 'string' ? message.content : 'Message'}
                          </p>
                          
                          {/* Message metadata */}
                          <div className="flex items-center justify-between mt-2">
                            <p className="text-xs opacity-70">
                              {formatTimestamp(message.sentAtNs ? new Date(Number(message.sentAtNs) / 1000000) : new Date())}
                            </p>
                            <p className="text-xs opacity-70 ml-3">
                              {isFromCurrentUser 
                                ? "You" 
                                : formatAddress(messageSender || 'Unknown')
                              }
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {/* Mobile Message Input */}
                <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex space-x-3">
                    <Textarea
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Type your message..."
                      className="flex-1 min-h-[44px] max-h-[120px] resize-none text-sm leading-[44px] py-0"
                      rows={1}
                    />
                    <Button 
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim() || isLoading}
                      className="flex-shrink-0 w-[44px] h-[44px] p-0 flex items-center justify-center"
                    >
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Desktop Sidebar - Conversations */}
          <div className={cn(
            "border-r border-gray-200 dark:border-gray-700 flex flex-col hidden md:flex transition-all duration-300",
            isConversationListCollapsed ? "w-16" : "w-80"
          )}>
            {/* Header with collapse toggle */}
            <div className={cn(
              "border-b border-gray-200 dark:border-gray-700 flex items-center transition-all duration-300",
              isConversationListCollapsed ? "p-2 justify-center" : "p-4 justify-between"
            )}>
              {!isConversationListCollapsed && (
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search conversations..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsConversationListCollapsed(!isConversationListCollapsed)}
                className={cn(
                  "transition-all duration-300",
                  isConversationListCollapsed ? "mx-auto" : "ml-2"
                )}
                title={isConversationListCollapsed ? "Expand conversations" : "Collapse conversations"}
              >
                {isConversationListCollapsed ? (
                  <Search className="w-4 h-4" />
                ) : (
                  <X className="w-4 h-4" />
                )}
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {!isConnected ? (
                <div className="p-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-center">
                        <MessageCircle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                          {isConnecting 
                            ? "Connecting to XMTP..." 
                            : isConnected 
                              ? "XMTP is connected and ready"
                              : "Connect your wallet to start messaging"
                          }
                        </p>
                        {!isConnected && !isConnecting && (
                          <Button 
                            onClick={handleConnect} 
                            disabled={isConnecting}
                            className="w-full"
                          >
                            <MessageCircle className="w-4 h-4 mr-2" />
                            Connect XMTP
                          </Button>
                        )}
                        {isConnecting && (
                          <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Connecting...</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <div className={cn(
                  "transition-all duration-300",
                  isConversationListCollapsed ? "p-2" : "space-y-1 p-2"
                )}>
                  {!isConversationListCollapsed && (
                    <div className="text-xs text-gray-500 px-3 py-1">
                      {filteredConversations.length} conversation{filteredConversations.length !== 1 ? 's' : ''}
                    </div>
                  )}
                  {filteredConversations.map((conversation) => (
                    <div
                      key={conversation.id}
                      onClick={() => {
                        console.log('XMTP: Selected conversation:', conversation.id);
                        setSelectedConversation(conversation.id);
                        loadMessages(conversation.id);
                      }}
                       className={cn(
                         "cursor-pointer transition-colors",
                         isConversationListCollapsed 
                           ? "p-2 rounded-lg flex justify-center" 
                           : "p-3 rounded-lg",
                         selectedConversation === conversation.id
                           ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
                           : "hover:bg-gray-50 dark:hover:bg-gray-800"
                       )}
                     >
                       <div className={cn(
                         "flex items-center",
                         isConversationListCollapsed ? "justify-center" : "space-x-3"
                       )}>
                         <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center flex-shrink-0">
                           <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                         </div>
                         {!isConversationListCollapsed && (
                           <div className="flex-1 min-w-0">
                             <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                               {formatAddress(conversation.id)}
                             </p>
                             <p className="text-xs text-gray-500 dark:text-gray-400">
                               Direct Message
                             </p>
                           </div>
                         )}
                       </div>
                     </div>
                   ))}
                </div>
              )}
            </div>
          </div>

          {/* Desktop Main Chat Area */}
          <div className="flex-1 flex flex-col w-full min-h-0 hidden md:flex">
            {selectedConversation ? (
              <>
                {/* Desktop Conversation Header */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                        {formatAddress(selectedConversation || '')}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Direct Message
                      </p>
                    </div>
                    <div className="flex items-center space-x-3">
                      {isConnected && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={manualSync}
                          disabled={isLoading}
                          title="Sync messages"
                          className="px-3"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                  {currentMessages.map((message, index) => {
                    // Determine if this message is from the current user using inbox ID
                    const messageSender = message.senderInboxId;
                    
                    // Compare sender inbox ID with current user's inbox ID
                    const isFromCurrentUser = messageSender && currentUserInboxId && 
                      messageSender === currentUserInboxId;
                    
                    // Debug logging to understand message structure
                    console.log('XMTP: Message debug:', {
                      index,
                      messageId: message.id,
                      content: message.content,
                      senderInboxId: message.senderInboxId,
                      currentUserInboxId,
                      isFromCurrentUser,
                      messageKeys: Object.keys(message)
                    });
                    
                    return (
                      <div
                        key={index}
                        className={cn(
                          "flex",
                          isFromCurrentUser ? "justify-end" : "justify-start"
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[85%] sm:max-w-xs lg:max-w-md px-4 py-3 rounded-lg",
                            isFromCurrentUser
                              ? "bg-blue-500 text-white" // Sent message styling
                              : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white" // Received message styling
                          )}
                        >
                          {/* Message content */}
                          <p className="text-sm leading-relaxed">
                            {typeof message.content === 'string' ? message.content : 'Message'}
                          </p>
                          
                          {/* Message metadata */}
                          <div className="flex items-center justify-between mt-2">
                            <p className="text-xs opacity-70">
                              {formatTimestamp(message.sentAtNs ? new Date(Number(message.sentAtNs) / 1000000) : new Date())}
                            </p>
                            <p className="text-xs opacity-70 ml-3">
                              {isFromCurrentUser 
                                ? "You" 
                                : formatAddress(messageSender || 'Unknown')
                              }
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {/* Message Input */}
                <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex space-x-3">
                    <Textarea
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Type your message..."
                      className="flex-1 min-h-[44px] max-h-[120px] resize-none text-sm leading-[44px] py-0"
                      rows={1}
                    />
                    <Button 
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim() || isLoading}
                      className="flex-shrink-0 w-[44px] h-[44px] p-0 flex items-center justify-center"
                    >
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center p-8">
                  <MessageCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-2">
                    {isConnected 
                      ? (ownerAddress ? "Creating conversation..." : "Select a conversation") 
                      : "Connect to start messaging"
                    }
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md">
                    {isConnected 
                      ? (ownerAddress 
                          ? `Setting up conversation with ${formatAddress(ownerAddress)}...`
                          : "Choose a conversation from the list above to start messaging"
                        )
                      : "Connect your wallet to start messaging with T-Deed owners"
                    }
                  </p>
                  {!isConnected && !isConnecting && (
                    <Button onClick={handleConnect} className="w-full max-w-xs">
                      <MessageCircle className="w-4 h-4 mr-2" />
                      Connect XMTP
                    </Button>
                  )}
                  {isConnected && ownerAddress && (
                    <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Setting up conversation...</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800 animate-in slide-in-from-bottom duration-300">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default XMTPMessaging; 