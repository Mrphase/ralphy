#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[wsl-setup] %s\n' "$*"
}

fail() {
  printf '[wsl-setup] ERROR: %s\n' "$*" >&2
  exit 1
}

get_windows_codex_dir() {
  if ! command -v cmd.exe >/dev/null 2>&1 || ! command -v wslpath >/dev/null 2>&1; then
    return 1
  fi

  local windows_profile_raw
  windows_profile_raw="$(cmd.exe /c "echo %UserProfile%" 2>/dev/null | tr -d '\r')"
  [[ -n "$windows_profile_raw" ]] || return 1

  local windows_profile_wsl
  windows_profile_wsl="$(wslpath "$windows_profile_raw" 2>/dev/null)" || return 1
  printf '%s/.codex' "$windows_profile_wsl"
}

if [[ -z "${WSL_DISTRO_NAME:-}" ]] && ! grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
  fail "This script must be run inside WSL."
fi

if [[ ! -f /etc/os-release ]] || ! grep -qi '^ID=ubuntu' /etc/os-release; then
  fail "This setup helper currently supports Ubuntu on WSL."
fi

if ! command -v sudo >/dev/null 2>&1; then
  fail "sudo is required."
fi

log "Installing Linux nodejs and npm with apt-get..."
sudo env DEBIAN_FRONTEND=noninteractive apt-get update
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs npm
hash -r

NODE_PATH="$(command -v node || true)"
NPM_PATH="$(command -v npm || true)"

[[ -n "$NODE_PATH" ]] || fail "node was not installed successfully."
[[ -n "$NPM_PATH" ]] || fail "npm was not installed successfully."

if [[ "$NODE_PATH" == /mnt/* ]]; then
  fail "node still resolves to a Windows path: $NODE_PATH"
fi

if [[ "$NPM_PATH" == /mnt/* ]]; then
  fail "npm still resolves to a Windows path: $NPM_PATH"
fi

log "node -> $NODE_PATH"
log "npm  -> $NPM_PATH"

WSL_CODEX_DIR="$HOME/.codex"
WINDOWS_CODEX_DIR="$(get_windows_codex_dir || true)"

mkdir -p "$WSL_CODEX_DIR"

if [[ -n "$WINDOWS_CODEX_DIR" ]]; then
  if [[ -f "$WINDOWS_CODEX_DIR/config.toml" ]] && [[ ! -f "$WSL_CODEX_DIR/config.toml" ]]; then
    log "Importing Codex config from Windows file-store auth setup..."
    cp "$WINDOWS_CODEX_DIR/config.toml" "$WSL_CODEX_DIR/config.toml"
    chmod 600 "$WSL_CODEX_DIR/config.toml"
  fi

  if [[ -f "$WINDOWS_CODEX_DIR/auth.json" ]] && [[ ! -f "$WSL_CODEX_DIR/auth.json" ]]; then
    log "Importing Codex auth.json from Windows file-store auth setup..."
    cp "$WINDOWS_CODEX_DIR/auth.json" "$WSL_CODEX_DIR/auth.json"
    chmod 600 "$WSL_CODEX_DIR/auth.json"
  fi
fi

if ! command -v codex >/dev/null 2>&1; then
  fail "codex CLI is not available in WSL."
fi

CODEX_WRAPPER="$HOME/.local/bin/codex"
NATIVE_CODEX_BIN="$HOME/.local/lib/codex-linux/codex-x86_64-unknown-linux-musl"

if [[ -x "$NATIVE_CODEX_BIN" ]]; then
  log "Switching codex wrapper to the native Linux binary..."
  mkdir -p "$(dirname "$CODEX_WRAPPER")"
  cat > "$CODEX_WRAPPER" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec "$HOME/.local/lib/codex-linux/codex-x86_64-unknown-linux-musl" "$@"
EOF
  chmod +x "$CODEX_WRAPPER"
else
  log "Native Linux Codex binary not found at $NATIVE_CODEX_BIN; leaving current codex wrapper unchanged."
fi

CODEX_PATH="$(command -v codex || true)"
[[ -n "$CODEX_PATH" ]] || fail "codex disappeared from PATH after setup."

log "codex -> $CODEX_PATH"
codex --version

if [[ -x "$NATIVE_CODEX_BIN" ]] && grep -q '/mnt/c/Program Files/nodejs/node.exe' "$CODEX_WRAPPER" 2>/dev/null; then
  fail "codex wrapper still points to the Windows Node.js path."
fi

log "WSL setup complete."
log "Next steps:"
log "  cd /mnt/e/Ecode/ralphy/cli && npm install --no-package-lock"
log "  cd /mnt/e/Ecode/ralphy && ./ralphy-wsl.sh --help"
