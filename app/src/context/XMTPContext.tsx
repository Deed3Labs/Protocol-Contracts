import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Client } from '@xmtp/browser-sdk';
import type { Conversation, DecodedMessage, Signer } from '@xmtp/browser-sdk';
import { ethers } from 'ethers';

interface XMTPContextType {
  client: Client | null;
  conversations: Conversation[];
  messages: { [conversationId: string]: DecodedMessage[] };
  isLoading: boolean;
  error: string | null;
  connect: (signer: ethers.Signer) => Promise<void>;
  disconnect: () => Promise<void>;
  sendMessage: (conversationId: string, content: string) => Promise<void>;
  loadConversations: () => Promise<void>;
  loadMessages: (conversationId: string) => Promise<void>;
  createConversation: (walletAddress: string) => Promise<Conversation>;
  manualSync: () => Promise<void>;
  canMessage: (walletAddress: string) => Promise<boolean>;
  getCurrentInboxId: () => Promise<string | null>;
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

  // Create XMTP signer from ethers signer
  const createXMTPSigner = (ethersSigner: ethers.Signer): Signer => {
    return {
      type: "EOA",
      getIdentifier: async () => {
        const address = await ethersSigner.getAddress();
        return {
          identifier: address,
          identifierKind: "Ethereum"
        };
      },
      signMessage: async (message: string): Promise<Uint8Array> => {
        const signature = await ethersSigner.signMessage(message);
        // Convert hex string to Uint8Array
        return new Uint8Array(Buffer.from(signature.slice(2), 'hex'));
      }
    };
  };

  // Create XMTP client following V4 patterns
  const connect = async (ethersSigner: ethers.Signer) => {
    try {
      console.log('XMTP: Creating client...');
      setIsLoading(true);
      setError(null);

      // Create XMTP signer from ethers signer
      const xmtpSigner = createXMTPSigner(ethersSigner);
      
      // Create XMTP client with the signer
      const xmtpClient = await Client.create(xmtpSigner);
      console.log('XMTP: Client created successfully');

      setClient(xmtpClient);
      setIsConnected(true);
      
      // Load conversations after connecting
      await loadConversations();
      console.log('XMTP: Connection complete');
    } catch (err) {
      console.error('Failed to connect to XMTP:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect to XMTP');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
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
        console.log(`XMTP: Conversation ${index + 1}:`, {
          id: conv.id,
          type: 'DM'
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

  const value: XMTPContextType = {
    client,
    conversations,
    messages,
    isLoading,
    error,
    connect,
    disconnect,
    sendMessage,
    loadConversations,
    loadMessages,
    createConversation,
    manualSync,
    canMessage,
    getCurrentInboxId,
    isConnected,
  };

  return (
    <XMTPContext.Provider value={value}>
      {children}
    </XMTPContext.Provider>
  );
}; 