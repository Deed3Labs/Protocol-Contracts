#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOWNLOAD_DIR="$ROOT_DIR/tools/op-stack/downloads"
BIN_DIR="$ROOT_DIR/tools/op-stack/bin"
VERSION="${OP_DEPLOYER_VERSION:-0.5.2}"
CHECKSUMS="op-deployer_${VERSION}_checksums.txt"
BASE_URL="https://github.com/ethereum-optimism/optimism/releases/download/op-deployer/v${VERSION}"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS/$ARCH" in
  Darwin/arm64)
    ARCHIVE="op-deployer-${VERSION}-darwin-arm64.tar.gz"
    EXTRACT_DIR="op-deployer-${VERSION}-darwin-arm64"
    ;;
  Darwin/x86_64)
    ARCHIVE="op-deployer-${VERSION}-darwin-amd64.tar.gz"
    EXTRACT_DIR="op-deployer-${VERSION}-darwin-amd64"
    ;;
  Linux/x86_64)
    ARCHIVE="op-deployer-${VERSION}-linux-amd64.tar.gz"
    EXTRACT_DIR="op-deployer-${VERSION}-linux-amd64"
    ;;
  Linux/aarch64|Linux/arm64)
    ARCHIVE="op-deployer-${VERSION}-linux-arm64.tar.gz"
    EXTRACT_DIR="op-deployer-${VERSION}-linux-arm64"
    ;;
  *)
    echo "Unsupported platform: $OS/$ARCH"
    exit 1
    ;;
esac

mkdir -p "$DOWNLOAD_DIR" "$BIN_DIR"

curl -sSL -o "$DOWNLOAD_DIR/$ARCHIVE" "$BASE_URL/$ARCHIVE"
curl -sSL -o "$DOWNLOAD_DIR/$CHECKSUMS" "$BASE_URL/$CHECKSUMS"

(
  cd "$DOWNLOAD_DIR"
  shasum -a 256 -c "$CHECKSUMS" 2>/dev/null | grep "${ARCHIVE}: OK"
)

rm -rf "$DOWNLOAD_DIR/$EXTRACT_DIR"
tar -xzf "$DOWNLOAD_DIR/$ARCHIVE" -C "$DOWNLOAD_DIR"
install -m 0755 "$DOWNLOAD_DIR/$EXTRACT_DIR/op-deployer" "$BIN_DIR/op-deployer"

"$BIN_DIR/op-deployer" --version
