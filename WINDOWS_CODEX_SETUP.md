# Ralphy Windows + Codex Guide

This guide is for running the cloned repo at `E:\Ecode\ralphy` on Windows, with `Ralphy` calling the installed `codex` CLI.

## 1. Prerequisites

Open PowerShell and make sure these commands work:

```powershell
git --version
node --version
npm --version
codex --version
codex exec --help
```

Recommended versions:

- Node.js 18+
- npm 9+
- A working `codex` CLI login

If `codex --version` fails, install or fix Codex CLI first before using Ralphy.

## 2. Clone Into `E:\Ecode`

```powershell
git clone https://github.com/michaelshimeles/ralphy.git E:\Ecode\ralphy
cd E:\Ecode\ralphy
```

## 3. Install CLI Dependencies

Ralphy's source launcher needs the `cli` dependencies when you run from the cloned repo.

```powershell
cd E:\Ecode\ralphy\cli
npm install --no-package-lock
cd E:\Ecode\ralphy
```

Notes:

- `cli\package-lock.json` is ignored by the repo, so this install stays local.
- The first source run auto-generates `cli\src\version.ts`.
- If no compiled Windows binary exists, the launcher falls back to `tsx` or `npx tsx`.

## 4. Verify the Local Launchers

PowerShell entry:

```powershell
cd E:\Ecode\ralphy
.\ralphy.ps1 --help
```

CMD entry:

```powershell
cd E:\Ecode\ralphy
cmd /c ralphy.cmd --help
```

If either command prints help, the local repo launcher is working.

## 5. Verify Codex Through Ralphy

Run a safe single-task test first:

```powershell
cd E:\Ecode\ralphy
.\ralphy.ps1 --codex --no-tests --no-lint --no-commit "Read cli/package.json and answer with only the package name. Do not modify any files."
```

Expected result:

- Ralphy starts normally
- Engine shows `Codex`
- The task returns a short text answer
- No commit is created because `--no-commit` is set

## 6. Initialize Project Config

This creates `.ralphy\config.yaml` for the repo.

```powershell
cd E:\Ecode\ralphy
.\ralphy.ps1 --init
.\ralphy.ps1 --config
```

After that, add any project rules you want:

```powershell
.\ralphy.ps1 --add-rule "prefer small focused changes"
.\ralphy.ps1 --add-rule "run tests before finishing"
```

Knowledge files created by `--init`:

- `.ralphy\config.yaml`
- `.ralphy\progress.txt`
- `.ralphy\progress.md`
- `.ralphy\AGENTS.md`

Inspect them with:

```powershell
.\ralphy.ps1 knowledge show
```

Reset them with:

```powershell
.\ralphy.ps1 knowledge reset
```

## 7. Run Single-Task Mode With Codex

Example:

```powershell
cd E:\Ecode\ralphy
.\ralphy.ps1 --codex "add a Windows troubleshooting section to the README"
```

Useful flags:

- `--no-tests` skips test commands
- `--no-lint` skips lint commands
- `--no-commit` prevents auto-commit
- `--model <name>` overrides the Codex model
- `--` passes extra flags directly to the underlying `codex` CLI

Example with direct Codex flags:

```powershell
.\ralphy.ps1 --codex --model gpt-5.5 "summarize the repo structure" -- --profile default
```

To inspect the next prompt without executing the task:

```powershell
.\ralphy.ps1 --codex --dry-run --no-tests --no-lint "do not make changes"
```

After you have at least one learning entry in `.ralphy\progress.md`, the dry-run prompt should include:

- `## Agent Instructions`
- `## Recent Task Learnings`

## 8. Run PRD Mode With Codex

The repo already includes [`example-prd.md`](./example-prd.md) and [`example-prd.yaml`](./example-prd.yaml).

Use `--prd` for Markdown PRDs only. If the file ends with `.yaml` or `.yml`, run it with `--yaml`.

Markdown example:

```powershell
cd E:\Ecode\ralphy
.\ralphy.ps1 --codex --prd .\example-prd.md --no-commit
```

YAML example:

```powershell
cd E:\Ecode\ralphy
.\ralphy.ps1 --codex --yaml .\example-prd.yaml --no-commit
```

Ralphy will:

1. Read the task list from the PRD
2. Pick the next unfinished task
3. Run Codex on that task
4. Mark completed items as done

## 9. Use the CMD Wrapper If PowerShell Is Blocked

If your PowerShell execution policy blocks `.ps1` files, use:

```powershell
cd E:\Ecode\ralphy
cmd /c ralphy.cmd --help
cmd /c ralphy.cmd --codex "summarize this repository"
```

For a full learning-oriented knowledge-transfer walkthrough, see [KNOWLEDGE_TRANSFER_GUIDE.md](./KNOWLEDGE_TRANSFER_GUIDE.md).

## 10. Troubleshooting

`node` not found:

```powershell
node --version
```

Install Node.js, then reopen the terminal.

`codex` not found:

```powershell
codex --version
```

Fix Codex CLI installation or PATH first.

`Binary not found: ... ralphy-windows-x64.exe`:

- This is normal for a fresh clone.
- The launcher should fall back to the source path after `npm install --no-package-lock`.

`ERR_MODULE_NOT_FOUND` for `src/version.ts`:

- Re-run `.\ralphy.ps1 --help`
- The launcher now auto-generates that file on first source run

`git` says `dubious ownership`:

```powershell
git config --global --add safe.directory E:/Ecode/ralphy
```

Only do this if Git explicitly shows that warning for this repo.
