#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

exec node --env-file=.env "$ROOT/scripts/ops/reset-sepolia-privacy-dev.mjs" "$@"
