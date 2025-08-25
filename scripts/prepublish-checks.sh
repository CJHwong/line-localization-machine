#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

echo "[Checks] Ensuring DEBUG=false in shared/debug.js ..."
if grep -qE "const\s+DEBUG\s*=\s*true" shared/debug.js; then
  echo "ERROR: DEBUG must be set to false before publishing."
  exit 1
fi

echo "[Checks] Running lint and format checks..."
npm run lint
npm run format:check

echo "[Checks] Optionally run tests (set RUN_TESTS=1 to enable)"
if [[ "${RUN_TESTS:-0}" == "1" ]]; then
  npm run test:all
fi

echo "[Checks] All prepublish checks passed."
