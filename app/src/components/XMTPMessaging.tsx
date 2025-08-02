import React, { useState, useEffect, useRef } from 'react';
import { useXMTP } from '@/context/XMTPContext';
import { useXMTPConnection } from '@/hooks/useXMTPConnection';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { 
  MessageCircle, 
  Send, 
  User, 
  Loader2, 
  AlertCircle,
  CheckCircle,
  X,
  Search
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
    createConversation,
    isConnected 
  } = useXMTP();
  
  const { handleConnect, isConnecting, isEmbeddedWallet, address } = useXMTPConnection();
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
  // Temporarily disabled to debug conversation creation issues
  /*
  useEffect(() => {
    console.log('XMTP: Auto-creation check:', { 
      isConnected, 
      ownerAddress, 
      conversationsLength: conversations.length,
      conversations: conversations.map(c => c.id)
    });
    if (isConnected && ownerAddress && conversations.length === 0) {
      console.log('XMTP: Auto-creating conversation with owner:', ownerAddress);
      // In V3, we can auto-create conversations using the owner's inbox ID
      handleCreateConversation(ownerAddress).catch((err) => {
        console.error('XMTP: Failed to auto-create conversation:', err);
      });
    }
  }, [isConnected, ownerAddress, conversations.length]);
  */





  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    try {
      console.log('XMTP: handleSendMessage called with selectedConversation:', selectedConversation);
      console.log('XMTP: Available conversations:', conversations.map(c => c.id));
      
      // If no conversation is selected but we have an owner address, create one
      if (!selectedConversation && ownerAddress) {
        console.log('XMTP: No conversation selected, creating one with owner:', ownerAddress);
        const conversation = await createConversation(ownerAddress);
        console.log('XMTP: Created conversation:', conversation.id);
        setSelectedConversation(conversation.id);
        await loadMessages(conversation.id);
        
        // Now send the message using the normal sendMessage function
        console.log('XMTP: Sending message to newly created conversation:', conversation.id);
        await sendMessage(conversation.id, newMessage.trim());
        setNewMessage('');
        return;
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
    return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const filteredConversations = conversations.filter(() =>
    // In V3, we need to filter conversations differently
    // For now, show all conversations until we implement proper V3 conversation handling
    true
  );

  const currentMessages = selectedConversation ? messages[selectedConversation] || [] : [];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-4xl h-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
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
                      <div className="flex items-center space-x-2">
              {isConnected ? (
                <div className="flex items-center space-x-2">
                  <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    {isEmbeddedWallet ? "XMTP (Smart Account)" : "XMTP Connected"}
                  </Badge>
                  {address && (
                    <Badge variant="outline" className="text-xs">
                      {address.slice(0, 6)}...{address.slice(-4)}
                    </Badge>
                  )}
                </div>
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
              <Button variant="outline" size="sm" onClick={onClose}>
                <X className="w-4 h-4" />
              </Button>
            </div>
        </div>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Mobile Conversation Selector */}
          <div className="md:hidden p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            {isConnected && filteredConversations.length > 0 && (
              <div className="mt-3 space-y-2">
                {filteredConversations.map((conversation) => (
                  <div
                    key={conversation.id}
                    onClick={() => {
                      setSelectedConversation(conversation.id);
                      loadMessages(conversation.id);
                    }}
                    className={cn(
                      "p-3 rounded-lg cursor-pointer transition-colors",
                      selectedConversation === conversation.id
                        ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
                        : "hover:bg-gray-50 dark:hover:bg-gray-800"
                    )}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                        <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
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
              </div>
            )}
            {isConnected && filteredConversations.length === 0 && (
              <div className="mt-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
                  No conversations yet. Start messaging to see them here.
                </p>
              </div>
            )}
          </div>

          {/* Sidebar - Conversations (Desktop) */}
          <div className="w-80 border-r border-gray-200 dark:border-gray-700 flex flex-col hidden md:flex">
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
                <div className="space-y-1 p-2">
                                     {filteredConversations.map((conversation) => (
                     <div
                       key={conversation.id}
                       onClick={() => {
                         setSelectedConversation(conversation.id);
                         loadMessages(conversation.id);
                       }}
                       className={cn(
                         "p-3 rounded-lg cursor-pointer transition-colors",
                         selectedConversation === conversation.id
                           ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
                           : "hover:bg-gray-50 dark:hover:bg-gray-800"
                       )}
                     >
                       <div className="flex items-center space-x-3">
                         <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                           <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
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
                </div>
              )}
            </div>
          </div>

          {/* Main Chat Area */}
          <div className="flex-1 flex flex-col w-full">
            {selectedConversation ? (
              <>
                {/* Mobile Back Button */}
                <div className="md:hidden p-4 border-b border-gray-200 dark:border-gray-700">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedConversation(null)}
                    className="flex items-center space-x-2"
                  >
                    <X className="w-4 h-4" />
                    <span>Back to Conversations</span>
                  </Button>
                </div>
                
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                     {currentMessages.map((message, index) => (
                     <div
                       key={index}
                       className={cn(
                         "flex",
                         // In V3, we need to determine sender differently
                         // For now, assume all messages are from others
                         "justify-start"
                       )}
                     >
                       <div
                         className={cn(
                           "max-w-xs lg:max-w-md px-4 py-2 rounded-lg",
                           "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white"
                         )}
                       >
                         <p className="text-sm">
                           {typeof message.content === 'string' ? message.content : 'V3 Message'}
                         </p>
                         <p className="text-xs opacity-70 mt-1">
                           {formatTimestamp(message.sentAtNs ? new Date(Number(message.sentAtNs) / 1000000) : new Date())}
                         </p>
                       </div>
                     </div>
                   ))}
                  <div ref={messagesEndRef} />
                </div>

                {/* Message Input */}
                <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex space-x-2">
                    <Textarea
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Type your message..."
                      className="flex-1 min-h-[40px] max-h-[120px] resize-none text-sm"
                      rows={1}
                    />
                    <Button 
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim() || isLoading}
                      size="sm"
                      className="px-3"
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
                <div className="text-center p-4">
                  <MessageCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                    {isConnected ? "Select a conversation" : "Connect to start messaging"}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    {isConnected 
                      ? "Choose a conversation from the list above to start messaging"
                      : "Connect your wallet to start messaging with T-Deed owners"
                    }
                  </p>
                  {!isConnected && !isConnecting && (
                    <Button onClick={handleConnect} className="w-full max-w-xs">
                      <MessageCircle className="w-4 h-4 mr-2" />
                      Connect XMTP
                    </Button>
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