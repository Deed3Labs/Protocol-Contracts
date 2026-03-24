import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const rpcUrl = process.env.RPC_URL || "";
const chainIdExpected = BigInt(process.env.CLEAR_CHAIN_ID || "92373");
const faucetKey = process.env.FAUCET_PRIVATE_KEY || "";
const dripAmountEth = process.env.FAUCET_DRIP_AMOUNT_ETH || "0.01";
const cooldownSeconds = Number.parseInt(process.env.FAUCET_COOLDOWN_SECONDS || "86400", 10);
const port = Number.parseInt(process.env.PORT || process.env.SERVICES_PORT || "8080", 10);
const host = "0.0.0.0";
const blockscoutHostRaw =
  process.env.BLOCKSCOUT_API_HOST ||
  process.env.RAILWAY_SERVICE_CLEAR_TESTNET_BLOCKSCOUT_URL ||
  "clear-testnet-blockscout-production.up.railway.app";
const blockscoutProtocol = process.env.BLOCKSCOUT_API_PROTOCOL || "https";
const blockscoutHost = blockscoutHostRaw.replace(/^https?:\/\//u, "").replace(/\/.*$/u, "");
const blockscoutPort = Number.parseInt(
  process.env.BLOCKSCOUT_API_PORT || (blockscoutProtocol === "https" ? "443" : "80"),
  10,
);

if (!rpcUrl) throw new Error("Missing RPC_URL");
if (!/^0x[0-9a-fA-F]{64}$/.test(faucetKey)) {
  throw new Error("Invalid FAUCET_PRIVATE_KEY");
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(faucetKey, provider);
const dripWei = ethers.parseEther(dripAmountEth);
const cooldownByAddress = new Map();

const bridgeConfig = {
  chainName: process.env.CLEAR_CHAIN_NAME || "Clear Testnet",
  chainId: Number.parseInt(process.env.CLEAR_CHAIN_ID || "92373", 10),
  l1ChainId: Number.parseInt(process.env.CLEAR_L1_CHAIN_ID || "11155111", 10),
  rpcUrl: process.env.PUBLIC_RPC_URL || rpcUrl,
  explorerUrl: process.env.PUBLIC_EXPLORER_URL || "/explorer",
  faucetUrl: process.env.PUBLIC_FAUCET_URL || "/faucet",
  contracts: {
    optimismPortalProxy: process.env.OPTIMISM_PORTAL_PROXY || "",
    l1StandardBridgeProxy: process.env.L1_STANDARD_BRIDGE_PROXY || "",
    l1CrossDomainMessengerProxy: process.env.L1_CROSS_DOMAIN_MESSENGER_PROXY || "",
    l1Erc721BridgeProxy: process.env.L1_ERC721_BRIDGE_PROXY || "",
    systemConfigProxy: process.env.SYSTEM_CONFIG_PROXY || "",
  },
};

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);
const NFT_TOKEN_TYPES = new Set(["ERC-721", "ERC-1155", "ERC-404"]);
const TOKEN_HOLDER_COUNT_CACHE_TTL_MS = 30_000;
const tokenHolderCountCache = new Map();
const TOKEN_REBUILD_CACHE_TTL_MS = 30_000;
const ADDRESS_REBUILD_CACHE_TTL_MS = 30_000;
const TRANSFER_EVENT_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const tokenRebuildCache = new Map();
const addressTransfersRebuildCache = new Map();

function json(res, code, payload) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(payload));
}

function text(res, code, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(code, {
    "content-type": contentType,
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

function explorerHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clear Explorer Lite</title></head><body style="font-family:ui-sans-serif,system-ui;padding:20px"><h1>Clear Explorer Lite</h1><p><a href="/bridge">Bridge UI</a> | <a href="/faucet">Faucet UI</a></p><pre id="out">Loading...</pre><script>fetch('/api/explorer/latest').then(r=>r.json()).then(j=>document.getElementById('out').textContent=JSON.stringify(j,null,2)).catch(e=>document.getElementById('out').textContent=String(e))</script></body></html>`;
}

function faucetHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clear Faucet</title></head><body style="font-family:ui-sans-serif,system-ui;padding:20px"><h1>Clear Faucet</h1><p>Drip amount: ${dripAmountEth} ETH</p><input id="a" placeholder="0x..." style="width:100%;max-width:560px"><button onclick="go()">Request</button><pre id="o"></pre><script>async function go(){const r=await fetch('/faucet/drip',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address:document.getElementById('a').value.trim()})});document.getElementById('o').textContent=JSON.stringify(await r.json(),null,2)}</script></body></html>`;
}

function bridgeHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clear Bridge UI</title></head><body style="font-family:ui-sans-serif,system-ui;padding:20px"><h1>Clear Bridge UI</h1><pre id="cfg">Loading...</pre><script>fetch('/bridge-config.json').then(r=>r.json()).then(j=>document.getElementById('cfg').textContent=JSON.stringify(j,null,2))</script></body></html>`;
}

async function commonHealth() {
  const [network, blockNumber, faucetBalanceWei] = await Promise.all([
    provider.getNetwork(),
    provider.getBlockNumber(),
    provider.getBalance(wallet.address),
  ]);

  return {
    chainId: network.chainId.toString(),
    chainIdExpected: chainIdExpected.toString(),
    latestBlock: blockNumber,
    faucetAddress: wallet.address,
    faucetBalanceEth: ethers.formatEther(faucetBalanceWei),
    dripAmountEth,
    cooldownSeconds,
  };
}

async function bodyJson(req) {
  let raw = "";
  for await (const c of req) raw += c;
  if (!raw) return {};
  return JSON.parse(raw);
}

async function bodyBuffer(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function normalizeBlockscoutPayload(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeBlockscoutPayload);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = normalizeBlockscoutPayload(inner);
  }

  if (typeof out.address === "string" && !out.address_hash) {
    out.address_hash = out.address;
  }
  if (typeof out.transaction === "string" && !out.transaction_hash) {
    out.transaction_hash = out.transaction;
  }
  if (typeof out.block === "string" && !out.block_hash) {
    out.block_hash = out.block;
  }
  if (typeof out.user_operation === "string" && !out.user_operation_hash) {
    out.user_operation_hash = out.user_operation;
  }
  if (typeof out.blob === "string" && !out.blob_hash) {
    out.blob_hash = out.blob;
  }

  if (typeof out.hash === "string") {
    if (
      !out.address_hash &&
      ["address", "contract", "label", "metadata_tag", "token", "ens_domain"].includes(out.type)
    ) {
      out.address_hash = out.hash;
    }
    if (!out.transaction_hash && out.type === "transaction") {
      out.transaction_hash = out.hash;
    }
    if (!out.block_hash && out.type === "block") {
      out.block_hash = out.hash;
    }
    if (!out.blob_hash && out.type === "blob") {
      out.blob_hash = out.hash;
    }
    if (!out.user_operation_hash && out.type === "user_operation") {
      out.user_operation_hash = out.hash;
    }
  }

  if (typeof out.address_url === "string" && !out.url && out.type === "address") {
    out.url = out.address_url;
  }
  if (typeof out.token_url === "string" && !out.url && out.type === "token") {
    out.url = out.token_url;
  }
  if (typeof out.tx_url === "string" && !out.url && out.type === "transaction") {
    out.url = out.tx_url;
  }
  if (typeof out.block_url === "string" && !out.url && out.type === "block") {
    out.url = out.block_url;
  }

  return out;
}

function getForwardHeaders(req) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    const key = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(key)) {
      continue;
    }
    if (typeof value === "undefined") {
      continue;
    }
    headers[name] = value;
  }
  headers.host = blockscoutHost;
  headers["x-forwarded-host"] = req.headers.host || "";
  headers["x-forwarded-proto"] = "https";
  return headers;
}

function parseBigInt(value, fallback = 0n) {
  if (value === null || typeof value === "undefined" || value === "") {
    return fallback;
  }
  try {
    return BigInt(String(value));
  } catch {
    return fallback;
  }
}

function isNftTokenType(type) {
  return typeof type === "string" && NFT_TOKEN_TYPES.has(type);
}

function toUrlSearchPart(searchParams) {
  if (!searchParams) return "";
  const raw = searchParams instanceof URLSearchParams ? searchParams.toString() : new URLSearchParams(searchParams).toString();
  return raw ? `?${raw}` : "";
}

function getCachedTokenHolderCount(tokenAddress) {
  const key = tokenAddress.toLowerCase();
  const cached = tokenHolderCountCache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt < Date.now()) {
    tokenHolderCountCache.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedTokenHolderCount(tokenAddress, count) {
  tokenHolderCountCache.set(tokenAddress.toLowerCase(), {
    value: count,
    expiresAt: Date.now() + TOKEN_HOLDER_COUNT_CACHE_TTL_MS,
  });
}

function getCachedTokenRebuildData(tokenAddress) {
  const key = tokenAddress.toLowerCase();
  const cached = tokenRebuildCache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt < Date.now()) {
    tokenRebuildCache.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedTokenRebuildData(tokenAddress, value) {
  tokenRebuildCache.set(tokenAddress.toLowerCase(), {
    value,
    expiresAt: Date.now() + TOKEN_REBUILD_CACHE_TTL_MS,
  });
}

function getCachedAddressRebuildData(addressHash) {
  const key = addressHash.toLowerCase();
  const cached = addressTransfersRebuildCache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt < Date.now()) {
    addressTransfersRebuildCache.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedAddressRebuildData(addressHash, value) {
  addressTransfersRebuildCache.set(addressHash.toLowerCase(), {
    value,
    expiresAt: Date.now() + ADDRESS_REBUILD_CACHE_TTL_MS,
  });
}

async function fetchBlockscoutJson(req, pathname, searchParams) {
  const targetUrl = `${blockscoutProtocol}://${blockscoutHost}${pathname}${toUrlSearchPart(searchParams)}`;
  const response = await fetch(targetUrl, {
    method: "GET",
    headers: getForwardHeaders(req),
    redirect: "manual",
  });

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("application/json")) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toAddressTokenBalanceFromNft(nftItem) {
  if (!nftItem || typeof nftItem !== "object") {
    return null;
  }

  const { token, token_type, value, ...tokenInstance } = nftItem;
  if (!token || typeof token !== "object") {
    return null;
  }

  return {
    token,
    token_id: String(nftItem.id ?? ""),
    value: String(value ?? "1"),
    token_instance: tokenInstance,
  };
}

function toAddressCollectionFromNfts(nftItems) {
  const grouped = new Map();

  for (const item of nftItems) {
    if (!item || typeof item !== "object" || !item.token) {
      continue;
    }
    const tokenAddress = String(item.token.address_hash || item.token.address || "").toLowerCase();
    if (!tokenAddress) {
      continue;
    }

    const { token, ...tokenInstance } = item;
    const current = grouped.get(tokenAddress) || {
      token,
      amount: 0n,
      token_instances: [],
    };
    current.amount += parseBigInt(item.value, 1n);
    current.token_instances.push(tokenInstance);
    grouped.set(tokenAddress, current);
  }

  return Array.from(grouped.values()).map((item) => ({
    token: item.token,
    amount: item.amount.toString(),
    token_instances: item.token_instances,
  }));
}

function buildHoldersFromInstances(instances) {
  const grouped = new Map();

  for (const instance of instances) {
    const owner = instance?.owner;
    const ownerHash = owner?.hash;
    if (!owner || typeof ownerHash !== "string") {
      continue;
    }

    const key = ownerHash.toLowerCase();
    const current = grouped.get(key) || {
      address: owner,
      value: 0n,
    };
    const parsedValue = parseBigInt(instance?.value, 0n);
    current.value += parsedValue > 0n ? parsedValue : 1n;
    grouped.set(key, current);
  }

  return Array.from(grouped.values())
    .map((item) => ({
      address: item.address,
      value: item.value.toString(),
    }))
    .sort((a, b) => (parseBigInt(b.value) > parseBigInt(a.value) ? 1 : -1));
}

async function fetchAllTokenInstances(req, tokenAddress) {
  const allItems = [];
  let nextPageParams = null;
  let pageCount = 0;

  do {
    const params = new URLSearchParams();
    if (nextPageParams && typeof nextPageParams === "object") {
      for (const [key, value] of Object.entries(nextPageParams)) {
        if (value !== null && typeof value !== "undefined") {
          params.set(key, String(value));
        }
      }
    }

    const page = await fetchBlockscoutJson(req, `/api/v2/tokens/${tokenAddress}/instances`, params);
    if (!page || !Array.isArray(page.items)) {
      break;
    }

    allItems.push(...page.items);
    nextPageParams = page.next_page_params;
    pageCount += 1;
  } while (nextPageParams && pageCount < 20 && allItems.length < 2_000);

  return allItems;
}

async function getTokenRebuildData(req, tokenAddress) {
  const cached = getCachedTokenRebuildData(tokenAddress);
  if (cached) {
    return cached;
  }

  const instances = await fetchAllTokenInstances(req, tokenAddress);
  const holders = buildHoldersFromInstances(instances);
  const value = {
    instances,
    instancesCount: instances.length,
    holders,
    holdersCount: holders.length,
  };
  setCachedTokenRebuildData(tokenAddress, value);
  return value;
}

async function countTokenHoldersFromInstances(req, tokenAddress) {
  const rebuilt = getCachedTokenRebuildData(tokenAddress);
  if (rebuilt) {
    return rebuilt.holdersCount;
  }

  const cached = getCachedTokenHolderCount(tokenAddress);
  if (cached !== null) {
    return cached;
  }

  const tokenData = await getTokenRebuildData(req, tokenAddress);
  const holderCount = tokenData.holdersCount;
  setCachedTokenHolderCount(tokenAddress, holderCount);
  return holderCount;
}

async function getAddressNftRebuildData(req, addressHash) {
  const cached = getCachedAddressRebuildData(addressHash);
  if (cached) {
    return cached;
  }

  const [nft721, nft1155, nft404] = await Promise.all([
    fetchBlockscoutJson(req, `/api/v2/addresses/${addressHash}/nft`, new URLSearchParams({ type: "ERC-721" })),
    fetchBlockscoutJson(req, `/api/v2/addresses/${addressHash}/nft`, new URLSearchParams({ type: "ERC-1155" })),
    fetchBlockscoutJson(req, `/api/v2/addresses/${addressHash}/nft`, new URLSearchParams({ type: "ERC-404" })),
  ]);

  const value = {
    count721: Array.isArray(nft721?.items) ? nft721.items.length : 0,
    count1155: Array.isArray(nft1155?.items) ? nft1155.items.length : 0,
    count404: Array.isArray(nft404?.items) ? nft404.items.length : 0,
  };
  value.totalCount = value.count721 + value.count1155 + value.count404;

  setCachedAddressRebuildData(addressHash, value);
  return value;
}

async function maybePatchBlockscoutPayload(req, url, payload) {
  const path = url.pathname;

  const addressMatch = path.match(/^\/api\/v2\/addresses\/([^/]+)$/u);
  if (addressMatch && payload && typeof payload === "object") {
    const rebuilt = await getAddressNftRebuildData(req, addressMatch[1]);
    if (payload.has_tokens === false && rebuilt.totalCount > 0) {
      payload.has_tokens = true;
    }
    if (payload.has_token_transfers === false && rebuilt.totalCount > 0) {
      payload.has_token_transfers = true;
    }
  }

  const addressCountersMatch = path.match(/^\/api\/v2\/addresses\/([^/]+)\/counters$/u);
  if (addressCountersMatch && payload && typeof payload === "object") {
    if (String(payload.token_transfers_count || "0") === "0") {
      const rebuilt = await getAddressNftRebuildData(req, addressCountersMatch[1]);
      if (rebuilt.totalCount > 0) {
        payload.token_transfers_count = String(rebuilt.totalCount);
      }
    }
  }

  const addressTabsCountersMatch = path.match(/^\/api\/v2\/addresses\/([^/]+)\/tabs-counters$/u);
  if (addressTabsCountersMatch && payload && typeof payload === "object") {
    if (Number(payload.token_balances_count || 0) === 0 || Number(payload.token_transfers_count || 0) === 0) {
      const rebuilt = await getAddressNftRebuildData(req, addressTabsCountersMatch[1]);
      if (Number(payload.token_balances_count || 0) === 0 && rebuilt.totalCount > 0) {
        payload.token_balances_count = rebuilt.totalCount;
      }
      if (Number(payload.token_transfers_count || 0) === 0 && rebuilt.totalCount > 0) {
        payload.token_transfers_count = rebuilt.totalCount;
      }
    }
  }

  const tokenHoldersMatch = path.match(/^\/api\/v2\/tokens\/([^/]+)\/holders$/u);
  if (tokenHoldersMatch && payload && typeof payload === "object" && Array.isArray(payload.items) && payload.items.length === 0) {
    const rebuilt = await getTokenRebuildData(req, tokenHoldersMatch[1]);
    if (rebuilt.holders.length > 0) {
      setCachedTokenHolderCount(tokenHoldersMatch[1], rebuilt.holdersCount);
      payload = {
        items: rebuilt.holders,
        next_page_params: null,
      };
    }
  }

  const tokenCountersMatch = path.match(/^\/api\/v2\/tokens\/([^/]+)\/counters$/u);
  if (tokenCountersMatch && payload && typeof payload === "object") {
    if (
      String(payload.token_holders_count || "0") === "0" ||
      String(payload.transfers_count || "0") === "0"
    ) {
      const rebuilt = await getTokenRebuildData(req, tokenCountersMatch[1]);
      if (String(payload.token_holders_count || "0") === "0" && rebuilt.holdersCount > 0) {
        payload.token_holders_count = String(rebuilt.holdersCount);
      }
      if (String(payload.transfers_count || "0") === "0" && rebuilt.instancesCount > 0) {
        // Minimum transfer floor for NFTs: one mint transfer per existing token instance.
        payload.transfers_count = String(rebuilt.instancesCount);
      }
    }
  }

  if (path === "/api/v2/tokens" && payload && typeof payload === "object" && Array.isArray(payload.items)) {
    payload.items = await Promise.all(payload.items.map(async (item) => {
      if (!item || typeof item !== "object") {
        return item;
      }
      if (!isNftTokenType(item.type)) {
        return item;
      }
      const tokenAddress = String(item.address_hash || item.address || "");
      if (!tokenAddress) {
        return item;
      }
      let out = item;
      if (String(item.holders || "0") === "0") {
        const holderCount = await countTokenHoldersFromInstances(req, tokenAddress);
        if (holderCount > 0) {
          out = {
            ...out,
            holders: String(holderCount),
          };
        }
      }
      if (String(out.transfers_count || "0") === "0") {
        const rebuilt = await getTokenRebuildData(req, tokenAddress);
        if (rebuilt.instancesCount > 0) {
          out = {
            ...out,
            transfers_count: String(rebuilt.instancesCount),
          };
        }
      }
      return out;
    }));
  }

  const tokenSummaryMatch = path.match(/^\/api\/v2\/tokens\/([^/]+)$/u);
  if (tokenSummaryMatch && payload && typeof payload === "object") {
    if (isNftTokenType(payload.type)) {
      const tokenAddress = String(payload.address_hash || payload.address || tokenSummaryMatch[1] || "");
      if (tokenAddress) {
        if (String(payload.holders || "0") === "0") {
          const holderCount = await countTokenHoldersFromInstances(req, tokenAddress);
          if (holderCount > 0) {
            payload.holders = String(holderCount);
          }
        }
        if (String(payload.transfers_count || "0") === "0") {
          const rebuilt = await getTokenRebuildData(req, tokenAddress);
          if (rebuilt.instancesCount > 0) {
            payload.transfers_count = String(rebuilt.instancesCount);
          }
        }
      }
    }
  }

  const addressCollectionsMatch = path.match(/^\/api\/v2\/addresses\/([^/]+)\/nft\/collections$/u);
  if (addressCollectionsMatch && payload && typeof payload === "object" && Array.isArray(payload.items) && payload.items.length === 0) {
    const nftPayload = await fetchBlockscoutJson(
      req,
      `/api/v2/addresses/${addressCollectionsMatch[1]}/nft`,
      new URLSearchParams(url.searchParams),
    );

    if (nftPayload && Array.isArray(nftPayload.items) && nftPayload.items.length > 0) {
      payload = {
        items: toAddressCollectionFromNfts(nftPayload.items),
        next_page_params: null,
      };
    }
  }

  const addressTokensMatch = path.match(/^\/api\/v2\/addresses\/([^/]+)\/tokens$/u);
  if (addressTokensMatch && payload && typeof payload === "object" && Array.isArray(payload.items) && payload.items.length === 0) {
    const requestedType = url.searchParams.get("type");
    if (isNftTokenType(requestedType)) {
      const nftPayload = await fetchBlockscoutJson(
        req,
        `/api/v2/addresses/${addressTokensMatch[1]}/nft`,
        new URLSearchParams(url.searchParams),
      );

      if (nftPayload && Array.isArray(nftPayload.items) && nftPayload.items.length > 0) {
        payload = {
          items: nftPayload.items.map(toAddressTokenBalanceFromNft).filter(Boolean),
          next_page_params: null,
        };
      }
    }
  }

  return payload;
}

async function proxyBlockscoutApi(req, res, url) {
  const targetUrl = `${blockscoutProtocol}://${blockscoutHost}${url.pathname}${url.search}`;
  const method = req.method || "GET";
  const rawBody = method === "GET" || method === "HEAD" ? undefined : await bodyBuffer(req);

  const response = await fetch(targetUrl, {
    method,
    headers: getForwardHeaders(req),
    body: rawBody,
    redirect: "manual",
  });

  const contentType = response.headers.get("content-type") || "application/json; charset=utf-8";

  if (contentType.includes("application/json")) {
    let payload = normalizeBlockscoutPayload(await response.json());
    payload = await maybePatchBlockscoutPayload(req, url, payload);
    payload = normalizeBlockscoutPayload(payload);
    return json(res, response.status, payload);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return text(res, response.status, bytes, contentType);
}

function proxyBlockscoutWebSocket(req, clientSocket, head) {
  const requester = blockscoutProtocol === "https" ? httpsRequest : httpRequest;
  const upstreamReq = requester({
    host: blockscoutHost,
    port: blockscoutPort,
    method: "GET",
    path: req.url,
    headers: {
      ...req.headers,
      host: blockscoutHost,
      connection: "Upgrade",
      upgrade: "websocket",
      "x-forwarded-host": req.headers.host || "",
      "x-forwarded-proto": "https",
    },
  });

  upstreamReq.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
    const lines = [
      "HTTP/1.1 101 Switching Protocols",
      ...Object.entries(upstreamRes.headers).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`),
      "",
      "",
    ];
    clientSocket.write(lines.join("\r\n"));

    if (head?.length) {
      upstreamSocket.write(head);
    }
    if (upstreamHead?.length) {
      clientSocket.write(upstreamHead);
    }

    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  upstreamReq.on("response", (upstreamRes) => {
    clientSocket.write(`HTTP/1.1 ${upstreamRes.statusCode || 502} ${upstreamRes.statusMessage || "Bad Gateway"}\r\n\r\n`);
    clientSocket.destroy();
  });

  upstreamReq.on("error", () => {
    clientSocket.destroy();
  });

  upstreamReq.end();
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return json(res, 204, {});
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname;

    if (path.startsWith("/api/v2/")) {
      return proxyBlockscoutApi(req, res, url);
    }

    if (path === "/") {
      return json(res, 200, {
        ok: true,
        endpoints: ["/health", "/explorer", "/faucet", "/bridge", "/bridge-config.json"],
      });
    }

    if (path === "/health") return json(res, 200, { ok: true, ...(await commonHealth()) });
    if (path === "/bridge-config.json") return json(res, 200, bridgeConfig);
    if (path === "/explorer") return text(res, 200, explorerHtml(), "text/html; charset=utf-8");
    if (path === "/faucet") return text(res, 200, faucetHtml(), "text/html; charset=utf-8");
    if (path === "/bridge") return text(res, 200, bridgeHtml(), "text/html; charset=utf-8");
    if (path === "/faucet/health") return json(res, 200, { ok: true, ...(await commonHealth()) });

    if (req.method === "POST" && path === "/faucet/drip") {
      const { address = "" } = await bodyJson(req);
      const target = String(address).trim();
      if (!ethers.isAddress(target)) return json(res, 400, { ok: false, error: "Invalid address" });

      const status = await commonHealth();
      if (BigInt(status.chainId) !== chainIdExpected) {
        return json(res, 500, { ok: false, error: `Wrong chain connected: ${status.chainId}` });
      }

      const now = Date.now();
      const cooldownUntil = cooldownByAddress.get(target) || 0;
      if (cooldownUntil > now) {
        return json(res, 429, { ok: false, error: "Address is in cooldown" });
      }

      const bal = await provider.getBalance(wallet.address);
      if (bal < dripWei) return json(res, 503, { ok: false, error: "Faucet is out of funds" });

      const tx = await wallet.sendTransaction({ to: target, value: dripWei });
      cooldownByAddress.set(target, now + cooldownSeconds * 1000);
      return json(res, 200, {
        ok: true,
        txHash: tx.hash,
        from: wallet.address,
        to: target,
        amountEth: dripAmountEth,
      });
    }

    if (path === "/api/explorer/latest") {
      const blockNumber = await provider.getBlockNumber();
      const block = await provider.getBlock(blockNumber, false);
      return json(res, 200, { ok: true, blockNumber, block });
    }

    if (path.startsWith("/api/explorer/block/")) {
      const id = decodeURIComponent(path.replace("/api/explorer/block/", ""));
      const value = id.startsWith("0x") ? BigInt(id) : Number.parseInt(id, 10);
      const block = await provider.getBlock(value, true);
      return json(res, 200, { ok: true, input: id, block });
    }

    if (path.startsWith("/api/explorer/tx/")) {
      const hash = decodeURIComponent(path.replace("/api/explorer/tx/", ""));
      const [tx, receipt] = await Promise.all([
        provider.getTransaction(hash),
        provider.getTransactionReceipt(hash),
      ]);
      return json(res, 200, { ok: true, hash, tx, receipt });
    }

    return json(res, 404, { ok: false, error: "Not found" });
  } catch (err) {
    return json(res, 500, { ok: false, error: err instanceof Error ? err.message : "unknown error" });
  }
});

server.on("upgrade", (req, socket, head) => {
  try {
    const path = (req.url || "").split("?")[0];
    if (!path.startsWith("/socket/")) {
      socket.destroy();
      return;
    }
    proxyBlockscoutWebSocket(req, socket, head);
  } catch {
    socket.destroy();
  }
});

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`clear-testnet-services-host listening on ${host}:${port}`);
});
