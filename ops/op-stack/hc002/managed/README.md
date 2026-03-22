# HC-002 Managed Hosted Prep (Clear Testnet)

This directory contains hosted-infra preparation artifacts for `HC-002`:

1. Service blueprint (`clear-testnet.service-blueprint.yaml`)
2. Hosted environment template (`clear-testnet.hosted.env.example`)
3. Railway deployment runbook (`railway/README.md`)
4. Railway service manifest (`railway/railway.service-host.json`)

## Goal

Provide a deployment-ready service inventory for running Clear Testnet in managed infrastructure with:

1. Public RPC
2. Explorer
3. Faucet
4. Bridge UI

## Usage

1. Fill `clear-testnet.hosted.env.example` into your provider secret store.
2. Map each service in `clear-testnet.service-blueprint.yaml` to your runtime platform (Kubernetes, ECS, Railway, Render, etc.).
3. Expose only public ingress targets listed under `publicIngress`.
4. Keep signer keys and RPC credentials in secrets manager, never in Git.
