import { ethers } from 'ethers';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { websocketService } from './websocketService.js';
import { getRpcUrl, getAlchemyWebSocketUrl, isAlchemyWebSocketSupported } from '../utils/rpc.js';
import { createRetryProvider } from '../utils/rpcRetry.js';
import { getContractAddress } from '../config/contracts.js';

/** Polling interval for HTTP getLogs fallback (no eth_getFilterChanges). 2 min = ~1 eth_getLogs per chain per 2 min. */
const HTTP_GETLOGS_POLL_INTERVAL_MS = 2 * 60 * 1000;

/** Block range to query on first run for HTTP fallback (avoid full history). */
const HTTP_GETLOGS_INITIAL_BLOCKS = 200;

/**
 * Service to listen for blockchain events and trigger real-time updates.
 * Uses Alchemy WebSocket (eth_subscribe) for supported chains to avoid eth_getFilterChanges;
 * uses HTTP getLogs polling for other chains (no eth_newFilter/eth_getFilterChanges).
 * @see https://www.alchemy.com/docs/reference/subscription-api
 * @see app/docs/ALCHEMY_COMPUTE_UNIT_ANALYSIS.md
 */
class EventListenerService {
  private providers: Map<number, ethers.JsonRpcProvider | ethers.WebSocketProvider> = new Map();
  private httpPollIntervals: Map<number, ReturnType<typeof setInterval>> = new Map();
  private lastProcessedBlock: Map<number, number> = new Map();
  private isRunning = false;
  private restartTimeouts: Map<number, number> = new Map();

  private readonly SUPPORTED_CHAINS = [1, 10, 8453, 100, 11155111, 84532, 42161, 137];

  async initialize() {
    if (this.isRunning) {
      console.log('[EventListener] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[EventListener] Initializing blockchain event listeners (WebSocket where supported, getLogs polling otherwise)...');

    for (const chainId of this.SUPPORTED_CHAINS) {
      await this.initChain(chainId);
    }

    console.log('[EventListener] Event listeners initialized');
  }

  private async initChain(chainId: number) {
    try {
      const protocolContracts = this.getProtocolContracts(chainId);
      if (protocolContracts.size === 0) {
        console.warn(`[EventListener] No protocol contracts for chain ${chainId}, skipping`);
        return;
      }

      const wssUrl = getAlchemyWebSocketUrl(chainId);
      const useWebSocket = isAlchemyWebSocketSupported(chainId) && wssUrl;

      if (useWebSocket && wssUrl) {
        await this.initChainWebSocket(chainId, wssUrl, protocolContracts);
      } else {
        this.initChainHttpPolling(chainId, protocolContracts);
      }
    } catch (error) {
      console.error(`[EventListener] Failed to initialize chain ${chainId}:`, error);
      this.scheduleRestart(chainId);
    }
  }

  private getProtocolContracts(chainId: number): Set<string> {
    const protocolContracts = new Set<string>();
    const deedNFT = getContractAddress(chainId, 'DeedNFT');
    if (deedNFT) protocolContracts.add(deedNFT.toLowerCase());
    return protocolContracts;
  }

  /**
   * Use WebSocket + eth_subscribe for chains where Alchemy supports it.
   * Avoids eth_getFilterChanges and eth_blockNumber polling.
   */
  private async initChainWebSocket(
    chainId: number,
    wssUrl: string,
    protocolContracts: Set<string>
  ) {
    const provider = new ethers.WebSocketProvider(wssUrl);

    provider.on('error', (error) => {
      console.error(`[EventListener] WebSocket error on chain ${chainId}:`, error.message);
      if (error.message.includes('timeout') || error.message.includes('400') || error.message.includes('ECONNRESET')) {
        this.scheduleRestart(chainId);
      }
    });

    this.providers.set(chainId, provider);

    const transferTopic = ethers.id('Transfer(address,address,uint256)');
    const filter = {
      topics: [transferTopic],
      address: Array.from(protocolContracts),
    };

    console.log(`[EventListener] WebSocket (eth_subscribe) Transfer listener for chain ${chainId}`);

    provider.on(filter, async (log) => {
      await this.processTransferLog(chainId, log);
    });
  }

  /**
   * Use HTTP getLogs polling for chains where Alchemy WebSocket subscriptions are not used.
   * One eth_getLogs (+ optional eth_blockNumber) per poll interval instead of many eth_getFilterChanges.
   */
  private initChainHttpPolling(chainId: number, protocolContracts: Set<string>) {
    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) {
      console.warn(`[EventListener] No RPC URL for chain ${chainId}, skipping`);
      return;
    }

    const provider = createRetryProvider(rpcUrl, chainId);

    provider.on('error', (error) => {
      console.error(`[EventListener] Provider error on chain ${chainId}:`, error.message);
      if (error.message.includes('timeout') || error.message.includes('400')) {
        this.scheduleRestart(chainId);
      }
    });

    this.providers.set(chainId, provider);

    const transferTopic = ethers.id('Transfer(address,address,uint256)');
    const addressList = Array.from(protocolContracts);

    const poll = async () => {
      try {
        const currentBlockBn = await provider.getBlockNumber();
        if (currentBlockBn === null || currentBlockBn === undefined) return;
        const currentBlock = Number(currentBlockBn);

        let fromBlock: number;
        if (!this.lastProcessedBlock.has(chainId)) {
          fromBlock = Math.max(0, currentBlock - HTTP_GETLOGS_INITIAL_BLOCKS);
        } else {
          fromBlock = this.lastProcessedBlock.get(chainId)! + 1;
        }

        if (fromBlock > currentBlock) {
          this.lastProcessedBlock.set(chainId, currentBlock);
          return;
        }

        const logs = await provider.getLogs({
          address: addressList.length === 1 ? addressList[0] : addressList,
          topics: [transferTopic],
          fromBlock,
          toBlock: currentBlock,
        });

        for (const log of logs) {
          await this.processTransferLog(chainId, log);
        }

        this.lastProcessedBlock.set(chainId, currentBlock);
      } catch (error) {
        console.error(`[EventListener] getLogs poll error on chain ${chainId}:`, error);
      }
    };

    const intervalId = setInterval(poll, HTTP_GETLOGS_POLL_INTERVAL_MS);
    this.httpPollIntervals.set(chainId, intervalId);

    console.log(`[EventListener] HTTP getLogs polling (every ${HTTP_GETLOGS_POLL_INTERVAL_MS / 1000}s) for chain ${chainId}`);

    poll().catch((err) => console.error(`[EventListener] Initial getLogs for chain ${chainId}:`, err));
  }

  private async processTransferLog(chainId: number, log: ethers.Log) {
    try {
      if (!log.topics?.[1] || !log.topics?.[2]) return;

      const fromLower = ethers.dataSlice(log.topics[1], 12).toLowerCase();
      const toLower = ethers.dataSlice(log.topics[2], 12).toLowerCase();

      const from = ethers.getAddress(fromLower);
      const to = ethers.getAddress(toLower);

      await this.invalidateCacheForAddress(chainId, from);
      await this.invalidateCacheForAddress(chainId, to);

      await websocketService.broadcastToAddress(from, 'balance_update', {
        chainId,
        address: from,
        timestamp: Date.now(),
      });

      await websocketService.broadcastToAddress(to, 'balance_update', {
        chainId,
        address: to,
        timestamp: Date.now(),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        !error.message.includes('data out-of-bounds') &&
        !error.message.includes('BUFFER_OVERRUN')
      ) {
        console.warn(`[EventListener] Error processing Transfer on chain ${chainId}:`, error.message);
      }
    }
  }

  private scheduleRestart(chainId: number) {
    if (!this.isRunning) return;

    if (this.restartTimeouts.has(chainId)) {
      clearTimeout(this.restartTimeouts.get(chainId));
    }

    const intervalId = this.httpPollIntervals.get(chainId);
    if (intervalId) {
      clearInterval(intervalId);
      this.httpPollIntervals.delete(chainId);
    }

    const provider = this.providers.get(chainId);
    if (provider) {
      try {
        provider.removeAllListeners();
        if ('destroy' in provider && typeof provider.destroy === 'function') {
          provider.destroy();
        }
      } catch (_) {
        // ignore
      }
      this.providers.delete(chainId);
    }
    this.lastProcessedBlock.delete(chainId);

    console.log(`[EventListener] Scheduling restart for chain ${chainId} in 10s...`);
    const timeout = setTimeout(() => {
      this.restartTimeouts.delete(chainId);
      this.initChain(chainId);
    }, 10000);
    this.restartTimeouts.set(chainId, timeout as unknown as number);
  }

  private async invalidateCacheForAddress(chainId: number, address: string) {
    try {
      const cacheService = await getRedisClient().then((client) => new CacheService(client));

      const balanceKey = CacheKeys.balance(chainId, address.toLowerCase());
      await cacheService.del(balanceKey);

      const nftKey = CacheKeys.nftList(chainId, address.toLowerCase());
      await cacheService.del(nftKey);

      const txKey = CacheKeys.transactions(chainId, address.toLowerCase(), 20);
      await cacheService.del(txKey);

      console.log(`[EventListener] Cache invalidated for ${address} on chain ${chainId}`);
    } catch (error) {
      console.error(`[EventListener] Error invalidating cache:`, error);
    }
  }

  cleanup() {
    this.isRunning = false;

    for (const timeout of this.restartTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.restartTimeouts.clear();

    for (const intervalId of this.httpPollIntervals.values()) {
      clearInterval(intervalId);
    }
    this.httpPollIntervals.clear();
    this.lastProcessedBlock.clear();

    for (const [chainId, provider] of this.providers.entries()) {
      try {
        provider.removeAllListeners();
        if ('destroy' in provider && typeof (provider as ethers.WebSocketProvider).destroy === 'function') {
          (provider as ethers.WebSocketProvider).destroy();
        }
        console.log(`[EventListener] Removed listeners for chain ${chainId}`);
      } catch (error) {
        console.error(`[EventListener] Error removing listeners for chain ${chainId}:`, error);
      }
    }
    this.providers.clear();
  }
}

export const eventListenerService = new EventListenerService();
