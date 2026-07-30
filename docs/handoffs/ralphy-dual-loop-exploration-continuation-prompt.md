Implement the Ralphy Dual-Loop Exploration Mode plan from the existing handoff branch.

Repository and branch:

- Repository: `E:\Ecode\ralphy`
- Branch: `codex/dual-loop-exploration`
- Remote branch: `mrphase/codex/dual-loop-exploration`
- Feature base: `044409450b63d1ccafe10460f83a74ebf4156d47`

First read these files completely:

1. `docs/plans/ralphy-dual-loop-exploration-implementation-plan.md`
2. `docs/handoffs/ralphy-dual-loop-exploration-status.md`
3. `CLAUDE.md`
4. `cli/src/execution/selection.ts`
5. `cli/src/execution/iterative-optimize.ts`
6. `cli/src/execution/competition.ts`
7. `cli/src/execution/evaluate.ts`
8. `cli/src/git/merge.ts`
9. `cli/src/git/worktree.ts`

Use `superpowers:executing-plans`.

Continue from Task 2, Step 1. Task 1 is already complete, independently reviewed, and committed as
`766f31530419c6108ba3c8cbf3cb3df5ec01df29`. Do not redo or amend it.

Requirements:

- Work in a dedicated clean worktree based on `codex/dual-loop-exploration`.
- Execute Tasks 2–10 in the plan's exact order.
- Follow strict TDD for every task: write the test, run it, confirm the expected behavioral failure,
  implement the minimum change, rerun, then commit.
- Use one logical commit per task and the plan's specified commit messages.
- Run a spec-compliance review and a code-quality review after every task.
- Do not redesign the architecture, copy AERO source, publish packages, or use destructive
  operations on the base worktree.
- Do not change lockfiles, PRDs, progress files, or unrelated code.
- The base worktree has an unrelated uncommitted change in `cli/src/engines/base.ts`. Never reset,
  stash, commit, copy, or include it.
- The five known baseline test failures listed in the status document are accepted pre-existing
  failures. Do not fix them as part of this feature.
- Pause and report concrete evidence only when a genuine repository mismatch blocks a planned step.

Task 2 must:

- Inject only narrow evaluation/selection/merge dependencies.
- Evaluate unchanged HEAD before the first optimize agent call.
- Evaluate the base before every competition round.
- Reject candidates that do not strictly beat the measured baseline.
- Call `mergeAgentBranch(winner.branchName, baseBranch, workDir)`.
- Keep destructive Git operations out of test dependency seams.
- Use temporary Git repositories for tests.

After Task 2 passes and is committed, continue with Task 3 using the archive and run-lock guidance in
the status document, then proceed through Tasks 4–10 and the final verification exactly as written in
the plan.
