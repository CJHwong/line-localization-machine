#!/usr/bin/env bash
set -euo pipefail

# Package the extension for Firefox Add-ons as a zip

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

PACKAGE_DIR="$ROOT_DIR/dist/firefox"
ZIP_NAME="line-localization-machine-firefox.zip"

echo "[Firefox] Preparing package directory..."
rm -rf "$PACKAGE_DIR" "$ROOT_DIR/$ZIP_NAME"
mkdir -p "$PACKAGE_DIR"

echo "[Firefox] Copying extension files..."
cp -R assets background content popup settings shared "$PACKAGE_DIR/"
cp manifest.json "$PACKAGE_DIR/"

MANIFEST="$PACKAGE_DIR/manifest.json"

echo "[Firefox] Adjusting manifest for Firefox (remove service_worker)..."
# Remove the service_worker line if present (Firefox uses background.scripts for MV3 polyfill here)
sed -i.bak '/"service_worker"/d' "$MANIFEST" || true
rm -f "$MANIFEST.bak"

echo "[Firefox] Creating zip archive: $ZIP_NAME"
(
  cd "$PACKAGE_DIR"
  zip -r -q "../$ZIP_NAME" .
)

echo "[Firefox] Cleaning up temporary directory..."
rm -rf "$PACKAGE_DIR"

echo "[Firefox] Done: $ROOT_DIR/$ZIP_NAME"
