import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Client } from '@xmtp/browser-sdk';
import type { Conversation, DecodedMessage, Signer } from '@xmtp/browser-sdk';
import { ethers } from 'ethers';

// Conversation state types
export type ConversationState = 'active' | 'hidden' | 'archived';

interface ConversationMetadata {
  state: ConversationState;
  hiddenAt?: Date;
  archivedAt?: Date;
}

interface XMTPContextType {
  client: Client | null;
  conversations: Conversation[];
  messages: { [conversationId: string]: DecodedMessage[] };
  conversationStates: { [conversationId: string]: ConversationMetadata };
  isLoading: boolean;
  error: string | null;
  connect: (signer: ethers.Signer) => Promise<void>;
  disconnect: () => Promise<void>;
  sendMessage: (conversationId: string, content: string) => Promise<void>;
  deleteMessage: (conversationId: string, messageId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  hideConversation: (conversationId: string) => void;
  unhideConversation: (conversationId: string) => void;
  archiveConversation: (conversationId: string) => void;
  unarchiveConversation: (conversationId: string) => void;
  getConversationsByState: (state: ConversationState) => Conversation[];
  loadConversations: () => Promise<void>;
  loadMessages: (conversationId: string) => Promise<void>;
  createConversation: (walletAddress: string) => Promise<Conversation>;
  createGroupConversation: (name: string, members: string[]) => Promise<Conversation>;
  manualSync: () => Promise<void>;
  canMessage: (walletAddress: string) => Promise<boolean>;
  getCurrentInboxId: () => Promise<string | null>;
  syncOptimisticGroups: () => Promise<void>;
  syncConversationStates: () => void;
  cleanupExpiredInstallations: () => void;
  isConnected: boolean;
}

const XMTPContext = createContext<XMTPContextType | undefined>(undefined);

export const useXMTP = () => {
  const context = useContext(XMTPContext);
  if (context === undefined) {
    throw new Error('useXMTP must be used within an XMTPProvider');
  }
  return context;
};

interface XMTPProviderProps {
  children: ReactNode;
}

export const XMTPProvider: React.FC<XMTPProviderProps> = ({ children }) => {
  const [client, setClient] = useState<Client | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<{ [conversationId: string]: DecodedMessage[] }>({});
  const [conversationStates, setConversationStates] = useState<{ [conversationId: string]: ConversationMetadata }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Create XMTP signer from ethers signer with smart account support
  const createXMTPSigner = (ethersSigner: ethers.Signer): Signer => {
    return {
      type: "EOA", // XMTP V4 treats all signers as EOA for now
      getIdentifier: async () => {
        const address = await ethersSigner.getAddress();
        return {
          identifier: address,
          identifierKind: "Ethereum"
        };
      },
      signMessage: async (message: string): Promise<Uint8Array> => {
        try {
          const signature = await ethersSigner.signMessage(message);
          // Convert hex string to Uint8Array
          return new Uint8Array(Buffer.from(signature.slice(2), 'hex'));
        } catch (error) {
          console.error('XMTP: Failed to sign message:', error);
          throw new Error('Failed to sign message. Please ensure your wallet is properly connected.');
        }
      }
    };
  };

  // Check if XMTP installation exists for an address across browsers
  const checkExistingInstallation = async (walletAddress: string): Promise<boolean> => {
    try {
      console.log('XMTP: Checking for existing installation across browsers for:', walletAddress);
      
      // First check if we can message this address (indicates XMTP is installed)
      const canMessageResult = await Client.canMessage([{
        identifier: walletAddress,
        identifierKind: "Ethereum"
      }]);
      
      const canMessage = canMessageResult.get(walletAddress);
      console.log('XMTP: Can message check result:', { walletAddress, canMessage });
      
      return canMessage || false;
    } catch (err) {
      console.error('XMTP: Error checking existing installation:', err);
      return false;
    }
  };

  // Create XMTP client with automatic cross-browser installation detection and sync
  const connect = async (ethersSigner: ethers.Signer) => {
    try {
      console.log('XMTP: Starting connection...');
      setIsLoading(true);
      setError(null);

      // Create XMTP signer from ethers signer
      const xmtpSigner = createXMTPSigner(ethersSigner);
      
      // Get the wallet address for installation tracking
      const walletAddress = await ethersSigner.getAddress();
      console.log('XMTP: Wallet address:', walletAddress);
      
      let xmtpClient: Client;
      
      // ALWAYS check for existing installations across browsers first
      console.log('XMTP: Checking for existing installation across browsers...');
      const hasExistingInstallation = await checkExistingInstallation(walletAddress);
      
      if (hasExistingInstallation) {
        console.log('XMTP: Found existing installation, syncing with history...');
        
        // Always try to sync with existing installation using history sync
        try {
          xmtpClient = await Client.create(xmtpSigner, {
            env: 'production',
            historySyncUrl: 'https://history.xmtp.org'
          });
          console.log('XMTP: Successfully synced with existing installation');
        } catch (syncError) {
          console.log('XMTP: Failed to sync with existing installation, trying without history sync...');
          
          // Fallback: try without history sync
          try {
            xmtpClient = await Client.create(xmtpSigner, {
              env: 'production'
            });
            console.log('XMTP: Created client without history sync');
          } catch (fallbackError) {
            console.log('XMTP: All sync attempts failed, creating new installation...');
            
            // Last resort: create new installation
            xmtpClient = await Client.create(xmtpSigner, {
              env: 'production'
            });
            console.log('XMTP: Created new installation');
          }
        }
      } else {
        console.log('XMTP: No existing installation found, creating new one...');
        
        // Create new installation
        xmtpClient = await Client.create(xmtpSigner, {
          env: 'production'
        });
        console.log('XMTP: Created new installation');
      }
      
      // Store installation reference in localStorage for this browser
      const installationKey = `xmtp-installation-${walletAddress.toLowerCase()}`;
      localStorage.setItem(installationKey, JSON.stringify({
        createdAt: new Date().toISOString(),
        walletAddress: walletAddress.toLowerCase()
      }));

      setClient(xmtpClient);
      setIsConnected(true);
      
      // Load conversations after connecting
      await loadConversations();
      
      // Load conversation states for cross-browser sync
      loadConversationStates();
      
      console.log('XMTP: Connection complete');
    } catch (err) {
      console.error('Failed to connect to XMTP:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect to XMTP');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  };


  // Clean up expired installations
  const cleanupExpiredInstallations = () => {
    try {
      const now = new Date();
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
      
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('xmtp-installation-')) {
          try {
            const installation = JSON.parse(localStorage.getItem(key) || '{}');
            const createdAt = new Date(installation.createdAt);
            
            if (now.getTime() - createdAt.getTime() > maxAge) {
              console.log('XMTP: Removing expired installation:', key);
              localStorage.removeItem(key);
            }
          } catch (err) {
            console.warn('XMTP: Error parsing installation data:', key, err);
            // Remove malformed installation data
            localStorage.removeItem(key);
          }
        }
      });
    } catch (err) {
      console.error('XMTP: Error cleaning up installations:', err);
    }
  };

  const disconnect = async () => {
    console.log('XMTP: Disconnecting...');
    
    if (client) {
      try {
        await client.close();
      } catch (err) {
        console.error('XMTP: Error closing client:', err);
      }
    }
    
    setClient(null);
    setConversations([]);
    setMessages({});
    setIsConnected(false);
    setIsLoading(false);
    setError(null);
    
    // Clean up expired installations periodically
    cleanupExpiredInstallations();
  };

  // Create conversation following XMTP V4 patterns
  const createConversation = async (walletAddress: string): Promise<Conversation> => {
    if (!client) {
      throw new Error('XMTP client not connected.');
    }

    try {
      console.log('XMTP: Creating conversation with wallet:', walletAddress);
      
      // Check if wallet can receive messages
      const canMessageResult = await Client.canMessage([{
        identifier: walletAddress,
        identifierKind: "Ethereum"
      }]);
      const isReachable = canMessageResult.get(walletAddress);
      
      console.log('XMTP: Can message check result:', {
        walletAddress,
        isReachable
      });
      
      if (!isReachable) {
        console.warn('XMTP: Wallet is not reachable, but proceeding with conversation creation...');
      }
      
      // Create DM conversation using the wallet address as inbox ID
      const conversation = await client.conversations.newDm(walletAddress);
      
      console.log('XMTP: Created conversation:', {
        conversationId: conversation.id,
        walletAddress
      });
      
      // Add the new conversation to our list
      setConversations(prev => {
        const exists = prev.find(c => c.id === conversation.id);
        if (!exists) {
          return [...prev, conversation];
        }
        return prev;
      });
      
      return conversation;
    } catch (err) {
      console.error('XMTP: Error creating conversation:', err);
      setError(err instanceof Error ? err.message : 'Failed to create conversation');
      setTimeout(() => setError(null), 3000);
      throw err;
    }
  };

  // Create group conversation following XMTP V4 patterns
  const createGroupConversation = async (name: string, members: string[]): Promise<Conversation> => {
    if (!client) {
      throw new Error('XMTP client not connected.');
    }

    try {
      console.log('XMTP: Creating group conversation:', { name, members });
      
      // Validate member addresses
      const validMembers = members.filter(member => 
        member.trim().startsWith('0x') && member.trim().length === 42
      );
      
      if (validMembers.length === 0) {
        throw new Error('No valid member addresses provided');
      }

      // Check if all members can receive messages
      const canMessageResults = await Promise.all(
        validMembers.map(async (member) => {
          try {
            const result = await Client.canMessage([{
              identifier: member,
              identifierKind: "Ethereum"
            }]);
            return { member, canMessage: result.get(member) };
          } catch (err) {
            console.warn('XMTP: Could not check message capability for:', member, err);
            return { member, canMessage: false };
          }
        })
      );

      const reachableMembers = canMessageResults
        .filter(result => result.canMessage)
        .map(result => result.member);

      console.log('XMTP: Group member reachability:', {
        total: validMembers.length,
        reachable: reachableMembers.length,
        members: validMembers,
        reachableMembers
      });

      // For groups, we need at least one reachable member
      // If no members are reachable, we'll create an optimistic group instead
      if (reachableMembers.length === 0) {
        console.log('XMTP: No reachable members for group, creating optimistic group');
        
        // Create an optimistic group that can be synced later
        const conversation = await client.conversations.newGroupOptimistic({
          name: name,
          description: `Group created by ${await client.accountIdentifier}`
        });
        
        console.log('XMTP: Created optimistic group conversation:', conversation.id);
        
        // Store group metadata in localStorage for persistence
        const groupMetadata = {
          id: conversation.id,
          name,
          members: validMembers, // Store all members, even unreachable ones
          type: 'group',
          isOptimistic: true,
          createdAt: new Date().toISOString()
        };
        
        const existingGroups = JSON.parse(localStorage.getItem('xmtp-groups') || '[]');
        existingGroups.push(groupMetadata);
        localStorage.setItem('xmtp-groups', JSON.stringify(existingGroups));
        
        // Add the new conversation to our list
        setConversations(prev => {
          const exists = prev.find(c => c.id === conversation.id);
          if (!exists) {
            return [...prev, conversation];
          }
          return prev;
        });
        
        return conversation;
      }

      // Create a real XMTP group conversation with reachable members
      const conversation = await client.conversations.newGroup(reachableMembers, {
        name: name,
        description: `Group created by ${await client.accountIdentifier}`
      });
      console.log('XMTP: Created real group conversation:', conversation.id);
      
      // Store group metadata in localStorage for persistence
      const groupMetadata = {
        id: conversation.id,
        name,
        members: reachableMembers,
        type: 'group',
        createdAt: new Date().toISOString()
      };
      
      const existingGroups = JSON.parse(localStorage.getItem('xmtp-groups') || '[]');
      existingGroups.push(groupMetadata);
      localStorage.setItem('xmtp-groups', JSON.stringify(existingGroups));
      
      // Add the new conversation to our list
      setConversations(prev => {
        const exists = prev.find(c => c.id === conversation.id);
        if (!exists) {
          return [...prev, conversation];
        }
        return prev;
      });
      
      return conversation;
    } catch (err) {
      console.error('XMTP: Error creating group conversation:', err);
      setError(err instanceof Error ? err.message : 'Failed to create group conversation');
      setTimeout(() => setError(null), 3000);
      throw err;
    }
  };

  // Send message following XMTP V4 patterns
  const sendMessage = async (conversationId: string, content: string) => {
    if (!client) return;

    try {
      setIsLoading(true);
      console.log('XMTP: Sending message to conversation:', conversationId);
      
      const conversation = conversations.find(c => c.id === conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }
      
      // Send message using XMTP V4 pattern
      await conversation.send(content);
      console.log('XMTP: Message sent successfully');
      
      // Reload messages for this conversation
      await loadMessages(conversationId);
      
      console.log('XMTP: Message send completed');
    } catch (err) {
      console.error('Failed to send message:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  // Delete message (local deletion - removes from user's view)
  const deleteMessage = async (conversationId: string, messageId: string) => {
    if (!client) return;

    try {
      setIsLoading(true);
      console.log('XMTP: Removing message from view:', messageId, 'from conversation:', conversationId);
      
      // Check if conversation exists
      const conversation = conversations.find(c => c.id === conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }
      
      // Get the message to remove
      const currentMessages = messages[conversationId] || [];
      const messageToRemove = currentMessages.find(m => m.id === messageId);
      if (!messageToRemove) {
        throw new Error('Message not found');
      }
      
      // Check if user can delete this message (only their own messages)
      const currentUserInboxId = await getCurrentInboxId();
      if (messageToRemove.senderInboxId !== currentUserInboxId) {
        throw new Error('You can only delete your own messages');
      }
      
      // Remove message from local state only
      // Note: XMTP V4 doesn't support server-side message deletion
      setMessages(prev => ({
        ...prev,
        [conversationId]: prev[conversationId]?.filter(m => m.id !== messageId) || []
      }));
      
      console.log('XMTP: Message removed from view successfully');
    } catch (err) {
      console.error('Failed to remove message:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove message');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteConversation = async (conversationId: string) => {
    if (!client) return;

    try {
      setIsLoading(true);
      console.log('XMTP: Removing conversation from view:', conversationId);
      
      // Check if conversation exists
      const conversation = conversations.find(c => c.id === conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }
      
      // Remove conversation from local state
      setConversations(prev => prev.filter(c => c.id !== conversationId));
      
      // Remove messages for this conversation from local state
      setMessages(prev => {
        const newMessages = { ...prev };
        delete newMessages[conversationId];
        return newMessages;
      });
      
      console.log('XMTP: Conversation removed from view successfully');
    } catch (err) {
      console.error('Failed to remove conversation:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove conversation');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  // Load conversations following XMTP V4 patterns
  const loadConversations = async () => {
    if (!client) return;

    try {
      setIsLoading(true);
      console.log('XMTP: Loading conversations...');
      
      // List all conversations
      const allConversations = await client.conversations.list();
      console.log('XMTP: Found', allConversations.length, 'conversations');
      
              // Log conversation details for debugging
        allConversations.forEach((conv, index) => {
          // Check if it's a real XMTP group
          const isRealGroup = conv.constructor.name === 'Group';
          
          // Check localStorage for optimistic groups
          const groups = JSON.parse(localStorage.getItem('xmtp-groups') || '[]');
          const storedGroup = groups.find((group: any) => group.id === conv.id);
          
          console.log(`XMTP: Conversation ${index + 1}:`, {
            id: conv.id,
            type: isRealGroup ? 'Group' : (storedGroup ? 'Optimistic Group' : 'DM'),
            isRealGroup,
            hasStoredMetadata: !!storedGroup,
            storedGroupType: storedGroup?.type,
            constructor: conv.constructor.name
          });
        });
      
      setConversations(allConversations);
    } catch (err) {
      console.error('Failed to load conversations:', err);
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  // Load messages following XMTP V4 patterns
  const loadMessages = async (conversationId: string) => {
    if (!client) return;

    try {
      setIsLoading(true);
      const conversation = conversations.find(c => c.id === conversationId);
      if (!conversation) {
        setError('Conversation not found');
        setTimeout(() => setError(null), 3000);
        return;
      }

      const messagesList = await conversation.messages();
      console.log(`XMTP: Loaded ${messagesList.length} messages for conversation ${conversationId}`);
      
      // Sort messages by timestamp
      const sortedMessages = messagesList.sort((a: DecodedMessage, b: DecodedMessage) => {
        const timeA = a.sentAtNs ? Number(a.sentAtNs) : 0;
        const timeB = b.sentAtNs ? Number(b.sentAtNs) : 0;
        return timeA - timeB;
      });
      
      setMessages(prev => ({
        ...prev,
        [conversationId]: sortedMessages
      }));
    } catch (err) {
      console.error('Failed to load messages:', err);
      setError(err instanceof Error ? err.message : 'Failed to load messages');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  // Load conversation states when client becomes available
  useEffect(() => {
    if (client && isConnected) {
      console.log('XMTP: Client connected, loading conversation states...');
      loadConversationStates();
    }
  }, [client, isConnected]);

  // Stream messages following XMTP V4 patterns
  useEffect(() => {
    if (!client) return;

    let isStreaming = true;

    const streamMessages = async () => {
      try {
        console.log('XMTP: Starting message stream...');
        
        // Stream all messages
        const stream = await client.conversations.streamAllMessages({
          onValue: (message) => {
            if (!isStreaming) return;
            
            const conversationId = message.conversationId;
            console.log('XMTP: Received new message for conversation:', conversationId);
            
            // Update messages state with the new message
            setMessages(prev => {
              const existingMessages = prev[conversationId] || [];
              const messageExists = existingMessages.some(existing => existing.id === message.id);
              
              if (messageExists) {
                console.log('XMTP: Message already exists, skipping duplicate');
                return prev;
              }
              
              console.log('XMTP: Adding new message to conversation:', conversationId);
              return {
                ...prev,
                [conversationId]: [...existingMessages, message]
              };
            });
          },
          onError: (error) => {
            console.error('XMTP: Stream error:', error);
          }
        });
        
        // Keep the stream alive
        await stream;
      } catch (err) {
        console.error('Error streaming messages:', err);
        if (isStreaming) {
          setTimeout(() => {
            if (isStreaming && client) {
              streamMessages();
            }
          }, 5000);
        }
      }
    };

    streamMessages();
    
    return () => {
      console.log('XMTP: Stopping message stream...');
      isStreaming = false;
    };
  }, [client]);

  const manualSync = async () => {
    if (!client) {
      console.error('XMTP client not connected.');
      return;
    }
    try {
      console.log('XMTP: Starting manual sync...');
      await loadConversations(); // Reload conversations to reflect changes
      
      // Sync conversation states across browsers
      syncConversationStates();
      
      // Trigger history sync if available (XMTP V4 feature)
      if ('sync' in client && typeof client.sync === 'function') {
        console.log('XMTP: Triggering history sync...');
        await (client as any).sync();
      }
      
      console.log('XMTP: Manual sync completed.');
    } catch (err) {
      console.error('XMTP: Manual sync failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to perform manual sync');
      setTimeout(() => setError(null), 3000);
    }
  };

  const canMessage = async (walletAddress: string): Promise<boolean> => {
    if (!client) {
      console.error('XMTP client not connected.');
      return false;
    }
    try {
      console.log('XMTP: Checking if wallet is reachable:', walletAddress);
      const response = await Client.canMessage([{
        identifier: walletAddress,
        identifierKind: "Ethereum"
      }]);
      const isReachable = response.get(walletAddress);
      console.log('XMTP: Can message check result:', {
        walletAddress,
        isReachable
      });
      return isReachable || false;
    } catch (err) {
      console.error('XMTP: Error checking canMessage:', err);
      return false;
    }
  };

  const getCurrentInboxId = async (): Promise<string | null> => {
    if (!client) {
      console.error('XMTP client not connected.');
      return null;
    }
    try {
      // Get the current user's inbox ID from the client
      const inboxId = client.inboxId;
      console.log('XMTP: Current inbox ID:', inboxId);
      return inboxId || null;
    } catch (err) {
      console.error('XMTP: Error getting current inbox ID:', err);
      return null;
    }
  };


  // Clean up stale localStorage entries
  const cleanupStaleGroups = () => {
    try {
      const groups = JSON.parse(localStorage.getItem('xmtp-groups') || '[]');
      const validConversationIds = conversations.map(c => c.id);
      
      // Remove groups that don't correspond to actual conversations
      const cleanedGroups = groups.filter((group: any) => 
        validConversationIds.includes(group.id)
      );
      
      if (cleanedGroups.length !== groups.length) {
        console.log('XMTP: Cleaned up stale group entries:', groups.length - cleanedGroups.length);
        localStorage.setItem('xmtp-groups', JSON.stringify(cleanedGroups));
      }
    } catch (err) {
      console.error('XMTP: Error cleaning up stale groups:', err);
    }
  };

  // Sync optimistic groups when members become available
  const syncOptimisticGroups = async () => {
    if (!client) return;

    try {
      // First clean up stale entries
      cleanupStaleGroups();
      
      const groups = JSON.parse(localStorage.getItem('xmtp-groups') || '[]');
      const optimisticGroups = groups.filter((group: any) => group.isOptimistic);

      for (const group of optimisticGroups) {
        // Check if any members are now reachable
        const canMessageResults = await Promise.all(
          group.members.map(async (member: string) => {
            try {
              const result = await Client.canMessage([{
                identifier: member,
                identifierKind: "Ethereum"
              }]);
              return { member, canMessage: result.get(member) };
            } catch (err) {
              return { member, canMessage: false };
            }
          })
        );

        const reachableMembers = canMessageResults
          .filter(result => result.canMessage)
          .map(result => result.member);

        if (reachableMembers.length > 0) {
          console.log('XMTP: Syncing optimistic group:', group.id, 'with members:', reachableMembers);
          
          // Find the conversation and add members
          const conversation = conversations.find(c => c.id === group.id);
          if (conversation && conversation.constructor.name === 'Group') {
            try {
              // Add members to the group
              await (conversation as any).addMembers(reachableMembers);
              
              // Publish any prepared messages to the network
              await (conversation as any).publishMessages();
              
              // Update group metadata
              group.isOptimistic = false;
              group.members = reachableMembers;
              localStorage.setItem('xmtp-groups', JSON.stringify(groups));
              
              console.log('XMTP: Successfully synced optimistic group to network:', group.id);
              
              // Reload conversations to reflect the changes
              await loadConversations();
            } catch (syncError) {
              console.error('XMTP: Error syncing group to network:', syncError);
            }
          }
        }
      }
    } catch (err) {
      console.error('XMTP: Error syncing optimistic groups:', err);
    }
  };

  // Save conversation states to localStorage for cross-browser sync
  const saveConversationStates = (states: { [conversationId: string]: ConversationMetadata }) => {
    try {
      const walletAddress = client?.accountIdentifier?.identifier;
      if (walletAddress) {
        const storageKey = `xmtp-conversation-states-${walletAddress.toLowerCase()}`;
        localStorage.setItem(storageKey, JSON.stringify(states));
        console.log('XMTP: Saved conversation states to localStorage');
      }
    } catch (err) {
      console.error('XMTP: Error saving conversation states:', err);
    }
  };

  // Load conversation states from localStorage for cross-browser sync
  const loadConversationStates = () => {
    try {
      const walletAddress = client?.accountIdentifier?.identifier;
      if (walletAddress) {
        const storageKey = `xmtp-conversation-states-${walletAddress.toLowerCase()}`;
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          const states = JSON.parse(stored);
          // Convert date strings back to Date objects
          const convertedStates: { [conversationId: string]: ConversationMetadata } = {};
          Object.entries(states).forEach(([id, metadata]: [string, any]) => {
            convertedStates[id] = {
              ...metadata,
              hiddenAt: metadata.hiddenAt ? new Date(metadata.hiddenAt) : undefined,
              archivedAt: metadata.archivedAt ? new Date(metadata.archivedAt) : undefined
            };
          });
          setConversationStates(convertedStates);
          console.log('XMTP: Loaded conversation states from localStorage');
          return convertedStates;
        }
      }
    } catch (err) {
      console.error('XMTP: Error loading conversation states:', err);
    }
    return {};
  };

  // Conversation management functions with cross-browser sync
  const hideConversation = (conversationId: string) => {
    setConversationStates(prev => {
      const newStates = {
        ...prev,
        [conversationId]: {
          state: 'hidden' as ConversationState,
          hiddenAt: new Date(),
          archivedAt: prev[conversationId]?.archivedAt
        }
      };
      saveConversationStates(newStates);
      return newStates;
    });
  };

  const unhideConversation = (conversationId: string) => {
    setConversationStates(prev => {
      const newStates = {
        ...prev,
        [conversationId]: {
          state: 'active' as ConversationState,
          hiddenAt: undefined,
          archivedAt: prev[conversationId]?.archivedAt
        }
      };
      saveConversationStates(newStates);
      return newStates;
    });
  };

  const archiveConversation = (conversationId: string) => {
    setConversationStates(prev => {
      const newStates = {
        ...prev,
        [conversationId]: {
          state: 'archived' as ConversationState,
          hiddenAt: prev[conversationId]?.hiddenAt,
          archivedAt: new Date()
        }
      };
      saveConversationStates(newStates);
      return newStates;
    });
  };

  const unarchiveConversation = (conversationId: string) => {
    setConversationStates(prev => {
      const newStates = {
        ...prev,
        [conversationId]: {
          state: 'active' as ConversationState,
          hiddenAt: prev[conversationId]?.hiddenAt,
          archivedAt: undefined
        }
      };
      saveConversationStates(newStates);
      return newStates;
    });
  };

  const getConversationsByState = (state: ConversationState): Conversation[] => {
    return conversations.filter(conversation => {
      const metadata = conversationStates[conversation.id];
      return metadata?.state === state;
    });
  };

  // Sync conversation states across browsers
  const syncConversationStates = () => {
    if (client) {
      console.log('XMTP: Syncing conversation states across browsers...');
      loadConversationStates();
    }
  };

  const value: XMTPContextType = {
    client,
    conversations,
    messages,
    conversationStates,
    isLoading,
    error,
    connect,
    disconnect,
    sendMessage,
    deleteMessage,
    deleteConversation,
    hideConversation,
    unhideConversation,
    archiveConversation,
    unarchiveConversation,
    getConversationsByState,
    loadConversations,
    loadMessages,
    createConversation,
    createGroupConversation,
    manualSync,
    canMessage,
    getCurrentInboxId,
    syncOptimisticGroups,
    syncConversationStates,
    cleanupExpiredInstallations,
    isConnected,
  };

  return (
    <XMTPContext.Provider value={value}>
      {children}
    </XMTPContext.Provider>
  );
}; 