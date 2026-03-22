#!/usr/bin/env sh
set -eu

JWT_PATH="${OP_NODE_JWT_PATH:-/workspace/jwt.txt}"
ROLLUP_PATH="${OP_NODE_ROLLUP_PATH:-/workspace/rollup.json}"
L2_ENGINE_RPC_URL="${L2_ENGINE_RPC_URL:-http://clear-op-geth.railway.internal:8551}"

: "${L1_RPC_URL:?L1_RPC_URL is required}"
: "${L1_BEACON_URL:?L1_BEACON_URL is required}"
: "${ENGINE_JWT_SECRET:?ENGINE_JWT_SECRET is required}"

printf "%s" "${ENGINE_JWT_SECRET}" > "${JWT_PATH}"
chmod 600 "${JWT_PATH}"

exec op-node \
  --l1="${L1_RPC_URL}" \
  --l1.beacon="${L1_BEACON_URL}" \
  --l2="${L2_ENGINE_RPC_URL}" \
  --l2.jwt-secret="${JWT_PATH}" \
  --rollup.config="${ROLLUP_PATH}" \
  --sequencer.enabled=true \
  --sequencer.stopped=false \
  --sequencer.max-safe-lag="${SEQUENCER_MAX_SAFE_LAG:-3600}" \
  --verifier.l1-confs="${VERIFIER_L1_CONFS:-4}" \
  --p2p.disable \
  --rpc.addr=0.0.0.0 \
  --rpc.port=8547 \
  --rpc.enable-admin \
  --log.level="${OP_NODE_LOG_LEVEL:-info}" \
  --log.format=json
