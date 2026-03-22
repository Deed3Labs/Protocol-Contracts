#!/usr/bin/env sh
set -eu

DATA_DIR="${OP_GETH_DATADIR:-/data/op-geth-data}"
JWT_PATH="${OP_GETH_JWT_PATH:-/workspace/jwt.txt}"
GENESIS_PATH="${OP_GETH_GENESIS_PATH:-/workspace/genesis.json}"

if [ -z "${ENGINE_JWT_SECRET:-}" ]; then
  echo "ENGINE_JWT_SECRET is required"
  exit 1
fi

printf "%s" "${ENGINE_JWT_SECRET}" > "${JWT_PATH}"
chmod 600 "${JWT_PATH}"

if [ ! -d "${DATA_DIR}/geth/chaindata" ]; then
  echo "Initializing OP Geth data dir at ${DATA_DIR}"
  mkdir -p "${DATA_DIR}"
  geth init --state.scheme=hash --datadir="${DATA_DIR}" "${GENESIS_PATH}"
fi

exec geth \
  --datadir="${DATA_DIR}" \
  --http \
  --http.addr=0.0.0.0 \
  --http.port=8545 \
  --ws \
  --ws.addr=0.0.0.0 \
  --ws.port=8546 \
  --authrpc.addr=0.0.0.0 \
  --authrpc.port=8551 \
  --authrpc.jwtsecret="${JWT_PATH}" \
  --syncmode=full \
  --gcmode=archive \
  --rollup.disabletxpoolgossip=true \
  --http.vhosts='*' \
  --http.corsdomain='*' \
  --http.api=eth,net,web3,debug,txpool,admin \
  --ws.origins='*' \
  --ws.api=eth,net,web3,debug,txpool,admin \
  --authrpc.vhosts='*'
