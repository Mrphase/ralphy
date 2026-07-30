# Ralphy Dual-Loop Exploration — next-agent handoff (2026-07-31)

## Start here

1. Read `docs/plans/ralphy-dual-loop-exploration-implementation-plan.md` in full.
2. Read this document, then the earlier `docs/handoffs/ralphy-dual-loop-exploration-status.md` and `docs/handoffs/ralphy-dual-loop-exploration-continuation-prompt.md`.
3. Work only in the isolated worktree and branch below. Do not alter the base worktree.
4. Continue with Task 5, in order, using TDD and one logical commit per plan task.

## Repository state

- Repository: `E:\\Ecode\\ralphy`
- Isolated worktree: `E:\\Ecode\\ralphy\\.ralphy-worktrees\\codex-dual-loop-exploration`
- Branch: `codex/dual-loop-exploration`
- Remote: `mrphase`
- Base worktree warning: `E:\\Ecode\\ralphy\\cli\\src\\engines\\base.ts` has unrelated user-owned changes. Never reset, stash, commit, copy, or otherwise modify them.

## Completed and committed

1. `766f315` — `feat: add strict baseline selection gate` (Task 1)
2. `e028f64` — `docs: add dual-loop exploration handoff`
3. `e0340c8` — `fix: gate optimization candidates against measured baseline` (Task 2)
4. `9a2ebc8` — `feat: add persistent exploration event archive` (Task 3)
5. `0f189b0` — `feat: add deterministic exploration portfolio policy` (Task 4)

Task 4 introduces only:

- `cli/src/execution/exploration/policy.ts`
- `cli/src/execution/exploration/policy.test.ts`

It implements the eight plan-prescribed policy exports: deterministic family state/debt/portfolio policy, context fingerprinting and deferral activation, Unicode-aware similarity and diagnostics, saturation unlock history, and inventory-backed safe glob validation.

## Task 4 verification evidence

Run from `cli` in the isolated worktree:

```powershell
bunx biome check .\\src\\execution\\exploration\\policy.ts .\\src\\execution\\exploration\\policy.test.ts
bun test .\\src\\execution\\exploration\\policy.test.ts
bun run build:windows-x64
```

Last verified on 2026-07-31:

- Biome: clean.
- Focused policy suite: 35 passed, 0 failed, 70 assertions.
- Windows native build: succeeded (263 modules).

`bunx tsc --noEmit --pretty false` remains non-zero because of pre-existing repository-wide errors in unrelated command, Claude-engine, competition, archive-test, run-lock-test, iterative-optimize, and telemetry files. The final check emitted no `src/execution/exploration/policy.ts` error. Do not fix those baseline errors as part of this plan without a new request.

The cross-platform `bun run build` baseline remains blocked by Bun attempting to acquire the macOS-arm artifact on Windows. Use the plan-compatible native check above unless the environment issue is explicitly in scope.

## Task 4 review decisions already made

- A stagnating or saturated incumbent is excluded from replacement challenger selection.
- A successful application clears saturation only through a fully consistent intent/selection/result causal chain and an experiment that matches its selected score and commit.
- Saturation unlock compares only archived, qualified failed proposals in that family. Rejected portfolio history participates only in duplicate detection.
- `**` and `*` matching use dynamic programming, not backtracking regular expressions.
- The deferral-request parser and its mechanical rejection rules are intentionally Task 5 work, as specified by the plan.

## Next task: Task 5

Implement Task 5 exactly as written before beginning Task 6:

- Create `cli/src/execution/exploration/prompts.ts` and `prompts.test.ts`.
- Modify `cli/src/execution/prompt.ts` and `prompt.test.ts`.
- Start with the required failing tests, especially `parseDeferralRequest` rejecting duplicate, exploit/adjacent, credited, saturated, active-deferred, and unassigned-family requests.
- Preserve the Task 4 controller-assigned requirements; do not redesign the architecture or add embedding/AERO dependencies.
- Use the same native Windows build verification after the focused test suite passes.

Before committing each next task, run the focused tests, Biome on changed files, `bun run build:windows-x64`, and `git diff --check`; obtain a read-only spec/quality review when practical.
