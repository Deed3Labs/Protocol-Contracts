import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

interface WebSocketSubscription {
  address: string;
  chainIds?: number[];
  subscriptions?: string[];
}

interface UseWebSocketReturn {
  socket: Socket | null;
  isConnected: boolean;
  subscribe: (subscription: WebSocketSubscription) => void;
  unsubscribe: () => void;
}

/**
 * Hook to manage WebSocket connection for real-time updates
 */
export function useWebSocket(
  address: string | undefined,
  enabled: boolean = true
): UseWebSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const isConnectedRef = useRef<boolean>(false);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!enabled || !address) {
      // Disconnect if disabled or no address
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setIsConnected(false);
        isConnectedRef.current = false;
      }
      return;
    }

    // Create socket connection
    const socket = io(API_BASE_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    socketRef.current = socket;

    // What we subscribe to. Dropped 'nfts' (unused by the app) + 'prices' (the server's global
    // 15-min price updater already keeps prices warm) to cut redundant Alchemy compute-unit usage.
    const subPayload = {
      address,
      chainIds: [1, 8453, 100, 11155111], // Default chains
      subscriptions: ['balances', 'transactions'],
    };

    socket.on('connect', () => {
      console.log('[WebSocket] Connected');
      setIsConnected(true);
      isConnectedRef.current = true;
      // Don't start polling for a tab that's already in the background; visibilitychange resumes it.
      if (!document.hidden) socket.emit('subscribe', subPayload);
    });

    // Tab-visibility gating: when the tab is hidden, tell the server to stop polling for this
    // connection (keeps the socket alive but idle); resume + fetch fresh when it's visible again.
    // Cuts background-tab Alchemy usage to ~zero — important when several tabs are left open.
    const handleVisibility = () => {
      const s = socketRef.current;
      if (!s || !s.connected) return;
      if (document.hidden) s.emit('unsubscribe');
      else s.emit('subscribe', subPayload);
    };
    document.addEventListener('visibilitychange', handleVisibility);

    socket.on('disconnect', () => {
      console.log('[WebSocket] Disconnected');
      setIsConnected(false);
      isConnectedRef.current = false;
    });

    socket.on('connect_error', (error) => {
      console.error('[WebSocket] Connection error:', error);
    });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      isConnectedRef.current = false;
    };
  }, [enabled, address]);

  const subscribe = useCallback((subscription: WebSocketSubscription) => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('subscribe', subscription);
    }
  }, []);

  const unsubscribe = useCallback(() => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('unsubscribe');
    }
  }, []);

  return {
    socket: socketRef.current,
    isConnected,
    subscribe,
    unsubscribe,
  };
}
