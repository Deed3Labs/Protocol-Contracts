import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Client } from '@xmtp/browser-sdk';
import type { Conversation, DecodedMessage } from '@xmtp/browser-sdk';
import { ethers } from 'ethers';

interface XMTPContextType {
  client: Client | null;
  conversations: Conversation[];
  messages: { [conversationId: string]: DecodedMessage[] };
  isLoading: boolean;
  error: string | null;
  connect: (signer: ethers.Signer) => Promise<void>;
  disconnect: () => Promise<void>;
  resetConnection: () => Promise<void>;
  sendMessage: (conversationId: string, content: string) => Promise<void>;
  loadConversations: () => Promise<void>;
  loadMessages: (conversationId: string) => Promise<void>;
  loadMoreMessages: (conversationId: string) => Promise<void>;
  createConversation: (inboxId: string) => Promise<Conversation>;
  checkIdentityStatus: (address: string) => Promise<boolean>;
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [identityCache, setIdentityCache] = useState<{ [address: string]: boolean }>({});

  const connect = async (ethersSigner: ethers.Signer) => {
    // Prevent multiple connection attempts
    console.log('XMTP: Checking connection state:', { client: !!client, isConnected, isLoading });
    
    // If we're stuck in loading state, reset it
    if (isLoading && !client) {
      console.log('XMTP: Resetting stuck loading state');
      setIsLoading(false);
    }
    
    if (client || isConnected) {
      console.log('XMTP: Already connected, skipping');
      return;
    }

    try {
      console.log('XMTP: Starting connection process...');
      setIsLoading(true);
      setError(null);

      // Check if the wallet is on the correct network
      const network = await ethersSigner.provider?.getNetwork();
      if (!network) {
        throw new Error('Unable to get network information');
      }
      console.log('XMTP: Network detected:', network.chainId);

      // Create V3 compatible signer
      const address = await ethersSigner.getAddress();
      console.log('XMTP: Getting identifier for address:', address);
      
      const v3Signer = {
        type: "EOA" as const,
        getIdentifier: () => ({
          identifierKind: "Ethereum" as const,
          identifier: address,
        }),
        signMessage: async (message: string) => {
          console.log('XMTP: Signing message:', message.substring(0, 50) + '...');
          const signature = await ethersSigner.signMessage(message);
          console.log('XMTP: Message signed successfully, signature length:', signature.length);
          // Return the signature as a Uint8Array without encoding
          return new Uint8Array(Buffer.from(signature.slice(2), 'hex'));
        },
      };

      console.log('XMTP: V3 signer created successfully');

      console.log('XMTP: Creating V3 client...');
      // Create client with production environment and proper options
      const xmtpClient = await Client.create(v3Signer, {
        env: 'production',
        dbEncryptionKey: undefined, // Not used in browser environments
      });
      console.log('XMTP: Client created successfully');

      console.log('XMTP: Client created successfully');
      setClient(xmtpClient as Client);
      setIsConnected(true);
      
      // Load conversations after connecting
      console.log('XMTP: Loading conversations...');
      await loadConversations();
      console.log('XMTP: Connection complete');
    } catch (err) {
      console.error('Failed to connect to XMTP:', err);
      
      // Handle specific IndexedDB errors
      if (err instanceof Error) {
        if (err.message.includes('NoModificationAllowedError') || 
            err.message.includes('Database(NotFound)')) {
          console.log('XMTP: IndexedDB access issue, trying to recover...');
          // Try to close any existing connections and retry
          try {
            if (client) {
              await (client as any).close();
            }
          } catch (closeErr) {
            console.log('XMTP: Error closing client:', closeErr);
          }
        }
      }
      
      setError(err instanceof Error ? err.message : 'Failed to connect to XMTP');
      // Auto-dismiss error after 3 seconds
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const disconnect = async () => {
    console.log('XMTP: Disconnecting and clearing local storage...');
    
    // Clear the client's local storage to remove cached conversations
    if (client) {
      try {
        console.log('XMTP: Clearing client local storage...');
        await client.close();
        console.log('XMTP: Client closed successfully');
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
    // Clear identity cache when disconnecting
    setIdentityCache({});
  };

  const resetConnection = async () => {
    console.log('XMTP: Resetting connection state and clearing local storage...');
    
    // Clear the client's local storage to remove cached conversations
    if (client) {
      try {
        console.log('XMTP: Clearing client local storage during reset...');
        await client.close();
        console.log('XMTP: Client closed successfully during reset');
      } catch (err) {
        console.error('XMTP: Error closing client during reset:', err);
      }
    }
    
    setClient(null);
    setConversations([]);
    setMessages({});
    setIsConnected(false);
    setIsLoading(false);
    setError(null);
    // Clear identity cache when resetting
    setIdentityCache({});
  };

  const checkIdentityStatus = async (address: string): Promise<boolean> => {
    console.log('XMTP Context: Checking identity status for:', address);
    
    // Check cache first
    if (identityCache.hasOwnProperty(address)) {
      console.log('XMTP Context: Found cached result for:', address, '=', identityCache[address]);
      return identityCache[address];
    }

    // Check if we already have conversations with this specific address
    // Note: In V3, we need to determine if a conversation is with a specific address
    // For now, we'll use the network check as the primary method
    console.log('XMTP Context: No cached result, will check network for:', address);

    try {
      console.log('XMTP Context: No cache found, checking network for:', address);
      const identifiers = [{ identifier: address, identifierKind: "Ethereum" as const }];
      const canMessage = await Client.canMessage(identifiers);
      const isReachable = canMessage.get(address);
      
      console.log('XMTP Context: Network check result for:', address, '=', isReachable);
      
      // Cache the result
      setIdentityCache(prev => ({
        ...prev,
        [address]: isReachable || false
      }));
      
      return isReachable || false;
    } catch (err) {
      console.error('Error checking identity status:', err);
      return false;
    }
  };

  const loadConversations = async () => {
    if (!client) return;

    try {
      setIsLoading(true);
      console.log('XMTP: Starting comprehensive sync...');
      
      // Use syncAll() for comprehensive initial sync to ensure all conversations are up-to-date
      console.log('XMTP: Syncing all conversations...');
      await client.conversations.syncAll();
      console.log('XMTP: Sync completed successfully');
      
      // Additional sync to ensure we get all messages
      console.log('XMTP: Performing additional sync to ensure message delivery...');
      await client.conversations.syncAll();
      console.log('XMTP: Additional sync completed');
      
      console.log('XMTP: Loading conversations...');
      const conversationsList = await client.conversations.list();
      console.log('XMTP: Found', conversationsList.length, 'conversations');
      
      // Remove duplicates by using a Map with conversation ID as key
      const uniqueConversations = new Map();
      conversationsList.forEach(conversation => {
        uniqueConversations.set(conversation.id, conversation);
      });
      
      console.log('XMTP: After deduplication, have', uniqueConversations.size, 'conversations');
      
      // For now, accept all conversations without validation to avoid issues
      const validConversations = Array.from(uniqueConversations.values());
      
      console.log('XMTP: Setting', validConversations.length, 'conversations');
      setConversations(validConversations);
      
      // Auto-load messages for each conversation to ensure they're synced
      console.log('XMTP: Auto-loading messages for all conversations...');
      for (const conversation of validConversations) {
        try {
          console.log(`XMTP: Auto-syncing conversation ${conversation.id}...`);
          await conversation.sync();
          const messages = await conversation.messages({ limit: BigInt(10) });
          console.log(`XMTP: Auto-loaded ${messages.length} messages for conversation ${conversation.id}`);
          
          if (messages.length > 0) {
            setMessages(prev => ({
              ...prev,
              [conversation.id]: messages as any[]
            }));
          }
        } catch (err) {
          console.error(`XMTP: Error auto-syncing conversation ${conversation.id}:`, err);
        }
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
      // Auto-dismiss error after 3 seconds
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMessages = async (conversationId: string, limit: bigint = BigInt(50)) => {
    if (!client) return;

    try {
      setIsLoading(true);
      const conversation = conversations.find(c => c.id === conversationId);
      if (!conversation) {
        // Remove invalid conversation from state
        setConversations(prev => prev.filter(c => c.id !== conversationId));
        setError('Conversation not found - removed from list');
        // Auto-dismiss error after 3 seconds
        setTimeout(() => setError(null), 3000);
        return;
      }

      // Sync this specific conversation first to ensure we have the latest messages
      console.log(`XMTP: Syncing conversation ${conversationId}...`);
      await conversation.sync();
      console.log(`XMTP: Conversation sync completed for ${conversationId}`);

      // Force an additional sync to ensure we get all messages
      console.log(`XMTP: Performing additional sync for conversation ${conversationId}...`);
      await conversation.sync();
      console.log(`XMTP: Additional sync completed for ${conversationId}`);

      // Load messages with pagination support
      const messagesList = await conversation.messages({ limit });
      console.log(`XMTP: Loaded ${messagesList.length} messages for conversation ${conversationId}`);
      
      setMessages(prev => ({
        ...prev,
        [conversationId]: messagesList as any[]
      }));
    } catch (err) {
      console.error('Failed to load messages:', err);
      // Remove invalid conversation from state
      setConversations(prev => prev.filter(c => c.id !== conversationId));
      setError('Conversation not found - removed from list');
      // Auto-dismiss error after 3 seconds
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMoreMessages = async (conversationId: string, limit: bigint = BigInt(20)) => {
    if (!client) return;

    try {
      const conversation = conversations.find(c => c.id === conversationId);
      if (!conversation) {
        console.error('Conversation not found for loading more messages');
        return;
      }

      // Sync conversation before loading more messages to ensure we have the latest
      console.log(`XMTP: Syncing conversation ${conversationId} before loading more messages...`);
      await conversation.sync();

      // Load more messages with specified limit
      const allMessages = await conversation.messages({ limit });
      console.log(`XMTP: Loaded ${allMessages.length} total messages for conversation ${conversationId}`);
      
      if (allMessages.length > 0) {
        setMessages(prev => ({
          ...prev,
          [conversationId]: allMessages as any[]
        }));
      }
    } catch (err) {
      console.error('Failed to load more messages:', err);
    }
  };

  const sendMessage = async (conversationId: string, content: string) => {
    if (!client) return;

    try {
      setIsLoading(true);
      console.log('XMTP: Attempting to send message to conversation:', conversationId);
      console.log('XMTP: Available conversations:', conversations.map(c => c.id));
      
      const conversation = conversations.find(c => c.id === conversationId);
      if (!conversation) {
        console.error('XMTP: Conversation not found in state. Available conversations:', conversations.map(c => c.id));
        throw new Error('Conversation not found');
      }

      console.log('XMTP: Found conversation, sending message...');
      await conversation.send(content);
      console.log('XMTP: Message sent successfully');
      
      // Reload messages for this conversation
      await loadMessages(conversationId);
    } catch (err) {
      console.error('Failed to send message:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
      // Auto-dismiss error after 3 seconds
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const createConversation = async (inboxId: string): Promise<Conversation> => {
    if (!client) {
      throw new Error('XMTP client not connected');
    }

    try {
      console.log('XMTP: Creating conversation with inbox ID:', inboxId);
      
      // Check if we already have a conversation with this inbox ID
      const existingConversation = conversations.find(() => {
        // In V3, we need to check if this conversation is with the same inbox
        // For now, we'll create a new conversation each time
        return false;
      });
      
      if (existingConversation) {
        console.log('XMTP: Found existing conversation:', existingConversation.id);
        return existingConversation;
      }
      
      // Create a new DM conversation
      console.log('XMTP: Creating new DM conversation...');
      const conversation = await client.conversations.newDm(inboxId);
      console.log('XMTP: Conversation created successfully:', conversation.id);
      
      // Since conversation was created successfully, the identity exists
      console.log('XMTP: Updating identity cache - identity exists for:', inboxId);
      setIdentityCache(prev => ({
        ...prev,
        [inboxId]: true
      }));
      
      // Add to conversations list if not already present
      setConversations(prev => {
        const exists = prev.find(c => c.id === conversation.id);
        if (!exists) {
          console.log('XMTP: Adding conversation to list:', conversation.id);
          const newConversations = [...prev, conversation];
          console.log('XMTP: Updated conversations list:', newConversations.map(c => c.id));
          return newConversations;
        } else {
          console.log('XMTP: Conversation already exists in list:', conversation.id);
          return prev;
        }
      });
      
      return conversation;
    } catch (err) {
      console.error('Failed to create conversation:', err);
      throw err;
    }
  };

  // Set up message streaming with better error handling and reconnection
  useEffect(() => {
    if (!client) return;

    let isStreaming = true;

    const streamMessages = async () => {
      try {
        console.log('XMTP: Starting message stream...');
        for await (const message of await client.conversations.streamAllMessages()) {
          if (!isStreaming) break; // Stop streaming if component unmounted
          
          const conversationId = message.conversationId;
          console.log('XMTP: Received new message for conversation:', conversationId);
          
          setMessages(prev => ({
            ...prev,
            [conversationId]: [...(prev[conversationId] || []), message as any]
          }));
        }
      } catch (err) {
        console.error('Error streaming messages:', err);
        // Auto-reconnect after a delay if streaming fails
        if (isStreaming) {
          console.log('XMTP: Attempting to reconnect stream in 5 seconds...');
          setTimeout(() => {
            if (isStreaming && client) {
              streamMessages();
            }
          }, 5000);
        }
      }
    };

    // Also set up a periodic sync to catch any missed messages
    const periodicSync = async () => {
      if (!isStreaming || !client) return;
      
      try {
        console.log('XMTP: Performing periodic sync...');
        await client.conversations.syncAll();
        
        // Reload conversations to catch any new ones
        const conversationsList = await client.conversations.list();
        setConversations(prev => {
          const newConversations = conversationsList.filter(
            newConv => !prev.find(existingConv => existingConv.id === newConv.id)
          );
          if (newConversations.length > 0) {
            console.log('XMTP: Found', newConversations.length, 'new conversations during periodic sync');
            return [...prev, ...newConversations];
          }
          return prev;
        });
      } catch (err) {
        console.error('XMTP: Error during periodic sync:', err);
      }
    };

    streamMessages();
    
    // Perform initial sync immediately, then set up periodic sync every 30 seconds
    periodicSync(); // Immediate first sync
    const syncInterval = setInterval(periodicSync, 30000);

    // Cleanup function to stop streaming when component unmounts
    return () => {
      console.log('XMTP: Stopping message stream and periodic sync...');
      isStreaming = false;
      clearInterval(syncInterval);
    };
  }, [client]);

  const value: XMTPContextType = {
    client,
    conversations,
    messages,
    isLoading,
    error,
    connect,
    disconnect,
    resetConnection,
    sendMessage,
    loadConversations,
    loadMessages,
    loadMoreMessages,
    createConversation,
    checkIdentityStatus,
    isConnected,
  };

  return (
    <XMTPContext.Provider value={value}>
      {children}
    </XMTPContext.Provider>
  );
}; 