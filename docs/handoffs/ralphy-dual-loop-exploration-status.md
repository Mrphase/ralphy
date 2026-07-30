# Ralphy Dual-Loop Exploration Mode — Implementation Status

Last updated: 2026-07-31 (Asia/Hong_Kong)

## Repository and branch

- Repository: `E:\Ecode\ralphy`
- Handoff branch: `codex/dual-loop-exploration`
- Remote intended for handoff: `mrphase`
- Recorded `FEATURE_BASE_COMMIT`:
  `044409450b63d1ccafe10460f83a74ebf4156d47`
- Current completed feature commit:
  `766f31530419c6108ba3c8cbf3cb3df5ec01df29`
- Dedicated worktree used during implementation:
  `E:\Ecode\ralphy\.ralphy-worktrees\codex-dual-loop-exploration`

The base worktree at `E:\Ecode\ralphy` must remain untouched. It contains an unrelated,
uncommitted change in `cli/src/engines/base.ts`:

```diff
- /^the predictive suggestion feature cannot be enabled\b/i,
+ /^(?:\|\s+)?the predictive suggestion feature cannot be enabled\b/i,
```

Do not reset, stash, commit, copy, or otherwise include that change in this feature.

## Source documents

- Full implementation plan:
  `docs/plans/ralphy-dual-loop-exploration-implementation-plan.md`
- Continuation prompt:
  `docs/handoffs/ralphy-dual-loop-exploration-continuation-prompt.md`

The plan is authoritative. Preserve its architecture and execute Tasks 1–10 in order with TDD and
one logical commit per task.

## Baseline verification

The feature worktree was created from the exact recorded base commit. The initial full suite was
not green before feature implementation:

- 166 tests passed.
- 5 tests failed.
- 1 load error was caused by the ignored generated `cli/src/version.ts`.

After running `bun run version:generate`, the load error was resolved. The remaining known baseline
failures were explicitly accepted by the user:

1. Three `ClaudeEngine` tests fail around the repository's current `claude-opus-4-7[1m]` model
   behavior.
2. One `CodexEngine` display-noise test fails because the required regex fix exists only as the
   unrelated uncommitted base-worktree change described above.
3. One Commander help test fails because terminal wrapping splits the expected `--prd` help text.

Do not repair or include these unrelated failures as part of the exploration feature.

The shared ignored `cli/node_modules` directory was restored with:

```powershell
npm install --no-package-lock
```

No source or lockfile changed. The installer reported two existing moderate dependency
vulnerabilities; no audit fix or dependency upgrade was run because it is outside this plan.

## Task 1 — complete

Task: Add pure baseline-gate and winner-selection functions.

Commit:

```text
766f31530419c6108ba3c8cbf3cb3df5ec01df29
feat: add strict baseline selection gate
```

Files:

- `cli/src/execution/selection.ts`
- `cli/src/execution/selection.test.ts`
- `cli/src/execution/index.ts`

Evidence:

- RED: focused test failed because `selection.ts` did not exist.
- GREEN: 7 passed, 0 failed, 11 assertions.
- Focused Biome check passed.
- Spec-compliance review: approved.
- Code-quality review: approved; no Critical or Important issues.

Two non-blocking review suggestions were recorded:

- Add minimize/pass-fail selector regression tests.
- Replace the internal `best.score as number` assertion with an explicitly tracked numeric
  `bestScore`.

These are optional hardening, not blockers. Do not amend Task 1 unless a later task genuinely needs
the adjustment; preserve one logical commit per planned task.

## Task 2 — next task, not yet implemented

Task 2 production code has not been changed.

A temporary optimize test was started, but its first executions were blocked by test-fixture setup
and the temporarily empty dependency directory. It never reached a valid feature RED. The temporary
untracked test was intentionally removed before this handoff so the next agent can restart Task 2
cleanly and preserve strict TDD evidence.

Read these files first:

- `cli/src/execution/selection.ts`
- `cli/src/execution/iterative-optimize.ts`
- `cli/src/execution/competition.ts`
- `cli/src/execution/evaluate.ts`
- `cli/src/git/merge.ts`
- `cli/src/git/worktree.ts`

Confirmed current mismatches:

- `iterative-optimize.ts` initializes `bestScore` to `null` and evaluates only after the first agent,
  so the first valid candidate is automatically accepted.
- `competition.ts` evaluates candidates without measuring the base before each round.
- `competition.ts` calls `mergeAgentBranch` with two arguments, while `merge.ts` requires:
  `mergeAgentBranch(branchName, targetBranch, workDir)`.

Recommended narrow dependency seams:

```ts
export interface OptimizeDependencies {
	evaluate: typeof runEvaluation;
}

export interface CompetitionDependencies {
	evaluate: typeof runEvaluation;
	selectBestImprovingCandidate: typeof selectBestImprovingCandidate;
	mergeAgentBranch: typeof mergeAgentBranch;
}
```

Do not inject or expose reset, clean, checkout, or other destructive Git operations through tests.

Task 2 TDD order:

1. Create `iterative-optimize.test.ts`.
2. In a temporary Git repository, create `.ralphy/` before invoking optimization and ignore it.
3. Confirm the test fails because baseline evaluation is absent, not because test setup is invalid.
4. Implement measured baseline initialization and candidate evaluation through the injected
   dependency.
5. Create `competition.test.ts`.
6. Confirm a below-baseline batch winner is currently merged or otherwise mishandled.
7. Apply `selectBestImprovingCandidate`, the three-argument merge call, no-winner discard behavior,
   and cleanup.
8. Run the exact focused tests and build check from the plan.
9. Commit with:
   `fix: gate optimization candidates against measured baseline`.

## Task 3 — analysis complete, implementation not started

Task 3 adds:

- `cli/src/execution/exploration/types.ts`
- `cli/src/execution/exploration/archive.ts`
- `cli/src/execution/exploration/archive.test.ts`
- `cli/src/execution/exploration/run-lock.ts`
- `cli/src/execution/exploration/run-lock.test.ts`

Important archive conclusions:

- Copy the complete Zod model from the plan.
- Add `superRefine` consistency for finalization outcomes and family-deferral acceptance.
- Validate and truncate before creating/opening the archive.
- Write `safeParse(...).data`, never the unvalidated input object.
- Invalid historical lines warn with line numbers and are skipped without exposing raw content.
- Causality validation must scan the complete archive before context filtering.
- The plan names but does not define `UnresolvedFinalization` and `EventCausalityAudit`; define the
  smallest exported shapes needed by later recovery reporting.

Important run-lock conclusions:

- Resolve `git rev-parse --git-common-dir` relative to the queried worktree, then canonicalize it.
- A linked worktree's `.git` is not the shared common directory.
- Use atomic `open(..., "wx")`.
- Release only when the on-disk token matches.
- Never infer staleness from age.
- Explicit recovery requires exact token, same host, and a PID positively confirmed dead.
- Recovery atomically renames the lock to a quarantine file and exits; it never deletes or continues
  exploration in the same invocation.
- On Windows, close handles before rename/unlink and treat `EPERM` as unverifiable, not dead.

## Process requirements for the next agent

1. Use `superpowers:executing-plans`.
2. Continue in a dedicated clean worktree.
3. Follow the full plan task-by-task.
4. For every behavior change: RED, verify expected failure, minimal GREEN, verify, commit.
5. Use one logical commit per task with the plan's exact commit message.
6. After each task, run independent spec-compliance and code-quality reviews.
7. Do not redesign the architecture.
8. Do not copy AERO source.
9. Do not publish packages.
10. Do not use destructive operations on the base worktree.
11. Do not touch lockfiles, PRDs, progress files, or the unrelated `base.ts` modification.
12. If a real repository mismatch blocks a stated step, pause and report concrete evidence.

## Current continuation point

Start at Task 2, Step 1. Task 1 is complete and reviewed. Task 2 and later tasks remain.
