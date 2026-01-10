import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Archive,
  Users
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface XMTPMessagingProps {
  ownerAddress?: string;
  tokenId?: string;
  assetType?: string;
  isOpen: boolean;
  onClose: () => void;
  initialConversationId?: string | null;
}

const XMTPMessaging: React.FC<XMTPMessagingProps> = ({
  ownerAddress,
  tokenId,
  assetType,
  isOpen,
  onClose,
  initialConversationId,
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
    createGroupConversation,
    syncOptimisticGroups,
    manualSync,
    canMessage,
    getCurrentInboxId,
    isConnected 
  } = useXMTP();
  
  const { handleConnect, isConnecting, isEmbeddedWallet, address } = useXMTPConnection();
  
  const [selectedConversation, setSelectedConversation] = useState<string | null>(initialConversationId || null);

  // Update selected conversation when initialConversationId changes
  useEffect(() => {
    if (isOpen && initialConversationId) {
      setSelectedConversation(initialConversationId);
      loadMessages(initialConversationId);
    }
  }, [isOpen, initialConversationId, loadMessages]);

  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [newDmAddress, setNewDmAddress] = useState('');
  const [isCreatingDm, setIsCreatingDm] = useState(false);
  const [showNewConversationDialog, setShowNewConversationDialog] = useState(false);
  const [conversationType, setConversationType] = useState<'dm' | 'group'>('dm');
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>(['']);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [currentUserInboxId, setCurrentUserInboxId] = useState<string | null>(null);
  const [isConversationListCollapsed, setIsConversationListCollapsed] = useState(false);
  const [hiddenConversations, setHiddenConversations] = useState<Set<string>>(new Set());
  const [showHiddenConversations, setShowHiddenConversations] = useState(false);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Manual sync handler
  const handleManualSync = useCallback(() => {
    console.log('XMTP: Manual sync triggered by user');
    return manualSync();
  }, [manualSync]);

  // Dedicated auto-sync function with stable dependencies
  const performAutoSync = useCallback(async () => {
    if (!isConnected) return;
    
    console.log('XMTP: Auto sync triggered');
    setIsAutoSyncing(true);
    
    try {
      // Sync conversations
      await loadConversations();
      
      // Sync optimistic groups
      await syncOptimisticGroups();
      
      console.log('XMTP: Auto sync completed successfully');
    } catch (error) {
      console.error('XMTP: Auto sync failed:', error);
    } finally {
      setIsAutoSyncing(false);
    }
  }, [isConnected]); // Only depend on isConnected, not the functions themselves

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

  // Load hidden conversations from localStorage
  useEffect(() => {
    const savedHidden = localStorage.getItem('xmtp-hidden-conversations');
    if (savedHidden) {
      try {
        const hiddenArray = JSON.parse(savedHidden);
        setHiddenConversations(new Set(hiddenArray));
      } catch (err) {
        console.error('Failed to load hidden conversations:', err);
      }
    }
  }, []);

  // Unified auto-sync system
  useEffect(() => {
    if (!isConnected) return;

    console.log('XMTP: Setting up auto-sync system...');
    
    // Initial sync after 250ms to ensure everything is loaded
    const initialSyncTimer = setTimeout(() => {
      console.log('XMTP: Performing initial auto-sync...');
      performAutoSync();
    }, 250);

    // Periodic sync every 30 seconds
    const syncInterval = setInterval(() => {
      console.log('XMTP: Performing periodic auto-sync...');
      performAutoSync();
    }, 30000);

    return () => {
      console.log('XMTP: Cleaning up auto-sync timers...');
      clearTimeout(initialSyncTimer);
      clearInterval(syncInterval);
    };
  }, [isConnected, performAutoSync]);

  // Save hidden conversations to localStorage
  const saveHiddenConversations = (hidden: Set<string>) => {
    try {
      localStorage.setItem('xmtp-hidden-conversations', JSON.stringify([...hidden]));
    } catch (err) {
      console.error('Failed to save hidden conversations:', err);
    }
  };

  // Hide a conversation
  const hideConversation = (conversationId: string) => {
    const newHidden = new Set(hiddenConversations);
    newHidden.add(conversationId);
    setHiddenConversations(newHidden);
    saveHiddenConversations(newHidden);
  };

  // Unhide a conversation
  const unhideConversation = (conversationId: string) => {
    const newHidden = new Set(hiddenConversations);
    newHidden.delete(conversationId);
    setHiddenConversations(newHidden);
    saveHiddenConversations(newHidden);
  };

  // Handle creating new group
  const handleCreateGroup = async () => {
    if (!groupName.trim() || groupMembers.length === 0) return;
    
    // Filter out empty addresses and validate
    const validMembers = groupMembers.filter(member => member.trim().startsWith('0x') && member.trim().length === 42);
    
    if (validMembers.length === 0) {
      alert('Please add at least one valid Ethereum address');
      return;
    }
    
    setIsCreatingGroup(true);
    try {
      console.log('XMTP: Creating new group:', { name: groupName, members: validMembers });
      
      // Use the real createGroupConversation function
      const conversation = await createGroupConversation(groupName, validMembers);
      console.log('XMTP: Created group conversation:', conversation.id);
      
      // Reload conversations to include the new one
      await loadConversations();
      
      // Select the new conversation
      setSelectedConversation(conversation.id);
      await loadMessages(conversation.id);
      
      // Close dialog and reset
      setShowNewConversationDialog(false);
      setGroupName('');
      setGroupMembers(['']);
    } catch (err) {
      console.error('XMTP: Failed to create new group:', err);
      alert(err instanceof Error ? err.message : 'Failed to create group. Please check the addresses and try again.');
    } finally {
      setIsCreatingGroup(false);
    }
  };

  // Add group member field
  const addGroupMember = () => {
    setGroupMembers([...groupMembers, '']);
  };

  // Remove group member field
  const removeGroupMember = (index: number) => {
    if (groupMembers.length > 1) {
      const newMembers = groupMembers.filter((_, i) => i !== index);
      setGroupMembers(newMembers);
    }
  };

  // Update group member address
  const updateGroupMember = (index: number, address: string) => {
    const newMembers = [...groupMembers];
    newMembers[index] = address;
    setGroupMembers(newMembers);
  };

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
      setShowNewConversationDialog(false);
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

  // Determine if a conversation is a group by checking localStorage metadata and conversation type
  const isGroupConversation = (conversationId: string) => {
    try {
      // First check if it's a real XMTP group by looking at the conversation
      const conversation = conversations.find(c => c.id === conversationId);
      if (conversation) {
        // Check if it's a Group instance (real XMTP group)
        const isRealGroup = conversation.constructor.name === 'Group';
        if (isRealGroup) {
          console.log('XMTP: Found real XMTP group:', conversationId);
          return true;
        }
      }
      
      // Then check localStorage for our stored group metadata (optimistic groups)
      const groups = JSON.parse(localStorage.getItem('xmtp-groups') || '[]');
      const isStoredGroup = groups.some((group: any) => group.id === conversationId && group.type === 'group');
      
      if (isStoredGroup) {
        console.log('XMTP: Found optimistic group in localStorage:', conversationId);
        return true;
      }
      
      return false;
    } catch (err) {
      console.error('Error checking group conversation:', err);
      return false;
    }
  };

  // Get group metadata for display
  const getGroupMetadata = (conversationId: string) => {
    try {
      const groups = JSON.parse(localStorage.getItem('xmtp-groups') || '[]');
      return groups.find((group: any) => group.id === conversationId && group.type === 'group');
    } catch (err) {
      console.error('Error getting group metadata:', err);
      return null;
    }
  };

  // Get conversation members count for display (works for both DMs and groups)
  const getConversationMembersCount = (conversationId: string) => {
    try {
      const conversation = conversations.find(c => c.id === conversationId);
      if (!conversation) return 0;

      // Debug logging
      console.log('XMTP: Getting member count for conversation:', {
        conversationId,
        conversationType: conversation.constructor.name,
        isGroup: isGroupConversation(conversationId),
        conversationKeys: Object.keys(conversation)
      });

      // Check if it's a group conversation first
      if (isGroupConversation(conversationId)) {
        // For real XMTP groups, try to get actual member count
        if (conversation.constructor.name === 'Group') {
          try {
            // Try to get members from the group object (this might not work in all cases)
            const metadata = getGroupMetadata(conversationId);
            if (metadata && metadata.members) {
              return metadata.members.length;
            }
            // Fallback: assume at least 2 members for a group (creator + 1 member)
            return 2;
          } catch (err) {
            console.warn('Could not get group members count:', err);
            return 2; // Fallback
          }
        }

        // For optimistic groups, use stored metadata
        const metadata = getGroupMetadata(conversationId);
        if (metadata && metadata.members) {
          return metadata.members.length;
        }

        // Fallback for groups
        return 2;
      }

      // If it's not a group, it's a DM - always 1 member (just the recipient, excluding sender)
      console.log('XMTP: Conversation is a DM, returning 1 member');
      return 1;
    } catch (err) {
      console.error('Error getting conversation members count:', err);
      return 0;
    }
  };

  // Get the actual conversation type for debugging
  const getConversationType = (conversationId: string) => {
    const conversation = conversations.find(c => c.id === conversationId);
    if (!conversation) return 'Unknown';
    
    const isRealGroup = conversation.constructor.name === 'Group';
    const metadata = getGroupMetadata(conversationId);
    
    if (isRealGroup) return 'Real XMTP Group';
    if (metadata) return 'Optimistic Group';
    return 'Direct Message';
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

  const filteredConversations = conversations.filter(conversation => {
    const matchesSearch = conversation.id.toLowerCase().includes(searchQuery.toLowerCase());
    const isHidden = hiddenConversations.has(conversation.id);
    
    if (showHiddenConversations) {
      return matchesSearch && isHidden;
    } else {
      return matchesSearch && !isHidden;
    }
  });
  
  const currentMessages = selectedConversation ? messages[selectedConversation] || [] : [];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4">
      <div className="bg-white dark:bg-[#0e0e0e] rounded shadow-xl w-full max-w-6xl h-full max-h-[95vh] flex flex-col">
        {/* Main Header */}
        <div className="p-4 border-b border-black/10 dark:border-white/10">
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
              <Badge variant="secondary" className="bg-green-100 dark:border-green-800 border-green-200 text-green-800 dark:bg-green-900 dark:text-green-200">
                <CheckCircle className="w-3 h-3 mr-1" />
                <span className="hidden sm:inline">{isEmbeddedWallet ? "XMTP (Smart Account)" : "XMTP Connected"}</span>
                <span className="sm:hidden">Connected</span>
              </Badge>
            ) : isConnecting ? (
              <Badge variant="secondary" className="bg-yellow-100 border-yellow-200 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                Connecting...
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-gray-100 border-gray-200 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                <AlertCircle className="w-3 h-3 mr-1" />
                Not Connected
              </Badge>
            )}
          </div>
        </div>

        {/* Action Buttons Subheader */}
        <div className="p-3 border-b border-black/10 dark:border-white/10">
          <div className="flex items-center justify-between mx-0.75">
            <div className="flex items-center space-x-2">
              {/* New Conversation Button */}
              {isConnected && (
                <Dialog open={showNewConversationDialog} onOpenChange={setShowNewConversationDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="px-3 dark:bg-[#141414]">
                      <Plus className="w-4 h-4 mr-0" />
                      <span className="hidden sm:inline">New Conversation</span>
                      <span className="sm:hidden">New</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="w-[calc(100vw-2rem)] max-w-lg mx-auto rounded-sm border-black/10 dark:border-white/10">
                    <DialogHeader>
                      <DialogTitle>Create New Conversation</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      {/* Tab Navigation */}
                      <div className="flex border-b border-black/10 dark:border-white/10">
                        <button
                          onClick={() => setConversationType('dm')}
                          className={cn(
                            "flex-1 py-2 px-4 text-sm font-medium border-b-2 transition-colors",
                            conversationType === 'dm'
                              ? "border-blue-500 text-blue-600 dark:text-blue-400"
                              : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                          )}
                        >
                          <div className="flex items-center justify-center space-x-2">
                            <MessageCircle className="w-4 h-4" />
                            <span>Direct Message</span>
                          </div>
                        </button>
                        <button
                          onClick={() => setConversationType('group')}
                          className={cn(
                            "flex-1 py-2 px-4 text-sm font-medium border-b-2 transition-colors",
                            conversationType === 'group'
                              ? "border-blue-500 text-blue-600 dark:text-blue-400"
                              : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                          )}
                        >
                          <div className="flex items-center justify-center space-x-2">
                            <Users className="w-4 h-4" />
                            <span>Group Chat</span>
                          </div>
                        </button>
                      </div>

                      {/* DM Tab Content */}
                      {conversationType === 'dm' && (
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Wallet Address
                            </label>
                            <Input
                              placeholder="0x..."
                              value={newDmAddress}
                              onChange={(e) => setNewDmAddress(e.target.value)}
                              className="font-mono text-sm dark:bg-[#141414]"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                              Enter the Ethereum address of the person you want to message
                            </p>
                          </div>
                          <div className="flex justify-end space-x-2">
                            <Button
                              variant="outline"
                              onClick={() => {
                                setShowNewConversationDialog(false);
                                setNewDmAddress('');
                                setConversationType('dm');
                              }}
                              className="border-black/10 dark:border-white/10 dark:bg-[#141414]"
                            >
                              Cancel
                            </Button>
                            <Button
                              onClick={handleCreateNewDm}
                              disabled={!newDmAddress.trim() || isCreatingDm}
                              className="bg-blue-600 hover:bg-blue-700 text-white border border-blue-500 dark:border-blue-500"
                            >
                              {isCreatingDm ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-0 animate-spin" />
                                  Creating...
                                </>
                              ) : (
                                <>
                                  <MessageCircle className="w-4 h-4 mr-0" />
                                  Create DM
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Group Tab Content */}
                      {conversationType === 'group' && (
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Group Name
                            </label>
                            <Input
                              placeholder="Enter group name..."
                              value={groupName}
                              onChange={(e) => setGroupName(e.target.value)}
                              className="text-sm dark:bg-[#141414]"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Members
                            </label>
                            <div className="space-y-2">
                              {groupMembers.map((member, index) => (
                                <div key={index} className="flex items-center space-x-2">
                                  <Input
                                    placeholder="0x..."
                                    value={member}
                                    onChange={(e) => updateGroupMember(index, e.target.value)}
                                    className="font-mono text-sm flex-1 dark:bg-[#141414]"
                                  />
                                  {groupMembers.length > 1 && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => removeGroupMember(index)}
                                      className="px-2 dark:bg-[#141414] border-black/10 dark:border-white/10"
                                    >
                                      <X className="w-3 h-3" />
                                    </Button>
                                  )}
                                </div>
                              ))}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={addGroupMember}
                                className="w-full h-10 bg-black hover:opacity-90 active:opacity-80 text-white border border-black/10 dark:border-white/10 dark:bg-white dark:hover:opacity-90 dark:active:opacity-80 dark:text-black dark:hover:text-gray-500 transition-all"
                              >
                                <Plus className="w-4 h-4 mr-2" />
                                Add Member
                              </Button>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                              Add Ethereum addresses of group members
                            </p>
                          </div>
                          <div className="flex justify-end space-x-2">
                            <Button
                              variant="outline"
                              onClick={() => {
                                setShowNewConversationDialog(false);
                                setGroupName('');
                                setGroupMembers(['']);
                                setConversationType('dm');
                              }}
                              className="border-black/10 dark:border-white/10 dark:bg-[#141414]"
                            >
                              Cancel
                            </Button>
                            <Button
                              onClick={handleCreateGroup}
                              disabled={!groupName.trim() || isCreatingGroup}
                              className="bg-blue-600 hover:bg-blue-700 text-white border border-blue-700 dark:border-blue-500"
                            >
                              {isCreatingGroup ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-0 animate-spin" />
                                  Creating...
                                </>
                              ) : (
                                <>
                                  <Users className="w-4 h-4 mr-0" />
                                  Create Group
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              )}
              
              {/* Sync Button */}
              {isConnected && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleManualSync}
                  disabled={isLoading || isAutoSyncing}
                  title="Sync messages"
                  className="px-3 dark:bg-[#141414] w-11 md:w-auto"
                >
                  <RefreshCw className={cn("w-4 h-4 md:mr-0", (isAutoSyncing || isLoading) && "animate-spin")} />
                  <span className="hidden md:inline">Sync</span>
                </Button>
              )}

              {/* Hidden Conversations Toggle */}
              {isConnected && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowHiddenConversations(!showHiddenConversations)}
                  className="px-3 dark:bg-[#141414]"
                  title={showHiddenConversations ? "Show active conversations" : "Show hidden conversations"}
                >
                  {showHiddenConversations ? (
                    <>
                      <Eye className="w-4 h-4 mr-0" />
                      <span>Active</span>
                    </>
                  ) : (
                    <>
                      <Archive className="w-4 h-4 mr-0" />
                      <span>Hidden</span>
                    </>
                  )}
                </Button>
              )}
            </div>
            
            {/* Close Button */}
            <Button variant="outline" size="sm" onClick={onClose} className="px-3 dark:bg-[#141414]">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Mobile Conversation List View */}
          <div className="md:hidden flex-1 flex flex-col min-h-0">
            {!selectedConversation ? (
              <>
                {/* Mobile Search */}
                <div className="p-4 border-b border-black/10 dark:border-white/10">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <Input
                      placeholder="Search conversations..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9.5 h-[44px] dark:bg-[#141414] placeholder:text-sm placeholder:text-black/50 dark:placeholder:text-white/50"
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
                                className="w-full dark:bg-[#141414]"
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
                    <div>
                      <div className="text-xs text-gray-500 px-2 py-2 mb-0 border-b border-black/10 dark:border-white/10 pb-2">
                        {filteredConversations.length} conversation{filteredConversations.length !== 1 ? 's' : ''}
                      </div>
                      {filteredConversations.map((conversation) => (
                        <div
                          key={conversation.id}
                          className={cn(
                            "p-3 transition-colors border-b border-black/10 dark:border-white/10 last:border-b-0",
                            selectedConversation === conversation.id
                              ? "bg-blue-50 dark:bg-blue-900/20 border-l-4 border-l-blue-500 dark:border-l-blue-400"
                              : "hover:bg-gray-50 dark:hover:bg-gray-800"
                          )}
                        >
                                                      <div className="flex items-center justify-between">
                              <div 
                                className="flex-1 flex items-center space-x-3 cursor-pointer"
                                onClick={() => {
                                  setSelectedConversation(conversation.id);
                                  loadMessages(conversation.id);
                                }}
                              >
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
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (showHiddenConversations) {
                                    unhideConversation(conversation.id);
                                  } else {
                                    hideConversation(conversation.id);
                                  }
                                }}
                                className="px-2 py-1 h-10 dark:bg-[#141414]"
                                title={showHiddenConversations ? "Unhide conversation" : "Hide conversation"}
                              >
                                {showHiddenConversations ? (
                                  <Eye className="w-4 h-4" />
                                ) : (
                                  <EyeOff className="w-4 h-4" />
                                )}
                              </Button>
                            </div>
                        </div>
                      ))}
                      {filteredConversations.length === 0 && (
                        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded">
                          <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
                            {showHiddenConversations 
                              ? "No hidden conversations" 
                              : "No conversations yet"
                            }
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
                <div className="p-4 border-b border-black/10 dark:border-white/10">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                        {isGroupConversation(selectedConversation || '') 
                          ? (getGroupMetadata(selectedConversation || '')?.name || 'Group Chat')
                          : formatAddress(selectedConversation || '')
                        }
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {getConversationType(selectedConversation || '') === 'Real XMTP Group' || getConversationType(selectedConversation || '') === 'Optimistic Group'
                          ? `Group Chat • ${getConversationMembersCount(selectedConversation || '')} members`
                          : `Direct Message • ${getConversationMembersCount(selectedConversation || '')} members`
                        }
                      </p>
                    </div>
                    <div className="flex items-center space-x-3">
                      {isConnected && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={manualSync}
                          disabled={isLoading || isAutoSyncing}
                          title="Sync messages"
                          className="px-3 dark:bg-[#141414]"
                        >
                          <RefreshCw className={cn("w-4 h-4", (isAutoSyncing || isLoading) && "animate-spin")} />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedConversation(null)}
                        className="px-3 dark:bg-[#141414]"
                      >
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        <span>Back</span>
                      </Button>
                    </div>
                  </div>
                </div>
                
                {/* Mobile Messages */}
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
                            "max-w-[85%] px-4 py-3 rounded-sm",
                            isFromCurrentUser
                              ? "bg-blue-600 text-white" // Sent message styling
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
                <div className="p-4 border-t border-black/10 dark:border-white/10">
                  <div className="flex space-x-2">
                    <Textarea
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Type your message..."
                      className="flex-1 min-h-[44px] max-h-[120px] resize-none text-sm leading-relaxed py-2 dark:bg-[#141414]"
                      rows={1}
                    />
                    <Button 
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim() || isLoading}
                      className="flex-shrink-0 w-[44px] h-[44px] p-0 flex items-center justify-center bg-black dark:bg-white"
                    >
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4 text-white dark:text-gray-900" />
                      )}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Desktop Sidebar - Conversations */}
          <div className={cn(
            "border-r border-black/10 dark:border-white/10 flex flex-col hidden md:flex transition-all duration-300",
            isConversationListCollapsed ? "w-16" : "w-80"
          )}>
            {/* Header with collapse toggle */}
            <div className={cn(
              "border-b border-black/10 dark:border-white/10 flex items-center transition-all duration-300",
              isConversationListCollapsed ? "p-0 justify-center h-[69px]" : "p-3 justify-between"
            )}>
              {!isConversationListCollapsed && (
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-black dark:text-white w-4 h-4" />
                  <Input
                    placeholder="Search conversations..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9.5 h-[44px] placeholder:text-sm placeholder:text-black/50 dark:placeholder:text-white/50"
                  />
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsConversationListCollapsed(!isConversationListCollapsed)}
                className={cn(
                  "transition-all duration-300 dark:bg-[#141414]",
                  isConversationListCollapsed ? "mx-auto" : "ml-2"
                )}
                title={isConversationListCollapsed ? "Expand conversations" : "Collapse conversations"}
              >
                {isConversationListCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronLeft className="w-4 h-4" />
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
                  isConversationListCollapsed ? "" : ""
                )}>
                  {!isConversationListCollapsed && (
                    <div className="text-xs text-gray-500 px-3 py-2 mb-0 border-b border-black/10 dark:border-white/10 pb-2">
                      {filteredConversations.length} {showHiddenConversations ? 'hidden' : ''} conversation{filteredConversations.length !== 1 ? 's' : ''}
                    </div>
                  )}
                  {filteredConversations.map((conversation) => (
                    <div
                      key={conversation.id}
                      className={cn(
                                                  "transition-colors group",
                          isConversationListCollapsed 
                            ? "p-3 flex justify-center h-16" 
                            : "p-3 h-16 content-center border-b border-black/10 dark:border-white/10 last:border-b-0",
                        selectedConversation === conversation.id
                          ? "bg-blue-50 dark:bg-blue-900/20 border-l-4 border-l-blue-500 dark:border-l-blue-400"
                          : "hover:bg-gray-50 dark:hover:bg-gray-800"
                      )}
                    >
                                              <div className={cn(
                          "flex items-center justify-between",
                          isConversationListCollapsed ? "justify-center" : ""
                        )}>
                          <div 
                            className={cn(
                              "flex items-center",
                              isConversationListCollapsed ? "justify-center" : "space-x-3"
                            )}
                            onClick={() => {
                              console.log('XMTP: Selected conversation:', conversation.id);
                              setSelectedConversation(conversation.id);
                              loadMessages(conversation.id);
                            }}
                          >
                            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center flex-shrink-0">
                              <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                            </div>
                            {!isConversationListCollapsed && (
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                  {isGroupConversation(conversation.id) 
                                    ? (getGroupMetadata(conversation.id)?.name || 'Group Chat')
                                    : formatAddress(conversation.id)
                                  }
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {getConversationType(conversation.id) === 'Real XMTP Group' || getConversationType(conversation.id) === 'Optimistic Group'
                                    ? `Group Chat • ${getConversationMembersCount(conversation.id)} members`
                                    : `Direct Message • ${getConversationMembersCount(conversation.id)} members`
                                  }
                                </p>
                              </div>
                            )}
                          </div>
                          {!isConversationListCollapsed && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (showHiddenConversations) {
                                  unhideConversation(conversation.id);
                                } else {
                                  hideConversation(conversation.id);
                                }
                              }}
                              className="px-2 py-1 h-8 opacity-0 group-hover:opacity-100 transition-opacity dark:bg-[#141414]"
                              title={showHiddenConversations ? "Unhide conversation" : "Hide conversation"}
                            >
                              {showHiddenConversations ? (
                                <Eye className="w-3 h-3" />
                              ) : (
                                <EyeOff className="w-3 h-3" />
                              )}
                            </Button>
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
                <div className="p-4 border-b border-black/10 dark:border-white/10">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                        {isGroupConversation(selectedConversation || '') 
                          ? (getGroupMetadata(selectedConversation || '')?.name || 'Group Chat')
                          : formatAddress(selectedConversation || '')
                        }
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {getConversationType(selectedConversation || '') === 'Real XMTP Group' || getConversationType(selectedConversation || '') === 'Optimistic Group'
                          ? `Group Chat • ${getConversationMembersCount(selectedConversation || '')} members`
                          : `Direct Message • ${getConversationMembersCount(selectedConversation || '')} members`
                        }
                      </p>
                    </div>
                    <div className="flex items-center space-x-3">
                      {isConnected && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={handleManualSync}
                          disabled={isLoading || isAutoSyncing}
                          title="Sync messages"
                          className="px-3 dark:bg-[#141414]"
                        >
                          <RefreshCw className={cn("w-4 h-4", (isAutoSyncing || isLoading) && "animate-spin")} />
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
                            "max-w-[85%] sm:max-w-xs lg:max-w-md px-4 py-3 rounded-sm",
                            isFromCurrentUser
                              ? "bg-blue-600 text-white" // Sent message styling
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
                <div className="p-4 border-t border-black/10 dark:border-white/10">
                  <div className="flex space-x-2">
                    <Textarea
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Type your message..."
                      className="flex-1 min-h-[44px] max-h-[120px] resize-none text-sm leading-relaxed py-2 dark:bg-[#141414]"
                      rows={1}
                    />
                    <Button 
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim() || isLoading}
                      className="flex-shrink-0 w-[44px] h-[44px] p-0 flex items-center justify-center bg-black dark:bg-white"
                    >
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4 text-white dark:text-gray-900" />
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
                    <Button onClick={handleConnect} className="w-full max-w-xs dark:bg-[#141414]">
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