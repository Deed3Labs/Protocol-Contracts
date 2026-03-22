import cors from "cors";
import express from "express";
import helmet from "helmet";
import { ethers } from "ethers";

const app = express();

const rpcUrl = process.env.RPC_URL || "http://op-geth:8545";
const chainIdExpected = BigInt(process.env.CHAIN_ID || "92373");
const faucetPrivateKey = process.env.FAUCET_PRIVATE_KEY || "";
const dripAmountEth = process.env.DRIP_AMOUNT_ETH || "0.01";
const cooldownSeconds = Number.parseInt(process.env.COOLDOWN_SECONDS || "86400", 10);
const port = Number.parseInt(process.env.PORT || "8090", 10);

if (!/^0x[0-9a-fA-F]{64}$/.test(faucetPrivateKey)) {
  // Fail fast so operator sees configuration issue.
  throw new Error("Invalid FAUCET_PRIVATE_KEY, expected 0x + 64 hex chars");
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(faucetPrivateKey, provider);
const dripWei = ethers.parseEther(dripAmountEth);
const requestTracker = new Map();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "32kb" }));

app.get("/health", async (_req, res) => {
  try {
    const [network, faucetBalanceWei, blockNumber] = await Promise.all([
      provider.getNetwork(),
      provider.getBalance(wallet.address),
      provider.getBlockNumber(),
    ]);

    res.json({
      ok: true,
      chainId: network.chainId.toString(),
      faucetAddress: wallet.address,
      faucetBalanceEth: ethers.formatEther(faucetBalanceWei),
      latestBlock: blockNumber,
      dripAmountEth,
      cooldownSeconds,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "unknown error" });
  }
});

app.post("/drip", async (req, res) => {
  const nowMs = Date.now();
  const targetAddress = (req.body?.address || "").trim();

  if (!ethers.isAddress(targetAddress)) {
    return res.status(400).json({ ok: false, error: "Invalid address" });
  }

  const network = await provider.getNetwork();
  if (network.chainId !== chainIdExpected) {
    return res.status(500).json({
      ok: false,
      error: `Wrong chain connected: expected ${chainIdExpected}, got ${network.chainId}`,
    });
  }

  const cooldownUntil = requestTracker.get(targetAddress) || 0;
  if (cooldownUntil > nowMs) {
    const retryAfterSeconds = Math.ceil((cooldownUntil - nowMs) / 1000);
    return res.status(429).json({
      ok: false,
      error: "Address is in cooldown period",
      retryAfterSeconds,
    });
  }

  try {
    const faucetBalanceWei = await provider.getBalance(wallet.address);
    if (faucetBalanceWei < dripWei) {
      return res.status(503).json({
        ok: false,
        error: "Faucet is out of funds",
        faucetAddress: wallet.address,
      });
    }

    const tx = await wallet.sendTransaction({
      to: targetAddress,
      value: dripWei,
    });

    requestTracker.set(targetAddress, nowMs + cooldownSeconds * 1000);

    res.json({
      ok: true,
      txHash: tx.hash,
      from: wallet.address,
      to: targetAddress,
      dripAmountEth,
      explorerUrl: `http://127.0.0.1:4000/tx/${tx.hash}`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown faucet error",
    });
  }
});

app.listen(port, () => {
  // Keep startup log concise for docker logs.
  // eslint-disable-next-line no-console
  console.log(`Clear faucet listening on :${port}`);
});
