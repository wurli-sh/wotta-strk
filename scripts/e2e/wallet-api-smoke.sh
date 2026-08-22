#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

echo "=== wotta smoke:wallet-api ==="
command -v node >/dev/null || { echo "node required"; exit 1; }

node "$ROOT/packages/shared/scripts/wallet-api-smoke.mjs"
