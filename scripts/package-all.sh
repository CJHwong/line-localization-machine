#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$SCRIPT_DIR/package-chrome.sh"
"$SCRIPT_DIR/package-firefox.sh"

echo "All packages created."
