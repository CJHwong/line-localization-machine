#!/usr/bin/env bash
set -euo pipefail

# Package the extension for Chrome Web Store as a zip

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

PACKAGE_DIR="$ROOT_DIR/dist/chrome"
ZIP_NAME="line-localization-machine-chrome.zip"

echo "[Chrome] Preparing package directory..."
rm -rf "$PACKAGE_DIR" "$ROOT_DIR/$ZIP_NAME"
mkdir -p "$PACKAGE_DIR"

echo "[Chrome] Copying extension files..."
cp -R assets background content popup settings shared "$PACKAGE_DIR/"
cp manifest.json "$PACKAGE_DIR/"

echo "[Chrome] Creating zip archive: $ZIP_NAME"
(
  cd "$PACKAGE_DIR"
  zip -r -q "../$ZIP_NAME" .
)

echo "[Chrome] Cleaning up temporary directory..."
rm -rf "$PACKAGE_DIR"

echo "[Chrome] Done: $ROOT_DIR/$ZIP_NAME"
