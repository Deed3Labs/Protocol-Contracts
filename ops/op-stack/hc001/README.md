# HC-001 OP Stack Bootstrap (Phase 0)

This folder contains the frozen HC-001 inputs for launching the Clear OP Stack testnet.

## Scope

1. Lock chain IDs and standard rollup settings.
2. Provide a reproducible `op-deployer` starting point for HC-002.

## Files

1. `chain-config-freeze.yaml` - frozen parameters and constraints.
2. `intent.template.toml` - template for `.deployer/intent.toml`.
3. `.env.example` - template environment variables for deployment.

## Execute with op-deployer

1. Install `op-deployer` from the Optimism release page.
2. Create working directory:

```bash
mkdir -p rollup/deployer
cd rollup/deployer
```

3. Initialize intent:

```bash
op-deployer init \
  --l1-chain-id 11155111 \
  --l2-chain-ids 92373 \
  --workdir .deployer \
  --intent-type standard-overrides
```

4. Copy values from this folder into `.deployer/intent.toml`.
5. Create `.env` from `.env.example`, then load:

```bash
source .env
```

6. Apply deployment:

```bash
op-deployer apply \
  --workdir .deployer \
  --l1-rpc-url "$L1_RPC_URL" \
  --private-key "$PRIVATE_KEY"
```

7. Generate chain artifacts:

```bash
op-deployer inspect genesis --workdir .deployer 92373 > .deployer/genesis.json
op-deployer inspect rollup --workdir .deployer 92373 > .deployer/rollup.json
```

## Local validation

From repository root:

```bash
npm run hc001:validate
```

This verifies HC-001 freeze values and checks that plan status is no longer `Not Started`.
