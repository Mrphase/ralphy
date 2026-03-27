# Ralphy WSL + Codex Guide

This guide is for running the cloned repo from WSL at `/mnt/e/Ecode/ralphy`, with Ralphy calling the `codex` CLI inside WSL.

## 1. Prerequisites

Open a WSL shell and verify the basics:

```bash
uname -a
cat /etc/os-release | sed -n '1,6p'
command -v codex
codex --version
```

Expected baseline:

- WSL2
- Ubuntu
- A working `codex` CLI login in WSL

If `codex --version` fails, fix Codex CLI in WSL before continuing.

## 2. Go To The Repo

```bash
cd /mnt/e/Ecode/ralphy
pwd
```

Expected path:

```text
/mnt/e/Ecode/ralphy
```

## 3. Install Linux Node.js and Repair the WSL Codex Wrapper

Run the repo-local setup helper:

```bash
cd /mnt/e/Ecode/ralphy
./wsl_setup_codex.sh
```

What it does:

- verifies you are on Ubuntu inside WSL
- installs Linux `nodejs` and `npm` via `apt`
- verifies that `node` and `npm` resolve to Linux paths, not `/mnt/c/...`
- imports Windows Codex file-store auth into `~/.codex/` when available and missing in WSL
- checks `codex`
- if `~/.local/lib/codex-linux/codex-x86_64-unknown-linux-musl` exists, rewrites `~/.local/bin/codex` to use that native Linux binary

## 4. Verify Linux Node.js and Codex

```bash
command -v node
node --version
command -v npm
npm --version
command -v codex
codex --version
```

Expected result:

- `node` resolves to `/usr/bin/node`
- `npm` resolves to `/usr/bin/npm`
- `codex` still works

If `~/.local/lib/codex-linux/codex-x86_64-unknown-linux-musl` exists, verify the wrapper no longer points to Windows Node:

```bash
sed -n '1,40p' ~/.local/bin/codex
```

The wrapper should execute the native Linux binary, not `/mnt/c/Program Files/nodejs/node.exe`.

## 5. Install Ralphy CLI Dependencies

```bash
cd /mnt/e/Ecode/ralphy/cli
npm install --no-package-lock
cd /mnt/e/Ecode/ralphy
```

Notes:

- `cli/package-lock.json` is ignored by the repo, so this remains local.
- `cli/src/version.ts` is generated locally on first source run if missing.
- WSL local-clone mode uses the Node/TS CLI path, not the legacy `ralphy.sh` script.

## 6. Verify the WSL Launcher

Use the repo-local WSL wrapper:

```bash
cd /mnt/e/Ecode/ralphy
./ralphy-wsl.sh --help
```

If help prints, the local WSL launcher is working.

## 7. Verify Codex Through Ralphy

Run a safe smoke test first:

```bash
cd /mnt/e/Ecode/ralphy
./ralphy-wsl.sh --codex --no-tests --no-lint --no-commit "Reply with exactly OK. Do not use any tools. Do not modify any files."
```

Expected result:

- Ralphy starts normally
- Engine shows `Codex`
- Final response is `OK`

## 8. Initialize Project Config

```bash
cd /mnt/e/Ecode/ralphy
./ralphy-wsl.sh --init
./ralphy-wsl.sh --config
```

Add project-wide rules if needed:

```bash
./ralphy-wsl.sh --add-rule "prefer small focused changes"
./ralphy-wsl.sh --add-rule "run tests before finishing"
```

## 9. Run Single-Task Mode

```bash
cd /mnt/e/Ecode/ralphy
./ralphy-wsl.sh --codex "add a WSL troubleshooting section to the README"
```

Useful flags:

- `--no-tests`
- `--no-lint`
- `--no-commit`
- `--model <name>`
- `--` for direct Codex CLI arguments

Example:

```bash
./ralphy-wsl.sh --codex --model gpt-5.4 "summarize the repo structure" -- --profile default
```

## 10. Run PRD Mode

Use the included example PRD:

```bash
cd /mnt/e/Ecode/ralphy
./ralphy-wsl.sh --codex --prd ./example-prd.md --no-commit
```

## 11. Why WSL Uses `ralphy-wsl.sh`

The repo still contains `ralphy.sh`, but WSL quickstart uses `ralphy-wsl.sh` because:

- it runs the maintained Node/TS CLI entrypoint
- it stays aligned with the npm package path
- it reuses the same Windows compatibility fixes already added in `cli/bin.js`

`ralphy.sh` remains available, but it is not the recommended WSL local-clone path in this adaptation.

## 12. Troubleshooting

`node` still points into `/mnt/c/`:

```bash
command -v node
command -v npm
```

Re-run:

```bash
cd /mnt/e/Ecode/ralphy
./wsl_setup_codex.sh
```

Then open a fresh shell and check again.

`codex` still points to Windows Node:

```bash
sed -n '1,40p' ~/.local/bin/codex
```

If the native Linux Codex binary exists, rerun `./wsl_setup_codex.sh`.

Native Codex returns `401 Unauthorized` or says authentication is missing:

- rerun `./wsl_setup_codex.sh` to import Windows file-store auth when available
- or run `codex login` directly inside WSL

WSL prints:

```text
wsl: A localhost proxy configuration was detected but not mirrored into WSL
```

That warning comes from WSL NAT/proxy behavior. It does not mean Ralphy is broken. This setup does not hardcode a proxy. Only configure a proxy if your network actually requires one.

Codex prints plugin sync `403 Forbidden` warnings:

- These warnings were observed during validation.
- They did not block `codex exec` or Ralphy smoke tests.
- Treat them as non-fatal unless your actual command fails.

`./ralphy-wsl.sh` says Node.js is required:

- Linux Node.js is still missing from WSL
- Run `./wsl_setup_codex.sh` first
