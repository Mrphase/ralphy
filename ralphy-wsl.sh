#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required in WSL. Run ./wsl_setup_codex.sh first." >&2
  exit 1
fi

exec node "$REPO_ROOT/cli/bin.js" "$@"
