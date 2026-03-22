#!/usr/bin/env node
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ethers } from "ethers";
import dotenv from "dotenv";

const rootDir = resolve(new URL(".", import.meta.url).pathname, "..", "..");
const servicesDir = resolve(rootDir, "ops/op-stack/hc002/services");
const envPath = resolve(servicesDir, ".env");
const bridgeConfigPath = resolve(servicesDir, "bridge-ui/bridge-config.json");
const bridgeHtmlPath = resolve(servicesDir, "bridge-ui/index.html");

if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:9545";
const chainIdRaw =
  process.env.CLEAR_CHAIN_ID && process.env.CLEAR_CHAIN_ID !== "null"
    ? process.env.CLEAR_CHAIN_ID
    : "92373";
const chainIdExpected = BigInt(chainIdRaw);
const faucetKey = process.env.FAUCET_PRIVATE_KEY || "";
const dripAmountEth = process.env.FAUCET_DRIP_AMOUNT_ETH || "0.01";
const cooldownSeconds = Number.parseInt(process.env.FAUCET_COOLDOWN_SECONDS || "86400", 10);
const port = Number.parseInt(process.env.SERVICES_PORT || "8077", 10);

if (!existsSync(bridgeHtmlPath)) {
  throw new Error(`Missing bridge UI html: ${bridgeHtmlPath}`);
}

if (!/^0x[0-9a-fA-F]{64}$/.test(faucetKey)) {
  throw new Error("Invalid FAUCET_PRIVATE_KEY in services .env");
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(faucetKey, provider);
const dripWei = ethers.parseEther(dripAmountEth);
const cooldownByAddress = new Map();

function buildBridgeConfig() {
  if (existsSync(bridgeConfigPath)) {
    return JSON.parse(readFileSync(bridgeConfigPath, "utf8"));
  }

  return {
    chainName: process.env.CLEAR_CHAIN_NAME || "Clear Testnet",
    chainId: Number.parseInt(process.env.CLEAR_CHAIN_ID || "92373", 10),
    l1ChainId: Number.parseInt(process.env.CLEAR_L1_CHAIN_ID || "11155111", 10),
    rpcUrl: process.env.PUBLIC_RPC_URL || process.env.RPC_URL || "http://127.0.0.1:9545",
    explorerUrl: process.env.PUBLIC_EXPLORER_URL || `http://127.0.0.1:${port}/explorer`,
    faucetUrl: process.env.PUBLIC_FAUCET_URL || `http://127.0.0.1:${port}/faucet`,
    contracts: {
      optimismPortalProxy: process.env.OPTIMISM_PORTAL_PROXY || "0x0000000000000000000000000000000000000000",
      l1StandardBridgeProxy: process.env.L1_STANDARD_BRIDGE_PROXY || "0x0000000000000000000000000000000000000000",
      l1CrossDomainMessengerProxy:
        process.env.L1_CROSS_DOMAIN_MESSENGER_PROXY || "0x0000000000000000000000000000000000000000",
      l1Erc721BridgeProxy: process.env.L1_ERC721_BRIDGE_PROXY || "0x0000000000000000000000000000000000000000",
      systemConfigProxy: process.env.SYSTEM_CONFIG_PROXY || "0x0000000000000000000000000000000000000000",
    },
  };
}

function sendJson(res, code, payload) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, code, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(code, {
    "content-type": contentType,
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

function explorerHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Clear Explorer Lite</title>
  <style>
    body{font-family:ui-sans-serif,system-ui;background:#f5f6f8;color:#0f172a;margin:0}
    main{max-width:980px;margin:36px auto;padding:0 18px}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px}
    .muted{color:#64748b}
    input,button{font-size:14px;padding:8px;border-radius:8px;border:1px solid #cbd5e1}
    button{cursor:pointer}
    code{font-family:ui-monospace,Menlo,monospace}
    pre{white-space:pre-wrap;word-break:break-word}
  </style>
</head>
<body>
<main>
  <h1>Clear Explorer Lite</h1>
  <p class="muted">Lightweight explorer endpoint for local HC-002 validation.</p>

  <div class="card">
    <h3>Latest Block</h3>
    <pre id="latest">Loading...</pre>
  </div>

  <div class="card">
    <h3>Lookup Block</h3>
    <input id="blockId" placeholder="e.g. 0x10 or 16" />
    <button onclick="lookupBlock()">Fetch</button>
    <pre id="blockOut"></pre>
  </div>

  <div class="card">
    <h3>Lookup Transaction</h3>
    <input id="txHash" style="width:100%" placeholder="0x..." />
    <button onclick="lookupTx()">Fetch</button>
    <pre id="txOut"></pre>
  </div>

  <div class="card">
    <a href="/bridge">Bridge UI</a> |
    <a href="/faucet">Faucet UI</a>
  </div>
</main>
<script>
async function loadLatest(){
  const r = await fetch('/api/explorer/latest');
  const j = await r.json();
  document.getElementById('latest').textContent = JSON.stringify(j, null, 2);
}
async function lookupBlock(){
  const id = document.getElementById('blockId').value.trim();
  const r = await fetch('/api/explorer/block/' + encodeURIComponent(id));
  const j = await r.json();
  document.getElementById('blockOut').textContent = JSON.stringify(j, null, 2);
}
async function lookupTx(){
  const id = document.getElementById('txHash').value.trim();
  const r = await fetch('/api/explorer/tx/' + encodeURIComponent(id));
  const j = await r.json();
  document.getElementById('txOut').textContent = JSON.stringify(j, null, 2);
}
loadLatest();
</script>
</body>
</html>`;
}

function faucetHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Clear Faucet</title>
  <style>
    body{font-family:ui-sans-serif,system-ui;background:#f8fafc;color:#0f172a;margin:0}
    main{max-width:720px;margin:40px auto;padding:0 18px}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px}
    input,button{font-size:14px;padding:8px;border-radius:8px;border:1px solid #cbd5e1}
    button{cursor:pointer}
    pre{white-space:pre-wrap;word-break:break-word}
  </style>
</head>
<body>
<main>
  <h1>Clear Faucet</h1>
  <div class="card">
    <p>Drip amount: <code>${dripAmountEth} ETH</code></p>
    <input id="addr" style="width:100%" placeholder="Recipient address 0x..." />
    <button onclick="drip()">Request Drip</button>
    <pre id="out"></pre>
  </div>
  <p><a href="/explorer">Explorer</a> | <a href="/bridge">Bridge UI</a></p>
</main>
<script>
async function drip(){
  const address = document.getElementById('addr').value.trim();
  const r = await fetch('/faucet/drip', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({address})
  });
  const j = await r.json();
  document.getElementById('out').textContent = JSON.stringify(j, null, 2);
}
</script>
</body>
</html>`;
}

async function getCommonStatus() {
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

async function parseJsonBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  return JSON.parse(raw);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      return sendJson(res, 204, {});
    }

    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname;

    if (path === "/") {
      return sendJson(res, 200, {
        ok: true,
        service: "hc002-services-host",
        endpoints: {
          health: "/health",
          explorer: "/explorer",
          faucet: "/faucet",
          bridge: "/bridge",
          bridgeConfig: "/bridge-config.json",
          explorerLatest: "/api/explorer/latest",
          faucetDrip: "POST /faucet/drip",
        },
      });
    }

    if (path === "/health") {
      const status = await getCommonStatus();
      return sendJson(res, 200, { ok: true, ...status });
    }

    if (path === "/bridge-config.json") {
      return sendJson(res, 200, buildBridgeConfig());
    }

    if (path === "/bridge") {
      const html = readFileSync(bridgeHtmlPath, "utf8");
      return sendText(res, 200, html, "text/html; charset=utf-8");
    }

    if (path === "/explorer") {
      return sendText(res, 200, explorerHtml(), "text/html; charset=utf-8");
    }

    if (path === "/faucet") {
      return sendText(res, 200, faucetHtml(), "text/html; charset=utf-8");
    }

    if (path === "/faucet/health") {
      const status = await getCommonStatus();
      return sendJson(res, 200, { ok: true, ...status });
    }

    if (req.method === "POST" && path === "/faucet/drip") {
      const body = await parseJsonBody(req);
      const address = String(body?.address || "").trim();

      if (!ethers.isAddress(address)) {
        return sendJson(res, 400, { ok: false, error: "Invalid address" });
      }

      const status = await getCommonStatus();
      if (BigInt(status.chainId) !== chainIdExpected) {
        return sendJson(res, 500, {
          ok: false,
          error: `Wrong chain connected: expected ${chainIdExpected}, got ${status.chainId}`,
        });
      }

      const nowMs = Date.now();
      const cooldownUntil = cooldownByAddress.get(address) || 0;
      if (cooldownUntil > nowMs) {
        return sendJson(res, 429, {
          ok: false,
          error: "Address is in cooldown",
          retryAfterSeconds: Math.ceil((cooldownUntil - nowMs) / 1000),
        });
      }

      const faucetBalanceWei = await provider.getBalance(wallet.address);
      if (faucetBalanceWei < dripWei) {
        return sendJson(res, 503, {
          ok: false,
          error: "Faucet is out of funds",
          faucetAddress: wallet.address,
        });
      }

      const tx = await wallet.sendTransaction({ to: address, value: dripWei });
      cooldownByAddress.set(address, nowMs + cooldownSeconds * 1000);

      return sendJson(res, 200, {
        ok: true,
        txHash: tx.hash,
        from: wallet.address,
        to: address,
        amountEth: dripAmountEth,
      });
    }

    if (path === "/api/explorer/latest") {
      const blockNumber = await provider.getBlockNumber();
      const block = await provider.getBlock(blockNumber, false);
      return sendJson(res, 200, { ok: true, blockNumber, block });
    }

    if (path.startsWith("/api/explorer/block/")) {
      const id = decodeURIComponent(path.replace("/api/explorer/block/", ""));
      const value = id.startsWith("0x") ? BigInt(id) : Number.parseInt(id, 10);
      const block = await provider.getBlock(value, true);
      return sendJson(res, 200, { ok: true, input: id, block });
    }

    if (path.startsWith("/api/explorer/tx/")) {
      const hash = decodeURIComponent(path.replace("/api/explorer/tx/", ""));
      const [tx, receipt] = await Promise.all([
        provider.getTransaction(hash),
        provider.getTransactionReceipt(hash),
      ]);
      return sendJson(res, 200, { ok: true, hash, tx, receipt });
    }

    return sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : "unknown error" });
  }
});

server.listen(port, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`HC-002 services host listening at http://127.0.0.1:${port}`);
});
