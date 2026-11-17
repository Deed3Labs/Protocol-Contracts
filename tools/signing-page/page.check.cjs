#!/usr/bin/env node
/*
 * A browser check of tools/signing-page/index.html, with a mock MetaMask. Sends nothing anywhere.
 *
 *   node tools/signing-page/page.check.cjs                 # a small built-in plan
 *   PLAN=<signing-plan.json> node tools/signing-page/page.check.cjs   # also click through a real plan
 *   (PLAN may name several files, separated by ":"; e.g. the Base Sepolia plan and a local 31337 one)
 *
 * It serves this folder on 127.0.0.1, injects a mock `window.ethereum` that records every
 * eth_sendTransaction and answers with a fake hash and receipt, and checks that:
 * - the step list shows "All ready" until a wallet connects, then "Ready for this wallet";
 * - a stage in the track filters the list to that stage, and a second click clears it;
 * - "Sign and send" stays disabled for the wrong account (and says which account to switch to),
 *   on the wrong network, and for a step that is waiting, and is enabled for the step's signer;
 * - the request carries exactly the plan's from, to and data, with value 0x0;
 * - the hash and the receipt show, and the page remembers the sent step after a reload;
 * - "Read the chain again" turns a confirmed step done, opens a step that only waited for it,
 *   keeps a step whose call data is unknown waiting, and picks up a re-run plan from ?plan=;
 * - a Safe step offers "Download batch file" (with the plan's to and data) and "Open in the Safe app";
 * - a plan for another chain, one edited after the script wrote it, and ?plan= on another site are refused;
 * - there is no sideways scroll at phone width, and the page makes no request to any other host.
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
const STRANGER = "0x3333333333333333333333333333333333333333";
const AGENT = "0x1111111111111111111111111111111111111111";
const SAFE = "0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50";
const TIMELOCK = "0x2222222222222222222222222222222222222222";
const LIQ = "0x4444444444444444444444444444444444444444";
const TERM = "0x5555555555555555555555555555555555555555";
const DATA = "0xa6c1b8c5" + "00".repeat(12) + "1111111111111111111111111111111111111111" + "ab".repeat(32) + "cd".repeat(32);
const HOLD_DATA = "0x2f2ff15d" + "12".repeat(32) + "00".repeat(12) + "7ec1d6b69398af413edc94692fb167a3864a86cf";
const CONFIRM_DATA = "0x1d9a2c1e" + "34".repeat(32);
const SAFE_DATA = "0x8f2a0bb0" + "56".repeat(64);
const HASH = "0x" + "77".repeat(32);

function samplePlan(chainId = 84532, rerun = false) {
  const base = { chainId, value: "0", dependsOn: [] };
  const steps = [
    { ...base, id: "E8-vault-propose", stage: "E8", title: "Propose: point the Collateral Agent at the BondVault", explanation: "Treasury signer 1 proposes the change.",
      kind: "wallet", signer: SIGNER, signerLabel: "treasury signer 1", to: AGENT, toLabel: "CollateralAgent", data: DATA,
      functionSignature: "proposeChange(address,bytes32,bytes32)", args: [{ name: "target", type: "address", value: AGENT, note: "CollateralAgent" }], status: rerun ? "done" : "ready" },
    rerun
      ? { ...base, id: "E8-vault-confirm", stage: "E8", title: "Confirm: point the Collateral Agent at the BondVault", explanation: "A second treasury signer confirms.",
          kind: "wallet", signer: OTHER, signerLabel: "treasury signer 2", to: AGENT, toLabel: "CollateralAgent", data: CONFIRM_DATA,
          functionSignature: "confirmChange(bytes32)", args: [{ name: "changeId", type: "bytes32", value: "0x" + "34".repeat(32) }], dependsOn: ["E8-vault-propose"], status: "ready" }
      : { ...base, id: "E8-vault-confirm", stage: "E8", title: "Confirm: point the Collateral Agent at the BondVault", explanation: "A second treasury signer confirms.",
          kind: "wallet", signer: OTHER, signerLabel: "treasury signer 2", to: AGENT, toLabel: "CollateralAgent", data: null,
          functionSignature: "confirmChange(bytes32)", args: [], dependsOn: ["E8-vault-propose"], status: "waiting", reason: "Its change number is known once the change is proposed: re-run the plan after the proposal." },
    { ...base, id: "E8-hold-1", stage: "E8", title: "Give hold signer 1 the Liquidator's hold role", explanation: "The deployer grants the hold role.",
      kind: "wallet", signer: SIGNER, signerLabel: "treasury signer 1", to: LIQ, toLabel: "Liquidator", data: HOLD_DATA,
      functionSignature: "grantRole(bytes32,address)", args: [], dependsOn: ["E8-vault-propose"], status: rerun ? "ready" : "waiting", ...(rerun ? {} : { reason: "Waits for E8-vault-propose first." }) },
    { ...base, id: "E8-earn-schedule", stage: "E8", title: "Clear Lending Safe: schedule the changes", explanation: "Queues the changes.",
      kind: "safe", signer: SAFE, signerLabel: "Clear Lending Safe (its owners sign in the Safe app)", to: TIMELOCK, toLabel: "Earn timelock", data: SAFE_DATA,
      functionSignature: "scheduleBatch(address[],uint256[],bytes[],bytes32,bytes32,uint256)", args: [], status: "ready", safeBatchFile: "safe-batches/signing-E8-earn-schedule.json" },
    { ...base, id: "F2-fee-approve", stage: "F2", title: "Approve the fee recipient for term plans", explanation: "The second settings signer approves.",
      kind: "wallet", signer: OTHER, signerLabel: "credit settings signer 2", to: TERM, toLabel: "TermIssuer", data: "0xabcdef01",
      functionSignature: "approveFeeRecipient(address,bytes32)", args: [], status: "ready" },
  ];
  return { format: "clear-signing-plan/1", generatedAt: new Date().toISOString(), network: "base-sepolia", chainId, block: rerun ? 140 : 123, blockTime: new Date().toISOString(), stepsSha256: sha(steps), notes: ["A note."], steps };
}

const files = {
  "/plan.json": JSON.stringify(samplePlan()),
  "/plan-mainnet.json": JSON.stringify(samplePlan(8453)),
};
const edited = () => {
  const p = samplePlan();
  p.steps[0].data = p.steps[0].data.replace(/ab/g, "ee"); // edited after the fingerprint was taken
  return JSON.stringify(p);
};
files["/plan-edited.json"] = edited();
const extra = (process.env.PLAN || "").split(":").filter(Boolean);
extra.forEach((f, i) => { files[`/real-plan-${i}.json`] = fs.readFileSync(f, "utf8"); });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (files[url.pathname]) { res.writeHead(200, { "content-type": "application/json" }); return res.end(files[url.pathname]); }
  if (url.pathname === "/" || url.pathname === "/index.html") { res.writeHead(200, { "content-type": "text/html" }); return res.end(fs.readFileSync(path.join(HERE, "index.html"))); }
  res.writeHead(404); res.end();
});

const MOCK = `
  (() => {
    const listeners = {};
    const state = { account: ${JSON.stringify(OTHER)}, connected: false, chainId: "0x14a34", mined: true, sent: [], calls: [] };
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
          case "eth_requestAccounts": state.connected = true; return state.account ? [state.account] : [];
          case "eth_accounts": return state.connected && state.account ? [state.account] : [];
          case "eth_chainId": return state.chainId;
          case "wallet_switchEthereumChain": state.chainId = params[0].chainId; return null;
          case "wallet_addEthereumChain": return null;
          case "eth_sendTransaction": state.sent.push(params[0]); return ${JSON.stringify(HASH)};
          case "eth_getTransactionReceipt": return state.mined ? { status: "0x1", blockNumber: "0x2a", transactionHash: params[0] } : null;
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
  const errors = [];
  const watch = (context) => context.on("request", (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith("blob:") && !r.url().startsWith("data:")) foreign.push(r.url()); });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    watch(context);
    await context.addInitScript(MOCK);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));

    const rowIds = () => page.$$eval("#stepList [data-step]", (els) => els.map((e) => e.getAttribute("data-step")));
    const chipOf = (id) => page.getAttribute(`#stepList [data-step="${id}"] .sn-s`, "data-chip");
    const openStep = async (id) => { await page.click(`#stepList [data-open="${id}"]`); await page.waitForSelector(`#panel[data-step="${id}"] .pn-ft`); };
    const closePanel = async () => { await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.body.classList.contains("pn-open")); };
    const filterOn = () => page.textContent(".sn-fl button.on").catch(() => null);
    const sendBtn = '#panel [data-send]';

    await page.goto(`${origin}/?plan=plan.json`);
    await page.waitForSelector("#stepList");
    assert((await page.textContent("#netTag")).includes("Base Sepolia · test money only"), "shows the Base Sepolia, test money only tag");
    assert((await page.textContent("#planName")) === "Base Sepolia rollout", "names the plan: Base Sepolia rollout");
    assert((await filterOn()) === "All ready", "the list shows All ready before a wallet connects");
    assert((await rowIds()).join() === "E8-vault-propose,E8-earn-schedule,F2-fee-approve", "All ready lists the ready steps");
    assert((await chipOf("E8-earn-schedule")) === "ready" && (await page.textContent('#stepList [data-step="E8-earn-schedule"] .sn-s')) === "In the Safe app", "a ready Safe step's chip says In the Safe app");
    // The chip's own rule is inline-block (a grid item computes it as block): text centred by line-height, not flex.
    const chipBox = await page.$eval('#stepList [data-step="E8-vault-propose"] .sn-s', (e) => { const c = getComputedStyle(e); return [c.display, c.height, c.lineHeight, c.textAlign].join(); });
    assert(/^(inline-)?block,20px,20px,center$/.test(chipBox), "status chips are 20px high, line-height 20px, centred text, not flex");
    assert((await page.textContent("#run")).includes("checked") && (await page.textContent("#run")).includes("plan.json"), "the run card shows the fingerprint as checked and the file name");

    // stage filter
    await page.click('#run [data-f="st:F2"]');
    assert((await rowIds()).join() === "F2-fee-approve", "a stage in the track filters the list to that stage");
    assert(await page.$eval('#run [data-k="st:F2"]', (e) => e.classList.contains("on")), "the active stage is marked");
    await page.click('#run [data-k="st:F2"]');
    assert((await rowIds()).length === 5 && (await filterOn()) === "All steps", "clicking the stage again clears the filter");
    await page.click('[data-f="ready"]');

    // before connecting
    await openStep("E8-vault-propose");
    assert((await page.locator(sendBtn).count()) === 0 || (await page.locator(sendBtn).isDisabled()), "Sign and send is not available before MetaMask is connected");
    assert((await page.textContent("#pnFoot")).includes("Connect MetaMask first"), "the panel says to connect MetaMask first");
    await page.click("#panel [data-connect]");
    await page.waitForSelector("#acctLabel");
    assert((await filterOn()) === "Ready for this wallet", "after connecting, the list switches to Ready for this wallet");
    assert((await rowIds()).join() === "F2-fee-approve", "Ready for this wallet lists the account's ready steps");
    assert(await page.$eval('#stepList [data-step="F2-fee-approve"]', (e) => e.classList.contains("me")), "the account's ready rows carry the accent");
    assert((await page.textContent("#acctLabel")) === "treasury signer 2 · credit settings signer 2", "the wallet card names the account from the plan's labels");
    assert((await page.textContent("#netChip")) === "Base Sepolia", "the wallet card shows the network");
    assert(await page.locator(sendBtn).isDisabled(), "Sign and send is disabled for the wrong account");
    const hint = await page.textContent("#pnNote");
    assert(hint.includes(`Switch MetaMask to treasury signer 1 (…${SIGNER.slice(-4)})`), "says plainly which account to switch to");
    await closePanel();

    await page.click('[data-f="all"]');
    await openStep("E8-vault-confirm");
    assert(await page.locator(sendBtn).isDisabled(), "a waiting step cannot be sent");
    assert((await page.textContent("#whyWaits")).includes("Why it waits"), "a waiting step shows its reason");
    assert((await page.textContent("#pnNote")) === "Opens when E8-vault-propose is done", "a waiting step says what it opens after");
    await page.click("#panel [data-k='close']");
    await page.waitForFunction(() => !document.body.classList.contains("pn-open"));

    // a Safe step
    await openStep("E8-earn-schedule");
    assert((await page.locator(sendBtn).count()) === 0, "a Safe step has no Sign and send button");
    const safeHref = await page.getAttribute("#panel [data-safeapp]", "href");
    assert(safeHref === `https://app.safe.global/apps/open?safe=basesep:${SAFE}&appUrl=https%3A%2F%2Fapps-portal.safe.global%2Ftx-builder`, "Open in the Safe app links the Safe on Base Sepolia");
    assert((await page.textContent("#panel [data-safeapp]")) === "Open in the Safe app", "the link is labelled Open in the Safe app");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#panel [data-dl]")]);
    const batch = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
    assert(dl.suggestedFilename() === "signing-E8-earn-schedule.json" && batch.chainId === "84532"
      && JSON.stringify(batch.transactions) === JSON.stringify([{ to: TIMELOCK, value: "0", data: SAFE_DATA }]), "Download batch file holds the plan's to and data");
    assert((await page.textContent("#panel .bd-tk")).includes("Owners signed"), "a Safe step's track has the Safe's five stages");
    await closePanel();

    // the right account, the right network
    await page.evaluate((a) => window.__mock.setAccount(a), SIGNER);
    await openStep("E8-vault-propose");
    assert(!(await page.locator(sendBtn).isDisabled()), "Sign and send is enabled for the step's signer");
    await page.evaluate(() => window.__mock.setChain("0x1"));
    await page.waitForFunction(() => document.querySelector("#panel [data-send]").disabled);
    assert((await page.textContent("#pnNote")).includes("wrong network"), "a wrong network disables it and says so");
    assert((await page.textContent("#netChip")) === "Wrong network", "the wallet card flags the wrong network");
    await page.evaluate(() => window.__mock.setChain("0x14a34"));
    await page.waitForFunction(() => !document.querySelector("#panel [data-send]").disabled);

    // send, with the receipt not yet mined
    await page.evaluate(() => { window.__mock.state.mined = false; });
    await page.click(sendBtn);
    await page.waitForSelector("#txLink");
    const sent = await page.evaluate(() => window.__mock.state.sent);
    assert(sent.length === 1, "exactly one transaction was requested");
    assert(JSON.stringify(sent[0]) === JSON.stringify({ from: SIGNER, to: AGENT, data: DATA, value: "0x0" }), "the request carries exactly the plan's from, to and data, value 0x0");
    assert((await page.getAttribute("#txLink", "href")) === `https://sepolia.basescan.org/tx/${HASH}`, "links the hash on sepolia.basescan.org");
    assert((await page.textContent("#pnChip")) === "Sent" && (await page.locator(sendBtn).count()) === 0, "a sent step shows Sent and cannot be sent twice");
    assert((await page.locator('#run [data-count="pending"]').count()) === 1, "the run shows a sent count while something is pending");
    await closePanel();
    assert((await chipOf("E8-hold-1")) === "waiting", "the step after it still waits");

    // Read the chain again: the receipt, then the step that waited only for it
    await page.evaluate(() => { window.__mock.state.mined = true; });
    await page.click("[data-readchain]");
    await page.waitForFunction(() => document.querySelector('#stepList [data-step="E8-vault-propose"] .sn-s').getAttribute("data-chip") === "success");
    assert((await page.evaluate(() => window.__mock.state.calls)).includes("eth_getTransactionReceipt"), "Read the chain again reads the receipt through the wallet");
    assert((await page.textContent('#stepList [data-step="E8-vault-propose"] .sn-s')) === "Confirmed", "a confirmed sent step shows Confirmed");
    await page.waitForFunction(() => document.querySelector('#stepList [data-step="E8-hold-1"] .sn-s').getAttribute("data-chip") === "ready");
    assert(true, "a step that waited only for it (with its call data) opens");
    assert((await page.locator('#run [data-count="pending"]').count()) === 0, "the sent count goes once nothing is pending");
    assert((await chipOf("E8-vault-confirm")) === "waiting", "a step whose call data is not known yet stays waiting");
    await openStep("E8-vault-confirm");
    assert((await page.textContent("#pnNote")) === "Re-run scripts/signing_plan.ts to open this step", "and says to re-run the plan script");
    await closePanel();
    await openStep("E8-vault-propose");
    assert((await page.textContent("#txState")).includes("Confirmed in block 42") && (await page.textContent("#panel .bd-tk .now")) === "Confirmed", "the panel shows the receipt and the track at Confirmed");
    await closePanel();
    await openStep("E8-hold-1");
    assert(!(await page.locator(sendBtn).isDisabled()), "the opened step can be sent by its signer");
    await closePanel();

    await page.reload();
    await page.waitForSelector('#stepList');
    await page.click('[data-f="all"]');
    assert((await chipOf("E8-vault-propose")) === "success", "remembers the sent step after a reload");
    await openStep("E8-vault-propose");
    assert((await page.textContent("#txState")).includes("Confirmed in block 42"), "and its receipt");
    await closePanel();

    // a re-run plan, picked up by Read the chain again
    files["/plan.json"] = JSON.stringify(samplePlan(84532, true));
    await page.click("[data-readchain]");
    await page.waitForFunction(() => document.querySelector('#stepList [data-step="E8-vault-confirm"] .sn-s').getAttribute("data-chip") === "ready");
    assert((await page.textContent("#run")).includes("block 140"), "Read the chain again loads the re-run plan from ?plan=");
    files["/plan.json"] = edited();
    await page.click("[data-readchain]");
    await page.waitForFunction(() => document.querySelector("#loadError").textContent.length > 0);
    assert((await page.textContent("#loadError")).includes("do not match its fingerprint") && (await page.textContent("#run")).includes("block 140"), "a re-run plan that fails the fingerprint is refused, and the loaded plan kept");
    files["/plan.json"] = JSON.stringify(samplePlan());

    for (const [file, why, text] of [["plan-mainnet.json", "a plan for another chain (8453) is refused", "only signs on Base Sepolia"], ["plan-edited.json", "a plan edited after the script wrote it is refused", "do not match its fingerprint"]]) {
      await page.goto(`${origin}/?plan=${file}`);
      await page.waitForFunction(() => document.querySelector("#loadError").textContent.length > 0);
      assert((await page.textContent("#loadError")).includes(text) && (await page.isHidden("#app")), why);
    }
    for (const q of ["https://example.com/plan.json", "//example.com/plan.json"]) {
      await page.goto(`${origin}/?plan=${encodeURIComponent(q)}`);
      await page.waitForFunction(() => document.querySelector("#loadError").textContent.length > 0);
      assert((await page.textContent("#loadError")).includes("relative address"), `?plan= refuses an address on another site (${q})`);
    }

    // a stranger's account
    await page.goto(`${origin}/?plan=plan.json`);
    await page.waitForSelector("#stepList");
    await page.evaluate((a) => { window.__mock.state.account = a; }, STRANGER);
    await page.click("#wallet [data-connect]");
    await page.waitForSelector("#acctLabel");
    assert((await page.textContent("#acctLabel")) === "Not a signer in this plan", "an account the plan does not name is called that");

    for (const [i, file] of extra.entries()) {
      const real = JSON.parse(files[`/real-plan-${i}.json`]);
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      watch(ctx);
      await ctx.addInitScript(MOCK);
      const p = await ctx.newPage();
      p.on("pageerror", (e) => errors.push(String(e)));
      await p.goto(`${origin}/?plan=real-plan-${i}.json`);
      await p.waitForSelector("#stepList");
      await p.click('[data-f="all"]');
      assert((await p.locator("#stepList [data-step]").count()) === real.steps.length, `loads ${path.basename(file)} (chain ${real.chainId}, ${real.steps.length} steps)`);
      const safe = real.steps.find((s) => s.kind === "safe" && s.status === "ready" && s.data);
      if (safe) {
        await p.click(`#stepList [data-open="${safe.id}"]`);
        const [d] = await Promise.all([p.waitForEvent("download"), p.click("#panel [data-dl]")]);
        const b = JSON.parse(fs.readFileSync(await d.path(), "utf8"));
        assert(JSON.stringify(b.transactions) === JSON.stringify([{ to: safe.to, value: "0", data: safe.data }]), `its ready Safe step ${safe.id} downloads a batch with its to and data`);
        assert(real.chainId !== 84532 || (await p.getAttribute("#panel [data-safeapp]", "href")).includes(`basesep:${safe.signer}`), `and links the Safe app for ${safe.id}`);
        await p.keyboard.press("Escape");
      }
      const w = real.steps.find((s) => s.kind === "wallet" && s.status === "ready" && s.data);
      if (w) {
        await p.evaluate(([a, c]) => { window.__mock.state.account = a; window.__mock.state.chainId = c; }, [w.signer, "0x" + real.chainId.toString(16)]);
        await p.click("#wallet [data-connect]");
        await p.waitForSelector("#acctLabel");
        await p.click(`#stepList [data-open="${w.id}"]`);
        assert(!(await p.locator(sendBtn).isDisabled()), `its ready wallet step ${w.id} can be sent by ${w.signerLabel}`);
        await p.click(sendBtn);
        await p.waitForSelector("#txLink");
        const s2 = await p.evaluate(() => window.__mock.state.sent);
        assert(JSON.stringify(s2) === JSON.stringify([{ from: w.signer, to: w.to, data: w.data, value: "0x0" }]), `and the request is exactly ${w.id}'s from, to and data`);
      }
      await ctx.close();
    }

    // no MetaMask at all
    {
      const ctx = await browser.newContext();
      watch(ctx);
      const p = await ctx.newPage();
      p.on("pageerror", (e) => errors.push(String(e)));
      await p.goto(`${origin}/?plan=plan.json`);
      await p.waitForSelector("#wallet");
      assert((await p.textContent("#wallet")).includes("MetaMask was not found") && (await p.isDisabled("#wallet [data-connect]")), "without MetaMask the page says so plainly");
      await ctx.close();
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`${origin}/?plan=plan.json`);
    await page.waitForSelector("#stepList [data-step]");
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert((await overflow()) <= 0, "no sideways scroll at phone width");
    await page.click('#stepList [data-open="E8-earn-schedule"]');
    await page.waitForSelector("#panel .pn-ft");
    assert((await overflow()) <= 0 && (await page.$eval("#panel", (e) => e.scrollWidth <= e.clientWidth)), "nor with a step's panel open");

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
