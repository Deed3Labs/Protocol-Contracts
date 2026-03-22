#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$ROOT_DIR/tmp/hc002-services"
PID_FILE="$STATE_DIR/services.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "HC-002 services not running (no pid file)."
  exit 0
fi

PID="$(cat "$PID_FILE")"
if ps -p "$PID" >/dev/null 2>&1; then
  kill "$PID"
  sleep 1
  if ps -p "$PID" >/dev/null 2>&1; then
    kill -9 "$PID"
  fi
  echo "Stopped HC-002 services process (pid $PID)."
else
  echo "HC-002 services pid file existed but process was not running."
fi

rm -f "$PID_FILE"
