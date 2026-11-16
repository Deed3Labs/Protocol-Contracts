#!/usr/bin/env node
/*
 * A browser check of tools/signing-page/index.html, with a mock MetaMask. Sends nothing anywhere.
 *
 *   node tools/signing-page/page.check.cjs                 # a small built-in plan
 *   PLAN=<signing-plan.json> node tools/signing-page/page.check.cjs   # also load a real plan
 *
 * It serves this folder on 127.0.0.1, injects a mock `window.ethereum` that records every
 * eth_sendTransaction and answers with a fake hash and receipt, and checks that:
 * - "Sign and send" stays disabled for the wrong account (and says which account to switch to),
 *   and for a step that is waiting, and is enabled for the step's signer on the plan's chain;
 * - the request carries exactly the plan's from, to and data, with value 0x0;
 * - the hash and the receipt show, and the page remembers the sent step after a reload;
 * - a plan for another chain, or one edited after the script wrote it, is refused;
 * - the page makes no request to any other host.
 * Needs Playwright's Chromium (`require("playwright")`). Exits 1 on the first failure.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { chromium } = require("playwright");

const HERE = __dirname;
const assert = (cond, msg) => { if (!cond) { throw new Error(`FAIL: ${msg}`); } console.log(`ok - ${msg}`); };
const sha = (steps) => crypto.createHash("sha256").update(JSON.stringify(steps)).digest("hex");

const SIGNER = "0x7ec1D6b69398af413edC94692FB167A3864A86cF";
const OTHER = "0x558D4318071EBC15e7ED13d8e880Dc1D17A7698a";
const AGENT = "0x1111111111111111111111111111111111111111";
const SAFE = "0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50";
const TIMELOCK = "0x2222222222222222222222222222222222222222";
const DATA = "0xa6c1b8c5" + "00".repeat(12) + "1111111111111111111111111111111111111111" + "ab".repeat(32) + "cd".repeat(32);

function samplePlan(chainId = 84532) {
  const base = { chainId, value: "0", dependsOn: [] };
  const steps = [
    { ...base, id: "E8-vault-propose", stage: "E8", title: "Propose: point the Collateral Agent at the BondVault", explanation: "Treasury signer 1 proposes the change.",
      kind: "wallet", signer: SIGNER, signerLabel: "treasury signer 1", to: AGENT, toLabel: "CollateralAgent", data: DATA,
      functionSignature: "proposeChange(address,bytes32,bytes32)", args: [{ name: "target", type: "address", value: AGENT, note: "CollateralAgent" }], status: "ready" },
    { ...base, id: "E8-vault-confirm", stage: "E8", title: "Confirm: point the Collateral Agent at the BondVault", explanation: "A second treasury signer confirms.",
      kind: "wallet", signer: OTHER, signerLabel: "treasury signer 2", to: AGENT, toLabel: "CollateralAgent", data: null,
      functionSignature: "confirmChange(bytes32)", args: [], dependsOn: ["E8-vault-propose"], status: "waiting", reason: "Its change number is known once the change is proposed." },
    { ...base, id: "E8-earn-schedule", stage: "E8", title: "Clear Lending Safe: schedule the changes", explanation: "Queues the changes.",
      kind: "safe", signer: SAFE, signerLabel: "Clear Lending Safe", to: TIMELOCK, toLabel: "Earn timelock", data: "0x8f2a0bb0",
      functionSignature: "scheduleBatch(address[],uint256[],bytes[],bytes32,bytes32,uint256)", args: [], status: "ready", safeBatchFile: "safe-batches/signing-E8-earn-schedule.json" },
  ];
  return { format: "clear-signing-plan/1", generatedAt: new Date().toISOString(), network: "base-sepolia", chainId, block: 123, blockTime: new Date().toISOString(), stepsSha256: sha(steps), notes: ["A note."], steps };
}

const files = {
  "/plan.json": JSON.stringify(samplePlan()),
  "/plan-mainnet.json": JSON.stringify(samplePlan(8453)),
};
{
  const edited = samplePlan();
  edited.steps[0].data = edited.steps[0].data.replace(/ab/g, "ee"); // edited after the fingerprint was taken
  files["/plan-edited.json"] = JSON.stringify(edited);
}
if (process.env.PLAN) files["/real-plan.json"] = fs.readFileSync(process.env.PLAN, "utf8");

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (files[url.pathname]) { res.writeHead(200, { "content-type": "application/json" }); return res.end(files[url.pathname]); }
  if (url.pathname === "/" || url.pathname === "/index.html") { res.writeHead(200, { "content-type": "text/html" }); return res.end(fs.readFileSync(path.join(HERE, "index.html"))); }
  res.writeHead(404); res.end();
});

const MOCK = `
  (() => {
    const listeners = {};
    const state = { account: ${JSON.stringify(OTHER)}, chainId: "0x14a34", sent: [], calls: [] };
    window.__mock = {
      state,
      setAccount(a) { state.account = a; (listeners.accountsChanged || []).forEach((f) => f([a])); },
      setChain(c) { state.chainId = c; (listeners.chainChanged || []).forEach((f) => f(c)); },
    };
    window.ethereum = {
      isMetaMask: true,
      on(ev, f) { (listeners[ev] = listeners[ev] || []).push(f); },
      removeListener() {},
      async request({ method, params }) {
        state.calls.push(method);
        switch (method) {
          case "eth_requestAccounts": case "eth_accounts": return state.account ? [state.account] : [];
          case "eth_chainId": return state.chainId;
          case "wallet_switchEthereumChain": state.chainId = params[0].chainId; return null;
          case "wallet_addEthereumChain": return null;
          case "eth_sendTransaction": state.sent.push(params[0]); return "0x" + "77".repeat(32);
          case "eth_getTransactionReceipt": return { status: "0x1", blockNumber: "0x2a", transactionHash: params[0] };
          default: throw Object.assign(new Error("mock: " + method), { code: 4200 });
        }
      },
    };
  })();`;

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const foreign = [];
  try {
    const context = await browser.newContext();
    context.on("request", (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith("blob:") && !r.url().startsWith("data:")) foreign.push(r.url()); });
    await context.addInitScript(MOCK);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(`${origin}/?plan=plan.json`);
    await page.waitForSelector("#step-E8-vault-propose");
    assert((await page.textContent("#banner")).includes("Base Sepolia test network"), "shows the Base Sepolia test network banner");
    const send = page.locator('#step-E8-vault-propose button[data-step="E8-vault-propose"]');
    assert(await send.isDisabled(), "Sign and send is disabled before MetaMask is connected");

    await page.click("#connect");
    await page.waitForFunction(() => document.querySelector("#walletState").textContent.includes("Connected"));
    assert(await send.isDisabled(), "Sign and send is disabled for the wrong account");
    const hint = await page.textContent("#step-E8-vault-propose .hint");
    assert(hint.includes(`Switch MetaMask to the account ending ${SIGNER.slice(-4)}`) && hint.includes("treasury signer 1"), "says plainly which account to switch to");
    assert(await page.locator('#step-E8-vault-confirm button[data-step="E8-vault-confirm"]').isDisabled(), "a waiting step cannot be sent");
    assert((await page.textContent("#step-E8-vault-confirm")).includes("Why it waits"), "a waiting step shows its reason");
    assert((await page.locator("#step-E8-earn-schedule button[data-step]").count()) === 0, "a Safe step has no Sign and send button");
    assert((await page.textContent("#step-E8-earn-schedule")).includes("Transaction Builder"), "a Safe step says to use the Safe app's Transaction Builder");

    await page.evaluate((a) => window.__mock.setAccount(a), SIGNER);
    await page.waitForFunction(() => !document.querySelector('button[data-step="E8-vault-propose"]').disabled);
    assert(!(await send.isDisabled()), "Sign and send is enabled for the step's signer");

    await page.evaluate(() => window.__mock.setChain("0x1"));
    await page.waitForFunction(() => document.querySelector('button[data-step="E8-vault-propose"]').disabled);
    assert((await page.textContent("#step-E8-vault-propose .hint")).includes("wrong network"), "a wrong network disables it and says so");
    await page.evaluate(() => window.__mock.setChain("0x14a34"));
    await page.waitForFunction(() => !document.querySelector('button[data-step="E8-vault-propose"]').disabled);

    await send.click();
    await page.waitForFunction(() => document.querySelector("#step-E8-vault-propose").textContent.includes("Confirmed in block 42"));
    const sent = await page.evaluate(() => window.__mock.state.sent);
    assert(sent.length === 1, "exactly one transaction was requested");
    assert(JSON.stringify(sent[0]) === JSON.stringify({ from: SIGNER, to: AGENT, data: DATA, value: "0x0" }), "the request carries exactly the plan's from, to and data, value 0x0");
    const link = await page.getAttribute("#step-E8-vault-propose .tx a", "href");
    assert(link === `https://sepolia.basescan.org/tx/0x${"77".repeat(32)}`, "links the hash on sepolia.basescan.org");
    assert(await send.isDisabled(), "a sent step cannot be sent twice");

    await page.reload();
    await page.waitForSelector("#step-E8-vault-propose .tx");
    assert((await page.textContent("#step-E8-vault-propose")).includes("Confirmed in block 42"), "remembers the sent step after a reload");

    for (const [file, why, text] of [["plan-mainnet.json", "a plan for another chain (8453) is refused", "only signs on Base Sepolia"], ["plan-edited.json", "a plan edited after the script wrote it is refused", "do not match its fingerprint"]]) {
      await page.goto(`${origin}/?plan=${file}`);
      await page.waitForFunction(() => document.querySelector("#loadError").textContent.length > 0);
      assert((await page.textContent("#loadError")).includes(text) && (await page.locator(".step").count()) === 0, why);
    }
    await page.goto(`${origin}/?plan=https://example.com/plan.json`);
    await page.waitForFunction(() => document.querySelector("#loadError").textContent.length > 0);
    assert((await page.textContent("#loadError")).includes("relative address"), "?plan= refuses an address on another site");

    if (files["/real-plan.json"]) {
      await page.goto(`${origin}/?plan=real-plan.json`);
      await page.waitForSelector(".step");
      const real = JSON.parse(files["/real-plan.json"]);
      assert((await page.locator(".step").count()) === real.steps.length, `loads the real plan (${real.steps.length} steps)`);
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`${origin}/?plan=plan.json`);
    await page.waitForSelector(".step");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(overflow <= 0, "no sideways scroll at phone width");

    assert(errors.length === 0, `no page errors${errors.length ? ": " + errors.join("; ") : ""}`);
    assert(foreign.length === 0, `no request to any other host${foreign.length ? ": " + foreign.join(", ") : ""}`);
    console.log("\nAll checks passed.");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e.message || e);
  server.close();
  process.exit(1);
});
