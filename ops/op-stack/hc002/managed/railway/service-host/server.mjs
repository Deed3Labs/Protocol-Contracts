import { createServer } from "node:http";
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

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return json(res, 204, {});
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname;

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

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`clear-testnet-services-host listening on ${host}:${port}`);
});
