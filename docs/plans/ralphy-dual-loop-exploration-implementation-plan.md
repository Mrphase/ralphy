# Ralphy Dual-Loop Exploration Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Add an explicit `--explore` mode to Ralphy that uses an outer exploration director to force materially different algorithmic strategies and an inner execution loop to implement, evaluate, archive, and safely select candidates.

**Architecture:** The outer loop creates structured strategy cards from the task, baseline, repository inventory, coverage debt, and experiment archive; deterministic validation rejects repeated, saturated, or insufficiently distinct strategies before any coding begins. All advisor calls—applicability, deferral review, proposal generation, and critic—run in disposable detached worktrees so they cannot accidentally edit the base branch. The inner loop assigns one validated card to each isolated candidate worktree, then enforces protected-path and strategy-route gates before committing or evaluating. The external evaluation command is the only authority for correctness/performance, while a fresh-context critic may withhold exploration qualification from a semantically duplicated or off-strategy patch. A merge requires both deterministic improvement and exploration qualification; the critic can veto qualification but can never authorize a merge by itself.

**Tech Stack:** TypeScript strict mode, Bun, Commander, Zod, simple-git, existing Ralphy AI-engine abstraction and worktree utilities.

---

## Execution contract

Repository: `E:\Ecode\ralphy`

Work in a dedicated git worktree. Do not implement directly on a dirty main working tree.

Current-state note from plan creation: `cli/src/engines/base.ts` had an unrelated, uncommitted
one-line change to a display-noise regular expression. Preserve it. Do not reset, stash, commit, or
include it in this feature without the user's explicit direction. Create the feature branch/worktree
from the current committed HEAD, leaving that dirty main worktree untouched. Pause for the user only
if implementation genuinely must edit `cli/src/engines/base.ts` or cannot create the isolated
worktree without affecting the existing change.

Before creating the feature branch, record the exact `git rev-parse HEAD` value as
`FEATURE_BASE_COMMIT` in the implementation notes. The final diff must be checked against that SHA.

This plan defines one recommended design. Do not replace it with a new architecture before implementation. If a code-level mismatch is discovered, document the mismatch and make the smallest adjustment that preserves these invariants:

1. The outer loop controls which strategy is attempted next.
2. Different workers receive mechanically distinct strategy cards, not the same generic task.
3. Every run starts from a measured, unchanged baseline.
4. Deterministic evaluation is necessary for merging; an LLM can never make a failing candidate
   acceptable.
5. Failed and rejected strategies remain in the archive.
6. An LLM critic may withhold exploration qualification, but may never override a failed
   correctness/performance or mechanical gate.
7. Main-worktree changes are never discarded with `git reset --hard` or `git clean`.
8. Existing `--optimize` and `--compete` commands remain available.
9. Director, deferral-review, and critic processes never run in the base working directory.
10. A worker patch is not committed or evaluated until protected-path and assigned-route checks pass.
11. In-repository evaluation-harness files are protected from candidates and fingerprinted into the
    evaluation context so score semantics cannot change silently.

Follow TDD for every task. Run the focused test after writing it, confirm that it fails for the expected reason, implement the minimum behavior, rerun it, then commit that logical change.

## User-visible behavior

New command:

```powershell
ralphy --explore --evaluate "python bench.py" "optimize the routing algorithm"
```

New options:

```text
--explore                   Run dual-loop strategy exploration
--explore-agents <n>        Candidate strategies per round; default 3
--explore-rounds <n>        Maximum exploration rounds; default 5
--explore-stagnation <n>    Threshold for exploit removal and qualified family saturation; default 2
--explore-recover-lock <t>  Quarantine a confirmed-dead repository explore lock, then exit
```

Existing options reused:

```text
--evaluate <script>
--metric-objective <maximize|minimize|pass-fail>
--model <model>
--effort <level>
-- <engine-specific args...>
--max-retries <n>
--retry-delay <seconds>
```

Modes `--explore`, `--optimize`, `--compete`, and `--parallel` are mutually exclusive. `--goal` remains disabled outside sequential mode, matching current behavior.
Version 1 rejects `--explore --dry-run` rather than silently performing commits under a global
“do not execute” flag.
`--explore-recover-lock` is a maintenance operation: it is mutually exclusive with execution modes,
does not require a task or evaluator, requires the exact displayed owner token, and never starts an
exploration run in the same invocation.

Persistent output:

```text
.ralphy/explore-history.jsonl
```

The file is append-only and is always added to agent boundaries. It records baseline,
family-deferral, portfolio-adjustment/rejection, explicit exploration-terminal, experiment,
round-review, round-finalization-intent, selection-intent, and round-finalization-result events.
Rejected proposals plus rejected/crashed candidates must be recorded before retry or cleanup.

## Non-goals for version 1

- Do not train or fine-tune model weights.
- Do not copy AERO source code.
- Do not add embeddings or a vector database.
- Do not let an LLM score correctness or authorize merges.
- Do not preserve losing branches indefinitely.
- Do not add a general workflow DSL.
- Do not redesign sequential or parallel PRD execution.
- Do not implement arbitrary multi-objective Pareto optimization. The external evaluation command remains the source of the primary scalar score and must enforce correctness through its exit code.

## Core data model

Create these types in `cli/src/execution/exploration/types.ts`:

```ts
import { z } from "zod";

export const STRATEGY_FAMILIES = [
	"algorithm",
	"data-structure",
	"memory-layout",
	"caching",
	"pruning",
	"parallelism",
	"precomputation",
	"decomposition",
	"approximation",
	"numerical",
	"runtime",
	"other",
] as const;

export const strategyFamilySchema = z.enum(STRATEGY_FAMILIES);
export type StrategyFamily = z.infer<typeof strategyFamilySchema>;

export const strategySlotSchema = z.enum(["exploit", "adjacent", "challenger"]);
export type StrategySlot = z.infer<typeof strategySlotSchema>;

export const strategyProposalSchema = z.object({
	slot: strategySlotSchema,
	family: strategyFamilySchema,
	title: z.string().min(3).max(120),
	bottleneck: z.string().min(10).max(800),
	hypothesis: z.string().min(10).max(1200),
	mechanism: z.string().min(10).max(1200),
	expectedImpact: z.string().min(5).max(600),
	targetAreas: z.array(z.string().min(1).max(200)).min(1).max(12),
	supportAreas: z.array(z.string().min(1).max(200)).max(12),
	forbiddenAreas: z.array(z.string().min(1).max(200)).max(12),
	falsifier: z.string().min(10).max(1000),
	differenceFromHistory: z.string().min(10).max(1000),
	forbiddenMechanisms: z.array(z.string().min(1).max(300)).max(12),
});

export type StrategyProposal = z.infer<typeof strategyProposalSchema>;

export const strategyCardSchema = strategyProposalSchema.extend({
	id: z.string().min(1).max(180),
	round: z.number().int().positive(),
});
export type StrategyCard = z.infer<typeof strategyCardSchema>;

export const experimentStatusSchema = z.enum([
	"eligible",
	"no-improvement",
	"agent-crash",
	"evaluation-failed",
	"worker-commit-violation",
	"boundary-violation",
	"strategy-violation",
]);
export type ExperimentStatus = z.infer<typeof experimentStatusSchema>;

export const criticFindingSchema = z.object({
	cardId: z.string().min(1).max(180),
	mechanismAttempted: z.boolean(),
	duplicateOf: z.string().min(1).max(180).nullable(),
	evidenceProblems: z.array(z.string()).max(12),
	failureCause: z.string().max(1200),
	lesson: z.string().max(1200),
	nextConstraint: z.string().max(1200),
});

export type CriticFinding = z.infer<typeof criticFindingSchema>;

export const familyDeferralProposalSchema = z.object({
	family: strategyFamilySchema,
	reason: z.string().min(20).max(1200),
	evidencePaths: z.array(z.string().min(1).max(200)).min(1).max(12),
	missingFalsifier: z.string().min(20).max(1000),
	reconsiderWhen: z.string().min(10).max(1000),
});
export type FamilyDeferralProposal = z.infer<typeof familyDeferralProposalSchema>;

export const familyDeferralReviewSchema = z.object({
	family: strategyFamilySchema,
	approved: z.boolean(),
	evidenceSufficient: z.boolean(),
	rationale: z.string().min(10).max(1200),
	reconsiderConstraint: z.string().min(10).max(1000),
});
export type FamilyDeferralReview = z.infer<typeof familyDeferralReviewSchema>;

export const deferralRequestSchema = z.object({
	deferrals: z.array(familyDeferralProposalSchema).max(STRATEGY_FAMILIES.length),
});
export type DeferralRequest = z.infer<typeof deferralRequestSchema>;

export const strategyPortfolioSchema = z.object({
	proposals: z.array(strategyProposalSchema).max(STRATEGY_FAMILIES.length),
});
export type StrategyPortfolio = z.infer<typeof strategyPortfolioSchema>;

const eventBaseSchema = z.object({
	version: z.literal(1),
	runId: z.string().min(1).max(128),
	roundId: z.string().min(1).max(180),
	taskHash: z.string().min(1).max(128),
	evaluationContextHash: z.string().min(1).max(128),
	timestamp: z.string().datetime(),
	round: z.number().int().nonnegative(),
});

export const exploreEventSchema = z.discriminatedUnion("type", [
	eventBaseSchema.extend({
		type: z.literal("baseline"),
		commit: z.string().min(1).max(128),
		score: z.number().finite(),
		output: z.string(),
	}),
	eventBaseSchema.extend({
		type: z.literal("family-deferral"),
		contextFingerprint: z.string().min(1).max(128),
		proposal: familyDeferralProposalSchema,
		review: familyDeferralReviewSchema.nullable(),
		outcome: z.enum(["accepted", "rejected"]),
		error: z.string().optional(),
	}),
	eventBaseSchema.extend({
		type: z.literal("portfolio-adjustment"),
		requestedAgents: z.number().int().min(3).max(STRATEGY_FAMILIES.length),
		effectiveAgents: z.number().int().min(1).max(STRATEGY_FAMILIES.length),
		deferredFamilies: z.array(strategyFamilySchema).max(STRATEGY_FAMILIES.length),
		reason: z.string().min(1).max(1000),
	}),
	eventBaseSchema.extend({
		type: z.literal("exploration-terminal"),
		outcome: z.literal("no-applicable-frontier"),
		contextFingerprint: z.string().min(1).max(128),
		deferredFamilies: z.array(strategyFamilySchema).max(STRATEGY_FAMILIES.length),
		saturatedFamilies: z.array(strategyFamilySchema).max(STRATEGY_FAMILIES.length),
		reason: z.string().min(1).max(1200),
	}),
	eventBaseSchema.extend({
		type: z.literal("portfolio-rejection"),
		phase: z.enum(["deferral-proposal", "strategy-proposal"]),
		attempt: z.number().int().min(1).max(2),
		reasons: z.array(z.string().min(1).max(1000)).min(1).max(100),
		parsedProposals: z.array(strategyProposalSchema).max(STRATEGY_FAMILIES.length),
		rawFingerprint: z.string().min(1).max(128),
		rawOutput: z.string(),
	}),
	eventBaseSchema.extend({
		type: z.literal("experiment"),
		card: strategyCardSchema,
		baselineScore: z.number().finite(),
		candidateScore: z.number().finite().nullable(),
		candidateCommit: z.string().min(1).max(128).nullable(),
		branchName: z.string().min(1).max(300),
		status: experimentStatusSchema,
		changedFiles: z.array(z.string().min(1).max(500)).max(2000),
		routeCompliant: z.boolean(),
		violations: z.array(z.string().max(1000)).max(100),
		diffFingerprint: z.string().max(128),
		evaluationOutput: z.string(),
		error: z.string().optional(),
	}),
	eventBaseSchema.extend({
		type: z.literal("round-review"),
		findings: z.array(criticFindingSchema).max(100),
		error: z.string().optional(),
	}),
	eventBaseSchema.extend({
		type: z.literal("round-finalization-intent"),
		intentId: z.string().min(1).max(180),
		baselineCommit: z.string().min(1).max(128),
		baselineScore: z.number().finite(),
		performanceCandidates: z
			.array(
				z.object({
					cardId: z.string().min(1).max(180),
					score: z.number().finite(),
					candidateCommit: z.string().min(1).max(128),
					branchName: z.string().min(1).max(300),
				}),
			)
			.max(STRATEGY_FAMILIES.length),
	}),
	eventBaseSchema.extend({
		type: z.literal("selection-intent"),
		roundIntentId: z.string().min(1).max(180),
		baselineCommit: z.string().min(1).max(128),
		baselineScore: z.number().finite(),
		selectedCardId: z.string().min(1).max(180),
		selectedScore: z.number().finite(),
		candidateCommit: z.string().min(1).max(128),
		branchName: z.string().min(1).max(300),
	}),
	eventBaseSchema.extend({
		type: z.literal("round-finalization-result"),
		roundIntentId: z.string().min(1).max(180),
		baselineCommit: z.string().min(1).max(128),
		baselineScore: z.number().finite(),
		selectedCardId: z.string().min(1).max(180).nullable(),
		selectedScore: z.number().finite().nullable(),
		outcome: z.enum(["applied", "no-winner", "merge-failed"]),
		resultingCommit: z.string().min(1).max(128).nullable(),
		error: z.string().optional(),
	}),
]);

export type ExploreEvent = z.infer<typeof exploreEventSchema>;
```

Program-generated values such as run/round/card/intent IDs, task/evaluation-context hashes,
timestamps, scores, commits, branch names, changed files, and fingerprints must never be trusted
from model output.

Generate one cryptographically unique `runId` per `runExploration` invocation. Use
`roundId = "${runId}:r${round}"` and card IDs
`"${runId}:r${round}:c${index}"`; never reuse round-local IDs across invocations.

Add a schema-level `superRefine` for round-finalization-result consistency:

- `applied` requires a non-null card/score/resulting commit;
- `merge-failed` requires a non-null card/score, a null resulting commit, and an error;
- `no-winner` requires null card/score/resulting commit.

At orchestration level, every finalization result must match exactly one earlier
`round-finalization-intent` by `roundIntentId`. Applied/merge-failed results must also have exactly
one earlier `selection-intent` for the same ID and selected card; no-winner must have none.

Before any context filtering, a global causal validator must additionally enforce:

- intent IDs are globally unique;
- an intent has at most one selection and at most one result, in append order;
- selections/results are never orphaned and share the intent's run, round, task, context, baseline
  commit, and baseline score;
- every shortlisted candidate has an earlier experiment with identical card ID, score, commit, and
  branch;
- a selected candidate belongs to the intent shortlist and its score/commit/branch exactly match;
- `applied.resultingCommit === selection.candidateCommit`;
- `merge-failed` matches the selection and has no resulting commit;
- `no-winner` has no selection.

An orphan, duplicate, out-of-order, or conflicting event is a repository recovery error: stop before
baseline evaluation and print bounded evidence. Never let malformed causal history influence
champion, debt, saturation, or stagnation.

Also require a `family-deferral` outcome of `accepted` exactly when a non-null fresh review has both
`approved: true` and `evidenceSufficient: true`; otherwise its outcome must be `rejected`. Invalid or
failed review output is represented by `review: null` plus a bounded error, never a fabricated
review.

`targetAreas`, `supportAreas`, and `forbiddenAreas` are repository-relative path patterns, not
free-form prose.
The controller accepts exact paths, directory prefixes, `*`, and `**`; it rejects absolute paths,
`..`, a bare `**`, and target patterns that match no path in the controller's full tracked-file
inventory.
`forbiddenMechanisms` remains a semantic instruction for the worker and critic; it is never treated
as proof that a patch followed the strategy.

## Exact runtime flow

```text
Preflight
  ├─ verify git repository and clean base worktree
  ├─ snapshot base HEAD, index, and filtered worktree status
  ├─ validate mode/options
  ├─ run evaluation in a fresh detached worktree at the exact unchanged HEAD commit
  ├─ verify the evaluation sandbox and base snapshot were not mutated
  └─ append baseline event

For each round
  ├─ read archive entries for the exact evaluation-context hash
  ├─ compute context fingerprint, active deferrals, champion, saturation, debt, and stagnation
  ├─ build initial slots and exact challenger-family assignments
  ├─ ask applicability director only for deferrals of those assigned challenger families
  ├─ verify the base HEAD and status did not change
  ├─ fresh-review every requested deferral in a disposable advisor worktree
  ├─ archive accepted/rejected deferral decisions; accepted deferrals earn no coverage credit
  ├─ recompute final slots/families; shrink audibly or terminate if the frontier is exhausted
  ├─ ask a fresh proposal-only director for the final requirements
  ├─ parse with Zod and reject duplicate/saturated proposals lacking a novel unlock
  ├─ archive each invalid portfolio and its bounded validation reasons
  ├─ retry director once if the portfolio is invalid
  ├─ create one worktree per validated strategy card
  ├─ give each inner agent only the task, assigned card, boundaries, and baseline
  ├─ execute candidates in parallel
  ├─ reject any candidate whose worker moved its HEAD away from the controller baseline
  ├─ mechanically reject protected-path changes or patches outside the assigned target areas
  ├─ stage only explicitly allowed files and commit the candidate
  ├─ run evaluation script in every successful worktree
  ├─ reject any evaluation that changes the controller commit, index, or filtered worktree state
  ├─ capture changed files, diff summary, bounded patch, and fingerprint
  ├─ verify the shared base HEAD and status still match the pre-batch snapshot
  ├─ deterministically mark candidates eligible or non-improving
  ├─ build the deterministic performance-eligible shortlist
  ├─ append experiment events for every candidate
  ├─ append round-finalization-intent before entering critic/finalization
  ├─ run one fresh-context counterfactual critic in a disposable advisor worktree
  ├─ verify the base HEAD and status did not change
  ├─ append the review event and withhold qualification from unverified/off-strategy candidates
  ├─ choose the best performance-eligible and exploration-qualified candidate
  ├─ append selection-intent before winner application, if a qualified winner exists
  ├─ fast-forward the base to that candidate, or keep the base unchanged
  ├─ append round-finalization-result recording applied, no-winner, or merge-failed
  ├─ clean candidate worktrees/branches after the result is durable
  └─ use the resulting HEAD as the next round baseline

Finish
  ├─ report baseline, final score, kept rounds, rejected rounds
  ├─ report unique strategy families and duplicate proposals rejected
  └─ leave the base unchanged when no candidate passed the gate
```

Portfolio policy:

- Round 1 has no incumbent strategy, so all slots are `challenger` and families must be unique.
- A normal later round contains one `exploit`, one `adjacent`, and all remaining slots are `challenger`.
- `exploit` may refine the last kept family but must state a different mechanism or falsifier.
- `adjacent` must use a different family from the incumbent.
- `challenger` must use a family assigned from the highest exploration-debt frontier and cannot
  receive the full incumbent implementation narrative.
- When global stagnation reaches the configured threshold, replace the `exploit` slot with a
  debt-selected `challenger`; keep the requested agent count unless the audited frontier-shortage
  rule emits a `portfolio-adjustment`.
- If the incumbent family is saturated, replace its `exploit` slot with another `challenger`.

Strategy-credit policy:

- The hard route gate requires at least one allowed changed file to match `targetAreas`; every
  remaining changed file must match either `targetAreas` or declared `supportAreas`; and no changed
  file may match `forbiddenAreas` or user boundaries. Tests and benchmark fixtures belong in
  `supportAreas`, so “support” is explicit rather than an unrestricted escape hatch.
- A mechanically route-compliant patch may still be semantically off-strategy; source-code intent
  cannot be proven from a diff without a trusted domain-specific checker.
- A `strategy-violation` automatically remains an unsatisfied strategy constraint for a future
  round; it never counts as exploration coverage.
- When the critic reports `mechanismAttempted: false` or a non-null `duplicateOf`, that card does
  not count as a successfully explored family. Requeue the constraint in the next director prompt
  and require a new card in the same family or an explicitly justified replacement.
- Missing or invalid critic coverage leaves a route “unverified,” rather than silently crediting it.
  It may be retried while budget remains, but it is not eligible to win the current `--explore`
  round.
- A critic finding cannot authorize a merge. `mechanismAttempted: false`, non-null `duplicateOf`,
  missing coverage, or invalid critic output removes that candidate from the exploration-qualified
  shortlist even if it improved the scalar score. Report it as an ordinary performance discovery,
  but do not make it the exploration champion or exploit parent.
- A family becomes saturated after the configured number of exploration-qualified,
  non-improving attempts. Passage of time does not clear saturation. A proposal with a materially
  different mechanism or falsifier may receive a one-attempt scheduling unlock, but the unlock does
  not clear saturation. Only a later exploration-qualified strict improvement that is actually
  applied clears the family's non-improvement streak.
- Challenger families are assigned from exploration debt: uncredited families first, then the
  least-credited/least-attempted families. This prevents the director from rotating forever among a
  familiar subset. Unsaturated families always form the first scheduling partition; saturated
  families are considered only when no unassigned unsaturated family can fill a slot.
- A zero-credit family may be deferred only when the director supplies concrete repository paths,
  explains why no falsifiable card can be formed, and a separate fresh-context reviewer approves
  the evidence. Deferral is not exploration credit. Requested deferral families must be unique and
  must be exact challenger families assigned for this round; exploit/adjacent or arbitrary
  unassigned families cannot be deferred.
- An accepted deferral is scoped to a context fingerprint over task, baseline commit, tracked-file
  inventory, baseline score, and evaluation-output fingerprint. Any code map, baseline, bottleneck
  evidence, or task change expires it and returns the family to the debt frontier.
- The director cannot defer a family forever by repetition: one accepted decision per
  family/context is the only active record, rejected or unreviewed deferrals leave the family
  required.
- Deferrals cannot silently exhaust exploration. After applying them, recompute substitutes before
  generating any strategy cards. If fewer families remain than challenger slots, archive a
  `portfolio-adjustment` and reduce only the unfillable challenger count. Every nonterminal round
  must retain at least one challenger. If no challenger family remains, append
  `exploration-terminal: no-applicable-frontier` and stop instead of falling back to exploit-only
  search or repeated validation failure.

The controller, not the model, computes and validates these requirements.

---

### Task 1: Add pure baseline-gate and winner-selection functions

**Files:**

- Create: `cli/src/execution/selection.ts`
- Create: `cli/src/execution/selection.test.ts`
- Modify: `cli/src/execution/index.ts`

**Step 1: Write failing tests**

Cover:

```ts
import { describe, expect, it } from "bun:test";
import {
	isCandidateAcceptable,
	selectBestImprovingCandidate,
} from "./selection.ts";

describe("isCandidateAcceptable", () => {
	it("rejects a lower maximize score", () => {
		expect(isCandidateAcceptable(9, 10, "maximize")).toBe(false);
	});

	it("rejects a higher minimize score", () => {
		expect(isCandidateAcceptable(11, 10, "minimize")).toBe(false);
	});

	it("accepts only a strict improvement", () => {
		expect(isCandidateAcceptable(11, 10, "maximize")).toBe(true);
		expect(isCandidateAcceptable(10, 10, "maximize")).toBe(false);
	});
});

describe("selectBestImprovingCandidate", () => {
	it("returns null when every candidate regresses from baseline", () => {
		const result = selectBestImprovingCandidate(
			[
				{ id: "a", score: 8 },
				{ id: "b", score: 9 },
			],
			10,
			"maximize",
		);
		expect(result).toBeNull();
	});

	it("returns the best candidate that beats baseline", () => {
		const result = selectBestImprovingCandidate(
			[
				{ id: "a", score: 11 },
				{ id: "b", score: 12 },
			],
			10,
			"maximize",
		);
		expect(result?.id).toBe("b");
	});
});
```

For `pass-fail`, define strict behavior:

- baseline `<= 0`, candidate `> 0`: improvement;
- baseline `> 0`: no candidate is a strict improvement.

**Step 2: Run the focused test**

```powershell
cd E:\Ecode\ralphy\cli
bun test src/execution/selection.test.ts
```

Expected: fail because `selection.ts` does not exist.

**Step 3: Implement the pure functions**

Use the existing `MetricObjective` type. The selector must ignore null scores and never return a candidate that only beats another candidate but not the baseline.

**Step 4: Run the focused test**

Expected: all selection tests pass.

**Step 5: Export the module and commit**

```powershell
git add cli/src/execution/selection.ts cli/src/execution/selection.test.ts cli/src/execution/index.ts
git commit -m "feat: add strict baseline selection gate"
```

---

### Task 2: Repair baseline handling in existing optimization modes

**Files:**

- Modify: `cli/src/execution/iterative-optimize.ts`
- Modify: `cli/src/execution/competition.ts`
- Create: `cli/src/execution/iterative-optimize.test.ts`
- Create: `cli/src/execution/competition.test.ts`

**Step 1: Make orchestration dependencies injectable**

Add narrow optional dependency objects rather than mocking entire imported modules:

```ts
export interface OptimizeDependencies {
	evaluate: typeof runEvaluation;
}

const DEFAULT_OPTIMIZE_DEPENDENCIES: OptimizeDependencies = {
	evaluate: runEvaluation,
};
```

Use the same pattern for competition selection/merge boundaries. Do not expose git destructive operations through tests.

**Step 2: Write a failing optimize test**

Test that evaluation runs once on unchanged HEAD before the first agent call, initializes `bestScore`, and prevents the first candidate from being automatically accepted when its score is worse.

Expected call sequence:

```text
evaluate baseline -> execute agent -> evaluate candidate -> reject/reset candidate
```

**Step 3: Run the optimize test and confirm failure**

```powershell
bun test src/execution/iterative-optimize.test.ts
```

**Step 4: Implement measured baseline initialization**

Before the round loop:

1. Run the evaluation command on unchanged HEAD.
2. Abort without executing an agent if it crashes or returns no score.
3. Initialize `bestScore` from the baseline.
4. Log the baseline explicitly.

Keep existing rollback behavior for this legacy mode, but do not introduce new destructive behavior.

**Step 5: Write a failing competition test**

Extract or inject winner application so a test proves that a batch winner scoring below the current baseline is not merged.

**Step 6: Run the competition test and confirm failure**

```powershell
bun test src/execution/competition.test.ts
```

**Step 7: Apply the strict gate**

Measure the base before every competition round. Select a winner only through `selectBestImprovingCandidate`. When no candidate improves:

- append a `discard` result;
- do not merge any branch;
- clean round worktrees;
- keep the base unchanged.

Also fix the existing two-argument call to the current three-argument merge API:

```ts
await mergeAgentBranch(winner.branchName, baseBranch, workDir);
```

Add a test assertion that winner application receives all three arguments. Do not weaken or overload
`mergeAgentBranch` merely to preserve the incorrect call.

**Step 8: Run both tests and the type/build check**

```powershell
bun test src/execution/iterative-optimize.test.ts src/execution/competition.test.ts src/execution/selection.test.ts
$task2BuildCheck = Join-Path $env:TEMP ("ralphy-task2-" + [guid]::NewGuid() + ".js")
bun build src/index.ts --target=bun --outfile "$task2BuildCheck"
Remove-Item -LiteralPath "$task2BuildCheck"
```

**Step 9: Commit**

```powershell
git add cli/src/execution/iterative-optimize.ts cli/src/execution/competition.ts cli/src/execution/iterative-optimize.test.ts cli/src/execution/competition.test.ts
git commit -m "fix: gate optimization candidates against measured baseline"
```

---

### Task 3: Add the exploration event archive

**Files:**

- Create: `cli/src/execution/exploration/types.ts`
- Create: `cli/src/execution/exploration/archive.ts`
- Create: `cli/src/execution/exploration/archive.test.ts`
- Create: `cli/src/execution/exploration/run-lock.ts`
- Create: `cli/src/execution/exploration/run-lock.test.ts`

**Step 1: Write archive tests**

Required cases:

1. Missing archive returns an empty list.
2. Appending an event creates `.ralphy/explore-history.jsonl`.
3. Multiple events remain in order.
4. Malformed individual lines are skipped with a warning rather than crashing the run.
5. `readEvaluationContextEvents` returns only the requested evaluation-context hash.
6. Baseline, family-deferral, portfolio-adjustment/rejection, exploration-terminal, experiment,
   review, round-finalization-intent, selection-intent, and round-finalization-result events
   round-trip correctly.
7. Output and error fields are bounded before writing.
8. Syntactically valid JSON with an invalid event shape is skipped with a warning.
9. Every appended event is validated before it is written.
10. The same task with a different script, metric key, or objective has a different evaluation
    context and cannot reuse derived state.
11. Changing a protected evaluation-harness file also changes the evaluation context.
12. Unresolved finalization intents are found across the complete archive, even when they belong to
    a different task or evaluation context.
13. Orphan, duplicate, out-of-order, baseline-mismatched, or candidate-mismatched
    selection/finalization events produce a blocking causal-recovery error.
14. A duplicate/conflicting result is never counted twice for champion or stagnation derivation.

Use a temporary directory and clean it in `afterEach`.

Write separate run-lock tests:

1. The first owner atomically acquires the repository-wide lock and a concurrent second owner fails
   before archive reads, baseline evaluation, or agent execution.
2. The lock lives under the canonical path returned by `git rev-parse --git-common-dir`, so linked
   worktrees for the same repository cannot run exploration concurrently.
3. Normal completion and handled exceptions release the lock only when the on-disk random token
   still matches the current owner.
4. A mismatched token, live PID, different host, malformed owner record, or unverifiable PID is never
   stolen or deleted automatically.
5. Explicit recovery with the displayed token succeeds only for a same-host PID that is positively
   confirmed dead; it atomically renames the stale lock to a timestamped quarantine file and exits,
   requiring a fresh invocation afterward.

**Step 2: Run the tests and confirm failure**

```powershell
bun test src/execution/exploration/archive.test.ts src/execution/exploration/run-lock.test.ts
```

**Step 3: Implement the append-only archive**

Required exports:

```ts
export const EXPLORE_HISTORY_FILE = "explore-history.jsonl";

export function hashTask(task: string): string;
export function hashEvaluationContext(
	task: string,
	config: EvaluateConfig,
	harnessFingerprint: string,
): string;
export function getExploreHistoryPath(workDir: string): string;
export function appendExploreEvent(workDir: string, event: ExploreEvent): void;
export function readExploreEvents(workDir: string): ExploreEvent[];
export function readTaskEvents(workDir: string, taskHash: string): ExploreEvent[];
export function readEvaluationContextEvents(
	workDir: string,
	evaluationContextHash: string,
): ExploreEvent[];
export function findUnresolvedFinalizations(events: ExploreEvent[]): UnresolvedFinalization[];
export function validateExploreEventCausality(events: ExploreEvent[]): EventCausalityAudit;
export function truncateEvidence(value: string, maxChars?: number): string;

export async function acquireExploreRunLock(
	workDir: string,
	baseBranch: string,
): Promise<ExploreRunLock>;
export async function releaseExploreRunLock(lock: ExploreRunLock): Promise<void>;
export async function quarantineConfirmedDeadExploreLock(
	workDir: string,
	expectedToken: string,
): Promise<string>;
```

Use `node:crypto` SHA-256 for task hashes and diff fingerprints. Use one compact JSON object per line. Ensure `.ralphy` exists. Default evidence limit: 4,000 characters per field.

`hashEvaluationContext` must hash a canonical object containing the task text, exact evaluation
script, effective metric key (including the default `"score"`), objective, and protected evaluation
harness fingerprint. All champion,
qualification, saturation, debt, deferral, and stagnation derivation uses only
`readEvaluationContextEvents`; `readTaskEvents` is reporting-only.

Do not put raw secrets, full environment dumps, or unlimited model output into the archive.
Call `exploreEventSchema.safeParse` on every parsed line and before every append. Never recover an
invalid event with a TypeScript cast. A malformed or schema-invalid historical line is skipped with
its line number in a bounded warning; an invalid event supplied to `appendExploreEvent` throws
before opening the file.

Implement `run-lock.ts` with an atomic exclusive create (`open(..., "wx")` or an equivalent atomic
directory claim) at a fixed filename under the canonical git common directory. The bounded JSON
owner record contains version, cryptographically random token, PID, hostname, start time, canonical
worktree path, and base branch. Acquire it before any archive read, recovery decision, baseline
evaluation, or advisor/worker call. `runId` remains separate from the lock token.

On collision, stop and print the bounded owner record, lock path, and recovery instruction. Never
steal a lock merely because it is old. Top-level `finally` releases only a token-matching lock.
Explicit stale recovery requires the displayed token, same hostname, and a PID positively confirmed
dead; quarantine the old lock and exit rather than continuing in the same process. A later fresh run
must still perform the global unresolved-intent check before doing any work.

**Step 4: Run the test**

Expected: all archive and run-lock tests pass.

**Step 5: Commit**

```powershell
git add cli/src/execution/exploration
git commit -m "feat: add persistent exploration event archive"
```

---

### Task 4: Implement cross-family novelty, saturation, debt, and portfolio policy

**Files:**

- Create: `cli/src/execution/exploration/policy.ts`
- Create: `cli/src/execution/exploration/policy.test.ts`

**Step 1: Write failing policy tests**

Cover these pure functions:

```ts
export function computeFamilyStates(
	events: ExploreEvent[],
	evaluationContextHash: string,
	threshold: number,
): Map<StrategyFamily, FamilyState>;

export function computeExplorationContextFingerprint(input: {
	evaluationContextHash: string;
	baselineCommit: string;
	inventoryFingerprint: string;
	baselineScore: number;
	evaluationOutputFingerprint: string;
}): string;

export function computeActiveDeferrals(
	events: ExploreEvent[],
	contextFingerprint: string,
): Set<StrategyFamily>;

export function rankFamiliesByExplorationDebt(
	states: Map<StrategyFamily, FamilyState>,
	activeDeferrals: Set<StrategyFamily>,
): StrategyFamily[];

export function computePortfolioRequirements(
	agentCount: number,
	incumbentFamily: StrategyFamily | null,
	globallyStagnant: boolean,
	states: Map<StrategyFamily, FamilyState>,
	activeDeferrals: Set<StrategyFamily>,
): PortfolioRequirements;

export function strategySimilarity(
	left: StrategyProposal,
	right: StrategyProposal,
): number;

export function isSaturationUnlock(
	proposal: StrategyProposal,
	familyHistory: StrategyProposal[],
): boolean;

export function validatePortfolio(
	proposals: StrategyProposal[],
	requirements: PortfolioRequirements,
	history: StrategyProposal[],
): PortfolioValidation;
```

Required behavior:

- Round 1 returns only challenger slots.
- A normal 3-agent round returns exploit, adjacent, challenger.
- A stagnant round contains no exploit, replaces that slot with a debt-selected challenger, and
  retains the requested slot count unless an audited frontier shortage requires adjustment.
- Each challenger slot receives a controller-assigned family from the highest exploration-debt
  frontier; the director cannot substitute another family.
- Uncredited families rank ahead of every already credited family; ties use credited attempt count,
  total attempt count, then the fixed `STRATEGY_FAMILIES` order.
- A credited family with an unsatisfied constraint never outranks an available zero-credit family;
  the unsatisfied-constraint priority applies only within the same credit group.
- An accepted deferral removes a family only from the current context's scheduling frontier and does
  not increment its credit/attempt counters.
- Duplicate, exploit/adjacent, and unassigned-family deferral requests are rejected mechanically.
- A rejected, unreviewed, or stale-context deferral does not remove the family.
- A new baseline commit, tracked inventory, score/evidence fingerprint, or task hash expires the
  accepted deferral and makes the family schedulable again.
- Two invocations that both start at round 1 use different run/round/card IDs, so reviews and
  selections from one run cannot join to events from the other.
- Events from another `evaluationContextHash` never influence family state, debt, saturation,
  champion, or stagnation.
- Accepted deferrals cause substitute families to be computed before proposal generation; the
  substitute call has its own normal validation retry budget.
- A partially exhausted frontier emits a portfolio adjustment and retains at least one challenger;
  a fully exhausted frontier emits the explicit terminal event and no director/worker starts.
- Two exploration-qualified no-improvement attempts saturate a family at threshold 2.
- Agent/evaluation crashes, boundary/strategy/worker-commit violations, and critic-unverified or
  duplicate attempts do not falsely prove a family exhausted; they remain unsatisfied constraints.
- A saturated incumbent replaces exploit with a debt-selected challenger.
- A saturated family remains saturated in later rounds until a proposal passes
  `isSaturationUnlock`; that unlock permits only the proposed attempt and does not mutate saturation.
  Merely waiting one round never clears it.
- If an unlocked proposal crashes, violates a gate, is unverified, or produces no improvement, the
  family remains saturated.
- Only a later exploration-qualified strict improvement that is successfully applied clears that
  family's no-improvement streak.
- Saturated families without a valid unlock are rejected.
- Challenger families must be unique.
- A rephrased proposal with the same bottleneck, causal hypothesis, mechanism, falsifier, and target
  areas is rejected even when the model relabels it as a different family.
- Schema-valid proposals from earlier rejected portfolios also participate in duplicate detection;
  a proposal does not become “new” merely because it never reached a worker.
- A genuinely different cross-family proposal is not rejected merely for sharing generic task
  vocabulary.
- Absolute, parent-traversing, bare-`**`, and inventory-free target patterns are rejected.
- A card reported by the latest critic as `mechanismAttempted: false` or semantically duplicated by
  `duplicateOf` is included in the next round's unsatisfied strategy constraints and does not count
  as family coverage.

**Step 2: Run and confirm failure**

```powershell
bun test src/execution/exploration/policy.test.ts
```

**Step 3: Implement deterministic similarity**

Do not add embedding dependencies. Normalize the structured fields and use Unicode-aware character
trigrams or token sets. Family labels are weak metadata, never a prerequisite for duplicate status.
Weight the comparison:

```text
causal text: bottleneck+hypothesis+
  mechanism+falsifier similarity             80%
target/support-area overlap                   15%
same-family bonus                             5%
duplicate threshold                          0.78
```

Return the component scores in validation diagnostics so failures are explainable.

**Step 4: Implement persistent saturation and exploration debt**

Derive family state by joining experiment records with critic findings by globally unique card ID,
then joining selection-intent and round-finalization-result by `roundIntentId`. Only an evaluated,
route-compliant card with
`mechanismAttempted: true` and `duplicateOf: null` receives exploration credit.

Saturation is derived from the archive, not stored as mutable state. Once the threshold is reached,
reject same-route retries indefinitely. `isSaturationUnlock` must compare a proposal against every
qualified failed proposal in that family and require:

```text
overall strategy similarity < 0.60
AND
(mechanism similarity < 0.55 OR falsifier similarity < 0.55)
```

Do not trust `differenceFromHistory` as evidence by itself.

`rankFamiliesByExplorationDebt` uses two strict partitions:

1. Among non-deferred, unsaturated families: zero-credit families first; within the same credit
   group, unsatisfied constraints first; then `creditCount`, qualified-attempt count, total-attempt
   count, and finally the fixed `STRATEGY_FAMILIES` order.
2. Only when partition 1 has no unassigned family for a remaining slot, consider saturated
   families, ordered by unsatisfied constraint then debt, and mark each
   `requiresNovelUnlock: true`.

A saturated unsatisfied constraint never jumps ahead of an available unsaturated family.
`computePortfolioRequirements` assigns an exact required family to every challenger slot after
applying that ordering.

Global stagnation means the configured number of consecutive `round-finalization-result` events
have an outcome other than `applied`. Neither finalization nor selection intents affect champion or
stagnation state. A finalization intent without a matching result is an unresolved recovery
condition, not a failed round.

**Step 5: Run the test**

Expected: all policy tests pass.

**Step 6: Commit**

```powershell
git add cli/src/execution/exploration/policy.ts cli/src/execution/exploration/policy.test.ts
git commit -m "feat: add deterministic exploration portfolio policy"
```

---

### Task 5: Add structured director, executor, and critic prompts

**Files:**

- Create: `cli/src/execution/exploration/prompts.ts`
- Create: `cli/src/execution/exploration/prompts.test.ts`
- Modify: `cli/src/execution/prompt.ts`
- Modify: `cli/src/execution/prompt.test.ts`

**Step 1: Write failing prompt tests**

Deferral-proposal prompt must include:

- only `deferrableFamilies`, mechanically computed as the exact assigned challenger families that
  are zero-credit, unsaturated, and not already actively deferred;
- original task, baseline evidence, and bounded inventory;
- instruction to return either no deferral or one evidence-backed deferral per assigned family;
- prohibition on deferring exploit, adjacent, already active-deferred, or unassigned families;
- permission to request deferral only when it cannot form a falsifiable, repository-grounded card,
  with concrete evidence paths and a reconsideration condition;
- warning that deferrals receive no coverage credit and require independent review.
- a parser test proving that credited and saturated families are rejected even when they happen to
  occupy challenger slots in the current round.

Proposal-only director prompt must include:

- original task;
- baseline score and objective;
- a bounded repository-relative file inventory, without the absolute repository path;
- required portfolio slots with controller-assigned challenger families;
- saturated families and exact novelty-unlock requirements;
- exploration-debt ranking;
- unsatisfied strategy constraints from prior critic findings;
- compact history of strategy cards and outcomes;
- instruction to return JSON only;
- instruction that cards must be falsifiable and mechanically distinct;
- instruction that `targetAreas`, `supportAreas`, and `forbiddenAreas` must use valid
  paths/patterns from the supplied inventory;
- instruction that final family assignments are mandatory and deferrals are no longer accepted in
  this phase.

Deferral-review prompt must include:

- each requested deferral;
- task, baseline evidence, bounded inventory, and current required family;
- instruction to reject generic claims such as “not relevant” without concrete path/bottleneck
  evidence;
- instruction to return one structured review per requested family and never propose code.

Challenger executor prompt must include:

- original task;
- exactly one assigned strategy card;
- baseline score;
- project rules and boundaries;
- explicit instruction not to switch strategy families silently;
- explicit instruction to report inability rather than falling back to the incumbent mechanism.
- explicit instruction not to commit because the controller owns candidate commits.

It must not include the full winner narrative or another candidate's card.

Critic prompt must include:

- all current cards plus a compact set of recent/canonical historical cards with stable IDs;
- score/evaluation evidence;
- changed files and bounded diff evidence;
- a counterfactual instruction: assume the current winner's core explanation is false and identify a discriminating test;
- instruction to return structured JSON only;
- statement that the critic cannot approve merges;
- statement that a candidate gets exploration qualification only when
  `mechanismAttempted: true` and `duplicateOf: null`.

**Step 2: Run and confirm failure**

```powershell
bun test src/execution/exploration/prompts.test.ts src/execution/prompt.test.ts
```

**Step 3: Implement prompt builders**

Required exports:

```ts
export function buildDirectorPrompt(input: DirectorPromptInput): string;
export function buildDeferralProposalPrompt(input: DeferralProposalPromptInput): string;
export function buildDeferralReviewPrompt(input: DeferralReviewPromptInput): string;
export function buildStrategyExecutionPrompt(input: StrategyExecutionPromptInput): string;
export function buildRoundCriticPrompt(input: RoundCriticPromptInput): string;
export function parseDeferralRequest(
	raw: string,
	deferrableFamilies: StrategyFamily[],
): DeferralRequest;
export function parseStrategyPortfolio(raw: string): StrategyPortfolio;
export function parseDeferralReviews(
	raw: string,
	expectedFamilies: StrategyFamily[],
): FamilyDeferralReview[];
export function parseCriticFindings(
	raw: string,
	expectedCardIds: string[],
	knownCardIds: string[],
): CriticFinding[];
```

Parsers may strip one Markdown code fence, but the parsed payload must pass Zod. The critic parser
must return exactly one finding for every expected card ID, with no duplicate or unknown IDs.
Each non-null `duplicateOf` must name a different ID in `knownCardIds`.
Do not silently invent missing fields.

The deferral-request parser must reject duplicate families and any family outside the exact
controller-computed `deferrableFamilies` set. This mechanically rejects credited, saturated,
exploit/adjacent, actively deferred, and unassigned families even if one is currently assigned as a
challenger. The deferral-review parser must return exactly one review for each requested family with
no duplicates or unknown families. A deferral is accepted only when the evidence paths all exist in
the controller's tracked inventory and the separate review returns both approval booleans true.
Missing/invalid review output means rejection, never implicit acceptance.

Build the inventory from normalized, sorted `git ls-files` output. Remove paths already covered by
mechanical system/user boundaries, but do not guess which other tracked files are “generated.”
Keep the full remaining list in controller memory for path-pattern validation, while bounding the
prompt rendering to 2,000 paths and 50,000 characters with an explicit truncation marker. The
advisor worktree still lets the director inspect tracked source omitted from the prompt. Never
include the absolute repository path.

**Step 4: Add exploration files to boundaries**

All execution prompts must prohibit agents from modifying:

```text
.ralphy/explore-history.jsonl
.ralphy/optimize-results.tsv
.ralphy/compete-results.tsv
.ralphy/AGENTS.md
.ralphy/progress.txt
```

Preserve existing user-defined boundaries.

**Step 5: Run prompt tests**

Expected: all prompt tests pass.

**Step 6: Commit**

```powershell
git add cli/src/execution/exploration/prompts.ts cli/src/execution/exploration/prompts.test.ts cli/src/execution/prompt.ts cli/src/execution/prompt.test.ts
git commit -m "feat: add structured dual-loop exploration prompts"
```

---

### Task 6: Implement the inner candidate runner

**Files:**

- Create: `cli/src/execution/exploration/boundary-gate.ts`
- Create: `cli/src/execution/exploration/boundary-gate.test.ts`
- Create: `cli/src/execution/exploration/candidate-runner.ts`
- Create: `cli/src/execution/exploration/candidate-runner.test.ts`
- Create: `cli/src/execution/exploration/evaluation-sandbox.ts`
- Create: `cli/src/execution/exploration/evaluation-sandbox.test.ts`
- Reuse: `cli/src/git/worktree.ts`
- Reuse: `cli/src/execution/evaluate.ts`
- Reuse: `cli/src/execution/retry.ts`

**Step 1: Define the result contract**

```ts
export interface CandidateEvidence {
	card: StrategyCard;
	worktreeDir: string;
	evaluationWorktreeDir?: string;
	branchName: string;
	commit: string | null;
	score: number | null;
	status:
		| "evaluated"
		| "agent-crash"
		| "evaluation-failed"
		| "worker-commit-violation"
		| "boundary-violation"
		| "strategy-violation";
	evaluationOutput: string;
	error?: string;
	changedFiles: string[];
	routeCompliant: boolean;
	violations: string[];
	diffFingerprint: string;
	diffStat: string;
	boundedPatch: string;
	inputTokens: number;
	outputTokens: number;
}

export interface EvaluationSandboxResult extends EvaluateResult {
	worktreeDir: string;
	headBefore: string;
	headAfter: string;
	stateUnchanged: boolean;
	preservedForRecovery: boolean;
}

export async function evaluateCommitInFreshWorktree(input: {
	repositoryDir: string;
	commit: string;
	config: EvaluateConfig;
}): Promise<EvaluationSandboxResult>;
```

**Step 2: Write failing tests using injected dependencies**

Cases:

1. The assigned card appears in the executor prompt.
2. An agent failure returns `agent-crash` and does not evaluate.
3. An evaluation failure returns `evaluation-failed`.
4. A successful run captures score, changed files, and fingerprint.
5. A worker cannot modify the archive without the boundary appearing in its prompt.
6. Patch evidence is truncated before it is returned to the critic.
7. A tracked change to a protected control file returns `boundary-violation`, is not staged, and is
   not evaluated.
8. A change that touches none of the assigned `targetAreas`, or touches an undeclared off-route
   path outside `targetAreas`/`supportAreas`, returns `strategy-violation`, is not staged, and is not
   evaluated.
9. A change matching `forbiddenAreas` or a user-defined boundary is rejected.
10. Known untracked engine noise such as `.ralphy/logs/**` is ignored and never staged, while a
    tracked modification under that path is rejected.
11. Only explicit allowed paths are passed to the commit dependency; `git add .` is never used.
12. Windows separators, renamed files, deleted files, spaces, `*`, and `**` patterns are handled
    deterministically.
13. If the worker makes any commit, the candidate returns `worker-commit-violation`; neither the
    worker's commit nor later working-tree changes are evaluated.
14. If the evaluation script changes candidate HEAD, index, or filtered worktree state, its score is
    discarded and status is `evaluation-failed`.
15. Modifying an auto-detected or user-declared evaluation-harness path is a boundary violation,
    even if that change would improve the reported score.
16. Candidate worktree creation receives the exact recorded `baselineCommit`, never the movable
    base-branch name.
17. Status uses `--porcelain=v1 -z --untracked-files=all`; an untracked directory is expanded to
    individually checked files.
18. Exact staging uses `git --literal-pathspecs add -- <approved-file>...`; filenames such as `-A`,
    `--all`, and `:(glob)**` remain literal and cannot widen the staged set.
19. The cached diff immediately before commit and the committed diff immediately after commit
    contain exactly the approved path set, including both sides of a rename.
20. An ignored worker cache that would inflate the score is absent from the fresh detached
    evaluation worktree, so the recorded score corresponds only to the controller commit.
21. The controller commit is exactly one direct child of `baselineCommit`; a hook-created extra
    commit or different parent is rejected.

Use a dependency interface for worktree creation, engine execution, evaluation, diff capture, and commit. Do not create real worktrees in unit tests.

**Step 3: Run and confirm failure**

```powershell
bun test src/execution/exploration/boundary-gate.test.ts src/execution/exploration/evaluation-sandbox.test.ts src/execution/exploration/candidate-runner.test.ts
```

**Step 4: Implement the runner**

Production behavior:

1. Create every worktree/branch from the round's exact controller-recorded `baselineCommit`, not
   from a movable branch name. The existing worktree helper's base-ref parameter may receive that
   commit SHA.
2. Build the strategy execution prompt.
3. Execute through existing retry handling.
4. Capture tokens.
5. Compare candidate `HEAD` with the controller-recorded `baselineCommit`. If they differ, capture
   the committed and uncommitted diff as bounded evidence, return `worker-commit-violation`, and do
   not evaluate. The prompt prohibition against commits is not the security boundary.
6. Read `git status --porcelain=v1 -z --untracked-files=all` in the candidate worktree and normalize
   every path to a repository-relative slash form. Preserve both sides of a rename. Never accept a
   collapsed untracked-directory entry as an approved file list.
7. Run the protected-path and assigned-route gate before staging:
   - reject absolute paths and any normalized path containing `..`;
   - reject tracked or untracked modifications to `.ralphy/**`, `.ralphy-worktrees/**`,
     `.ralphy-sandboxes/**`, the actual routed PRD/control patterns, an evaluation-harness path, or a
     user boundary;
   - exclude known untracked Ralphy runtime noise from the patch without treating it as candidate
     code;
   - reject any allowed change matching the card's `forbiddenAreas`;
   - require at least one allowed changed path to match the card's `targetAreas`;
   - require every other allowed path to match `targetAreas` or declared `supportAreas`.
8. On `boundary-violation` or `strategy-violation`, capture bounded evidence, return without
   committing or evaluating, and let the orchestrator archive the result.
9. Stage only the exact approved file list with an argument-array call equivalent to
   `git --literal-pathspecs add -- <file>...`. Never build a shell command from model-generated
   paths and never use a directory pathspec, `git add .`, `git add -A`, or an unrestricted/pathspec-
   magic argument.
10. Before commit, parse `git diff --cached --name-status -z` and require its normalized path
    multiset to equal the approved set exactly. After the controller commit, parse the
    `baselineCommit..controllerCommit` name-status diff and enforce the same equality. Any extra,
    missing, or changed rename endpoint is a `boundary-violation`; preserve the worktree and never
    evaluate it.
11. Require candidate HEAD to be the controller commit, that commit to be exactly one direct child
    of `baselineCommit`, the tracked index/worktree to be clean, and the commit diff to be exact.
    Ignored worker artifacts are not evaluation inputs.
12. Create a new temporary detached evaluation worktree from the exact controller commit, using the
    same validated-temp-path discipline as advisor sandboxes. Run the evaluator only there, never in
    the worker worktree. This makes the score a function of the commit plus the declared external
    environment, not worker-created ignored caches.
13. Snapshot evaluation-worktree HEAD, index, and filtered tracked/untracked status before
    evaluation. After evaluation, require HEAD and all non-ignored state to match. If not, discard
    the score, return `evaluation-failed`, and preserve/report the mutated evaluation worktree;
    never reset it. Ignored outputs created during this one-shot evaluation may be discarded with
    that validated temporary worktree because they cannot affect a later candidate.
14. Capture changed files and bounded diff evidence against baseline.
15. Return evidence; do not merge or clean up the candidate here. Remove a clean evaluation
    worktree in `finally`; preserve it on unexplained mutation.

The orchestrator owns archive durability, selection, merge, and cleanup.
It maps `evaluated` evidence to the persisted `eligible` or `no-improvement` status by comparing
the candidate score with the measured baseline. Other runner statuses map directly to persisted
statuses.

Implement path matching locally in `boundary-gate.ts`; do not add a dependency. Support exact
paths, directory prefixes, `*`, and `**` with an anchored regular expression built from escaped
literal segments. A bare `**`, absolute path, drive-qualified path, or parent traversal is invalid.
The gate is the hard, machine-checkable meaning of “follow the assigned route.” Semantic adherence
is separately reviewed by the critic and never replaces this gate.

**Step 5: Run the test**

Expected: all boundary-gate and candidate-runner tests pass.

**Step 6: Commit**

```powershell
git add cli/src/execution/exploration/boundary-gate.ts cli/src/execution/exploration/boundary-gate.test.ts cli/src/execution/exploration/evaluation-sandbox.ts cli/src/execution/exploration/evaluation-sandbox.test.ts cli/src/execution/exploration/candidate-runner.ts cli/src/execution/exploration/candidate-runner.test.ts
git commit -m "feat: execute assigned strategies in isolated worktrees"
```

---

### Task 7: Implement the outer exploration orchestrator

**Files:**

- Create: `cli/src/execution/exploration/advisor-sandbox.ts`
- Create: `cli/src/execution/exploration/advisor-sandbox.test.ts`
- Create: `cli/src/execution/exploration/harness.ts`
- Create: `cli/src/execution/exploration/harness.test.ts`
- Create: `cli/src/execution/exploration/explore.ts`
- Create: `cli/src/execution/exploration/explore.test.ts`
- Create: `cli/src/execution/exploration/index.ts`
- Modify: `cli/src/execution/index.ts`
- Modify: `cli/src/execution/evaluate.ts`
- Create: `cli/src/execution/evaluate.test.ts`
- Modify: `cli/src/config/types.ts`
- Modify: `cli/src/config/writer.ts`
- Create: `cli/src/config/types.test.ts`
- Create: `cli/src/config/writer.test.ts`

**Step 1: Define options**

```ts
export interface ExploreOptions {
	engine: AIEngine;
	task: string;
	workDir: string;
	evaluateConfig: EvaluateConfig;
	numAgents: number;
	numRounds: number;
	stagnationThreshold: number;
	maxRetries: number;
	retryDelay: number;
	skipTests: boolean;
	skipLint: boolean;
	browserEnabled: "auto" | "true" | "false";
	modelOverride?: string;
	reasoningEffort?: string;
	engineArgs?: string[];
	knowledge?: KnowledgeOptions;
	protectedControlPatterns: string[];
	evaluationProtectedPaths: string[];
	evaluationMutablePaths: string[];
	allowUnverifiedEvaluatorDependencies: boolean;
}
```

**Step 2: Write failing orchestration tests**

Use injected dependencies. Required cases:

1. Dirty user-code state aborts before evaluation or agent execution.
2. Baseline evaluation happens before director execution.
3. Invalid or duplicate director output is archived before being retried once.
4. A second invalid portfolio is also archived and aborts the round without starting candidates.
5. Distinct cards are assigned to distinct candidates.
6. All experiment records are appended before winner application or cleanup.
7. A candidate that wins its batch but loses to baseline is not merged.
8. A strict improvement is fast-forwarded and becomes the next baseline.
9. Critic failure is logged, produces no exploration-qualified winner, and is non-fatal to the
   overall run.
10. Stagnation replaces the exploit slot with a debt-selected challenger and preserves the requested
    slot count unless a durable audited frontier adjustment is required.
11. No-improvement leaves HEAD unchanged.
12. A round-finalization intent is durable before critic execution; winner application additionally
    requires a selection intent; the matching finalization result records applied, no-winner, or
    merge-failed.
13. Cleanup occurs after archive writes on both success and failure.
14. Director and critic run in separate disposable detached worktrees, never in `workDir`.
15. A fake advisor that writes or commits in its current directory changes only the disposable
    advisor worktree.
16. A changed base HEAD/status detected after an advisor call aborts without automatically
    resetting user files.
17. Boundary/strategy violations are archived and excluded from evaluation and selection.
18. A critic finding with `mechanismAttempted: false` or non-null `duplicateOf` disqualifies that
    candidate from the current winner set and is carried into the next director prompt.
19. A worker-created commit is archived as `worker-commit-violation` and cannot be evaluated.
20. Baseline evaluation uses a fresh detached worktree at the exact base commit; if evaluation
    changes tracked/non-ignored sandbox state or the base HEAD/index/status changes concurrently,
    preflight aborts without starting a director and without resetting files.
21. If candidate evaluation mutates its controller commit, index, or filtered status, its score is
    ignored and it cannot be selected.
22. The orchestrator compares base HEAD/status before and after the candidate batch and again before
    winner application; a mismatch aborts without merge, reset, or cleanup.
23. Failure to append round-finalization-intent prevents critic/finalization from starting.
24. Failure to append round-review stops immediately, leaving the finalization intent unresolved and
    preserving all candidates.
25. Failure to append selection-intent prevents base movement; failure to append the finalization
    result leaves a durable unresolved intent and preserves the candidate for recovery.
26. Preflight rejects an unresolved historical finalization intent and prints its shortlist,
    optional selected candidate, baseline commit, and current HEAD for manual reconciliation.
27. Unborn repositories and user-invoked detached HEADs are rejected before evaluation.
28. Challenger families come from deterministic exploration debt; uncredited families cannot be
    skipped in favor of repeatedly credited familiar families.
29. Saturated families stay unavailable across later rounds until a proposal passes the mechanical
    novelty-unlock rule.
30. A zero-credit family can be deferred only with valid evidence paths and an approving fresh
    review; rejection keeps it in the required debt frontier.
31. Accepted deferral earns no credit and expires when the context fingerprint changes.
32. Two invocations starting at round 1 have different run/round/card IDs and never cross-join
    critic or selection state.
33. Changing script, effective metric key, objective, or protected harness contents creates a new
    evaluation context with no inherited champion, saturation, debt, deferral, or stagnation state.
34. Accepted deferrals are resolved before a separate proposal-only call, so substitute families
    receive cards without consuming the proposal call's validation retry.
35. Deferrals cannot target unassigned families or eliminate every challenger silently; a partial
    frontier shrink is archived and a zero-frontier state terminates explicitly.
36. Quote-aware harness discovery protects direct tracked script tokens and package manifests;
    changing their contents changes `evaluationContextHash`.
37. An unresolved finalization intent from a different task/evaluation context still blocks the
    entire repository before baseline evaluation.
38. A concurrent second exploration invocation fails on the repository-wide lock before any archive
    read, evaluation, advisor, or worker call; handled exit paths release only their own lock token.
39. A frontier already exhausted by active historical deferrals writes the terminal event without
    calling the deferral director, proposal director, critic, or workers.
40. Credited or saturated assigned challengers are absent from `deferrableFamilies` and their
    deferral requests are rejected mechanically.
41. Candidate evaluation runs in a fresh detached worktree from the exact controller commit; an
    ignored cache/artifact created by the worker cannot influence the score.
42. Status enumeration expands all untracked files, staging uses literal per-file pathspecs, and the
    staged and committed path sets must exactly equal the approved set.
43. PRD/control patterns supplied by either routing path reach the mechanical boundary gate; a
    worker change to the actual PRD file or a file under a PRD source folder is rejected.
44. A Python evaluator importing a local scorer/fixture and an `npm run` evaluator whose package
    script points to a local file protect and fingerprint those dependencies when resolvable.
45. Any evaluator dependency that conservative discovery cannot prove covered fails preflight by
    default; explicit unsafe configuration is the only override and changes the evaluation context.
46. Harness classification permits `bench.py -> scorer.py -> src/routing.py` only when the first two
    are protected and `src/**` is explicitly mutable; scorer/cases edits are rejected while a routed
    algorithm edit can still be evaluated.
47. A pre-existing ignored score cache in the base worktree cannot influence the fresh baseline
    sandbox score.
48. Duplicate/conflicting/orphan causal events in any context block the repository before derived
    state is computed and cannot double-count champion or stagnation.

**Step 3: Run and confirm failure**

```powershell
bun test src/config/types.test.ts src/config/writer.test.ts src/execution/evaluate.test.ts src/execution/exploration/advisor-sandbox.test.ts src/execution/exploration/harness.test.ts src/execution/exploration/evaluation-sandbox.test.ts src/execution/exploration/explore.test.ts
```

**Step 4: Implement preflight**

Require:

- valid git repository;
- a resolvable, non-unborn `HEAD`;
- a named current branch; a user-invoked detached HEAD is rejected;
- clean tracked and untracked user-code state;
- `numAgents >= 3`;
- `numAgents <= STRATEGY_FAMILIES.length`;
- `numRounds >= 1`;
- `stagnationThreshold >= 1`;
- evaluation script present;
- mode objective recognized;
- every user `boundaries.never_touch`, `evaluation.protected_paths`, `evaluation.mutable_paths`, and routed
  `protectedControlPatterns` entry is a valid repository-relative path pattern.

Do not clean the user's base worktree automatically.
Ignore only known Ralphy runtime artifacts such as `.ralphy/explore-history.jsonl`,
`.ralphy/*-results.tsv`, `.ralphy/logs`, `.ralphy-worktrees`, and `.ralphy-sandboxes` when
determining cleanliness.
Do not ignore arbitrary files under `.ralphy`, because tracked project configuration may still be
user-owned.
An invalid boundary is a preflight error, never a pattern to silently skip. The single-task and PRD
routing layers must resolve the actual local PRD file or source folder before calling
`runExploration`: an in-repository file becomes an exact protected pattern and an in-repository
folder becomes `<relative-folder>/**`. A source outside the repository is not reachable through the
candidate worktree and is not exposed as an absolute prompt path. The human-readable phrase
`the PRD file` is never accepted as a mechanical pattern.

After the basic git/option checks, acquire the repository-wide run lock from Task 3 before reading
the archive or evaluating anything. Handle explicit stale-lock recovery as a separate quarantine
operation that exits. Wrap the remainder of `runExploration` in `try/finally`; release the lock only
through the token-matching helper.

Extend `.ralphy/config.yaml` with a conservative evaluator trust boundary:

```yaml
evaluation:
  protected_paths:
    - bench.py
    - benchmarks/**
  mutable_paths:
    - src/**
  allow_unverified_dependencies: false
```

Add a Zod `EvaluationSchema` with `protected_paths: string[] = []`,
`mutable_paths: string[] = []`, and
`allow_unverified_dependencies: boolean = false`, include it in `RalphyConfigSchema`, update the
generated config template, and add schema/writer tests. Invalid/absolute/parent-traversing/bare-`**`
patterns are fatal. A tracked path may not match both protected and mutable patterns; system control
paths, evaluator entrypoints, package manifests, and user `never_touch` boundaries always remain
protected. Routing passes these values into `ExploreOptions`; they are not model-controlled.

Derive protected evaluation-harness paths before hashing context or starting agents:

```ts
export function discoverEvaluationHarness(
	config: EvaluateConfig,
	workDir: string,
	userBoundaries: string[],
	explicitProtectedPaths: string[],
	explicitMutablePaths: string[],
): HarnessDiscovery;

export function fingerprintEvaluationHarness(
	workDir: string,
	paths: string[],
): string;
```

1. Export and reuse the exact quote-aware command parser used by `runEvaluation`; add tests for
   quotes, Windows separators, and malformed quoting so discovery and execution cannot disagree.
2. Protect every command token that resolves to a tracked repository file.
3. For known `npm|pnpm|yarn|bun run <name>` forms, protect the relevant package manifest, expand the
   named script, and recursively discover its direct tracked entrypoint. A missing script, nested
   dynamic shell expression, or unresolved local target is an unresolved dependency, not a warning.
4. Conservatively walk statically resolvable local JS/TS imports/requires and Python local/relative
   imports from discovered entrypoints. Resolve only unambiguous literal paths; dynamic imports,
   dynamic file/fixture paths, broad test-runner discovery, shell operators, and unsupported
   language/module forms remain explicit unresolved reasons.
5. Expand `evaluation.protected_paths`, `evaluation.mutable_paths`, and relevant user
   `boundaries.never_touch` patterns against the controller's complete tracked inventory. Classify
   every discovered local dependency: protected paths are immutable harness/scorer/fixture inputs;
   mutable paths are code intentionally eligible for optimization and remain subject to the strategy
   target/support gate. An unclassified dependency is unresolved. The evaluator entrypoint, package
   manifest, and system/user control boundaries cannot be reclassified as mutable.
6. Reject protected/mutable overlap. For example, `bench.py -> scorer.py -> src/routing.py` should
   protect `bench.py`, `scorer.py`, and cases/holdouts while allowing `src/routing.py` only when it
   matches `mutable_paths`.
7. If any repository-local indirect dependency remains unresolved and
   `allow_unverified_dependencies` is false, fail preflight with the exact reasons and a ready-to-
   paste config example. Merely printing a warning and continuing is forbidden.
8. When the explicit unsafe override is true, print a prominent warning, return
   `safetyMode: "unsafe-unverified"`, and include the sorted unresolved-reason fingerprints in the
   evaluation-harness fingerprint. Safe/unsafe runs therefore never share exploration state.
9. Hash safety mode, normalized protected relative paths and contents, and the normalized mutable
   pattern set into `evaluationHarnessFingerprint`. Do not hash mutable source contents.
10. Add every protected path to the candidate mechanical boundary gate and director inventory
   exclusions.

Do not include mutable Ralphy runtime files in the harness fingerprint. If a clearly repository-local
evaluation script token cannot be resolved, always fail preflight; the unsafe override cannot make a
missing entrypoint executable. Default mode must never continue with a dependency it knows is
unprotected.

Before filtering by task or context, call `readExploreEvents` and pair every historical
`round-finalization-intent` with a `round-finalization-result` by globally unique `roundIntentId`;
associate any selection-intent with the same ID. If any finalization intent anywhere in the
repository archive is unresolved, abort before baseline evaluation or agent execution and print its
task/context IDs, shortlisted candidates, optional selected candidate, baseline commit, and current
HEAD. Changing task, script, metric, objective, or harness must never bypass recovery. Do not guess
whether a prior fast-forward succeeded and do not synthesize a result automatically.

Run `validateExploreEventCausality` on that complete archive in the same preflight. Any duplicate,
orphan, out-of-order, baseline-mismatched, or candidate-mismatched selection/finalization event is
also blocking. Do not context-filter or derive state from an archive until this audit succeeds.

Only after the global recovery scan passes, compute `evaluationContextHash` from the task, exact
effective evaluation configuration, and `evaluationHarnessFingerprint`. Use only
`readEvaluationContextEvents` for champion, qualification, saturation, debt, deferral, and stagnation
state.

Generate a fresh `runId` only after preflight recovery checks pass. All events in this invocation
carry that run ID, and every round/card ID is namespaced under it.

Immediately before baseline evaluation, snapshot base HEAD plus filtered index/worktree status.
Call `evaluateCommitInFreshWorktree` for that exact HEAD; never execute the evaluator in the base
worktree. Require the evaluation sandbox's HEAD, index, and tracked/non-ignored state to remain
unchanged, then require the base snapshot still to match. If either check fails, abort and report the
delta without automatically restoring it. Preserve a mutated evaluation sandbox for inspection.
Ignored build outputs created during the one-shot sandbox evaluation are discarded with its
validated temporary worktree and cannot leak into candidate scoring.

**Step 5: Implement disposable advisor calls**

Create one fresh detached git worktree per deferral-proposal, deferral-review, proposal-director, or
critic call:

1. Snapshot the base commit and filtered status.
2. Create a unique temporary parent with `mkdtemp(join(tmpdir(), "ralphy-advisor-"))`; use a
   non-existent child path such as `<temporary-parent>/repo` as the worktree target.
3. Run `git worktree add --detach <temporary-parent>/repo <base-commit>`.
4. Invoke `engine.execute(prompt, advisorWorktree, options)`.
5. Accept only the engine's returned text/token counts; never commit or merge advisor changes.
6. In `finally`, remove the detached advisor worktree and its parent with literal validated paths,
   then prune its worktree metadata. Validate that both resolve under the generated temporary
   parent before any recursive removal. If safe removal fails, print the recovery path instead of
   broad cleanup.
7. Re-read base HEAD and filtered status. If either differs, abort immediately, report the exact
   delta, and do not reset or clean the base automatically.

Do not include the absolute base-worktree path in advisor prompts. Supply the bounded
repository-relative inventory and archived evidence in the prompt, while the detached worktree
provides read access to the baseline source. CWD isolation is the cross-engine v1 guarantee; when a
specific engine offers a verified read-only permission flag, use it as defense in depth but do not
assume every engine supports the same flag.

Run the focused sandbox test:

```powershell
bun test src/execution/exploration/advisor-sandbox.test.ts
```

**Step 6: Implement two-stage deferral and proposal calls**

For each round:

1. Compute initial slots, exact challenger families, and constraints.
2. Before any advisor call, compute the scheduling frontier after historical active deferrals. If no
   challenger family can be scheduled, append `exploration-terminal: no-applicable-frontier` and
   return without calling any director, reviewer, critic, or worker.
3. Compute
   `deferrableFamilies = assignedChallengers ∩ zeroCredit ∩ unsaturated - activeDeferrals`.
   If it is empty, skip directly to proposal generation; do not make an empty deferral call.
4. Otherwise make a deferral-proposal advisor call that may mention only
   `deferrableFamilies`.
5. Parse deferrals separately; reject duplicate, credited, saturated, exploit/adjacent,
   active-deferred, or unassigned families mechanically. Archive invalid output as a
   `portfolio-rejection` with
   `phase: "deferral-proposal"`; if that archive write succeeds, continue with no new deferrals
   rather than granting implicit acceptance. Archive failure stops the run.
6. If valid deferrals are present, make one separate fresh advisor call to review them, parse exact
   one-per-family decisions, and verify base state afterward.
7. Append an accepted or rejected `family-deferral` event for every requested family before using
   the decision. Rejected/unreviewed deferrals do not remove debt.
8. Recompute active deferrals, substitute families, and final slots before requesting any cards.
9. If fewer families remain than challenger slots, append `portfolio-adjustment` and shrink only
   the unfillable challenger count while retaining at least one challenger.
10. Perform the zero-frontier check a second time. If no challenger family remains, append
   `exploration-terminal: no-applicable-frontier`, print the audited reasons, and end the run
   without calling the proposal director or workers.
11. Build a new proposal-only director prompt from the final requirements. It cannot request
   deferrals.
12. Execute that prompt in a new disposable advisor worktree and parse only strategy proposals.
13. Assign controller-owned IDs `${runId}:r${round}:c${index}` and validate the resulting portfolio
     mechanically.
14. On invalid proposal output, append a `portfolio-rejection` event with
     `phase: "strategy-proposal"`, bounded raw output, fingerprint, any schema-valid proposals, and
     exact validation errors before retrying. If archive append fails, do not retry or start workers.
15. Retry the proposal-only call once with exact validation errors. The earlier deferral proposal
     and review calls do not consume this retry.
16. Abort that round without mutation after the second durable proposal rejection.

Count deferral-proposal, deferral-review, proposal-director, and critic tokens in the returned
`ExecutionResult`.

**Step 7: Execute the inner portfolio**

Use `Promise.allSettled`, not `Promise.all`, so one candidate crash cannot erase evidence from successful candidates.

Convert every settled outcome into a `CandidateEvidence` record. Use the pure selection gate to
mark every successful evaluation as performance-`eligible` or `no-improvement`, and build the
performance-eligible shortlist before persisting events. Do not choose the exploration winner until
critic qualification is available.

Map `boundary-violation` and `strategy-violation` directly into experiment events with
`routeCompliant: false`; they are never eligible for selection. A `strategy-violation` also enters
the next round's unsatisfied strategy constraints without waiting for critic output.
Map `worker-commit-violation` directly as well; a worker is never allowed to define the commit that
the controller may merge.

Snapshot base HEAD and filtered status before starting the candidate batch. Recheck after all
settled outcomes and once more immediately before winner application. Any mismatch is a fatal
external/base-mutation condition: do not select, merge, reset, or clean; preserve candidate
worktrees and report the before/after evidence.

**Step 8: Persist before review or cleanup**

Append one experiment event per candidate immediately after deterministic performance eligibility
has been computed. If an append fails, stop and preserve candidate branches/worktrees for recovery;
do not merge or clean evidence that has not been durably recorded.

After all experiments are durable and before invoking the critic, append one
`round-finalization-intent` with ID `${roundId}:finalize`, baseline commit/score, and the complete
performance-eligible shortlist (card, score, commit, branch). If this append fails, do not run the
critic or clean candidates.

**Step 9: Run the counterfactual critic**

Call the critic once per round through a new disposable advisor worktree. Attach only bounded
evidence. Append a `round-review` event when parsing succeeds. A finding with
`mechanismAttempted: false` or non-null `duplicateOf` adds an unsatisfied strategy constraint for
the next round and removes that candidate from the exploration-qualified shortlist. When the critic
fails:

- log a warning;
- append a `round-review` event with empty `findings` and a bounded `error`, rather than fabricating
  per-card findings;
- treat all affected route credit as unverified and leave the exploration-qualified shortlist
  empty for that round;
- continue the run with a no-winner round-finalization result;
- do not fabricate findings.

Whether the review contains findings or an error, it must be durably appended before selection. If
the review append itself fails, stop immediately, preserve every candidate, and leave the existing
round-finalization intent unresolved so the next run detects the incomplete round.

**Step 10: Select and apply**

Filter the performance-eligible shortlist to cards whose critic finding has
`mechanismAttempted: true` and `duplicateOf: null`. Use `selectBestImprovingCandidate` against the
measured round baseline only on that exploration-qualified subset. A higher-scoring but
off-strategy, duplicated, or unverified candidate is reported as a performance discovery but cannot
become the `--explore` winner or next exploit parent.

If a candidate passes:

- append a `selection-intent` referencing the durable `roundIntentId` and containing baseline
  commit/score, card/score, candidate commit, and branch before touching the base; if this append
  fails, do not merge or clean;
- use fast-forward-only merge or an equivalent non-destructive operation;
- if fast-forward fails, stop and preserve the winner branch;
- never use the current competition mode's hard-reset fallback;
- append a matching `round-finalization-result` with `outcome: "applied"` and `resultingCommit`
  only after the fast-forward succeeds;
- append a matching `round-finalization-result` with `outcome: "merge-failed"` and the error when
  application fails;
- if result persistence fails, leave the already-durable finalization/selection intents unresolved,
  preserve the winner branch/worktree, and stop. The next run must refuse automatic continuation.

If none passes:

- keep HEAD unchanged;
- append a `round-finalization-result` referencing the round intent, with
  `outcome: "no-winner"` and null candidate fields;
- if that append fails, stop and preserve all candidates; the unresolved round intent must block
  the next run;
- continue until the round limit.

**Step 11: Clean up only after durable events and safe application**

Delete candidate worktrees and temporary branches only after the round-finalization-result is
durable. When winner application or result persistence fails, preserve the relevant
branch/worktree and print its recovery path. The exploration archive and prior intents remain.

For a strict performance improvement that critic qualification excludes, make sure its experiment
event already contains the candidate commit and branch name, and include the commit in the final
“performance discoveries not selected” summary before normal losing-branch cleanup. Do not silently
present it as the exploration champion.

Before normal cleanup, remove only the known untracked engine runtime directory
`.ralphy/logs/**` inside a validated disposable candidate worktree. First prove with git
that no path under it is tracked, resolve the target under that exact worktree, and do not follow a
symlink/junction outside it. Never remove `.ralphy/config.yaml`, progress/knowledge files, an
arbitrary `.ralphy/**` path, or anything in the base worktree. If any other uncommitted path remains,
preserve the worktree and report it rather than forcing cleanup.

Advisor worktrees are different: they are detached, output-only sandboxes whose file changes are
never candidates. After capturing stdout and token counts, discard the entire validated advisor
worktree as specified in Step 5, regardless of its internal commits or edits.

**Step 12: Run tests**

```powershell
bun test src/config/types.test.ts src/config/writer.test.ts src/execution/evaluate.test.ts src/execution/exploration/advisor-sandbox.test.ts src/execution/exploration/harness.test.ts src/execution/exploration/evaluation-sandbox.test.ts src/execution/exploration/explore.test.ts
```

Expected: all orchestrator tests pass.

**Step 13: Commit**

```powershell
git add cli/src/execution/exploration cli/src/execution/index.ts cli/src/execution/evaluate.ts cli/src/execution/evaluate.test.ts cli/src/config/types.ts cli/src/config/types.test.ts cli/src/config/writer.ts cli/src/config/writer.test.ts
git commit -m "feat: add dual-loop exploration orchestrator"
```

---

### Task 8: Wire CLI options and mode routing

**Files:**

- Modify: `cli/src/config/types.ts`
- Modify: `cli/src/cli/args.ts`
- Modify: `cli/src/cli/args.test.ts`
- Modify: `cli/src/cli/commands/run.ts`
- Modify: `cli/src/cli/commands/run.test.ts`
- Modify: `cli/src/index.ts`

**Step 1: Write failing argument tests**

Assert defaults:

```ts
expect(options.explore).toBe(false);
expect(options.exploreAgents).toBe(3);
expect(options.exploreRounds).toBe(5);
expect(options.exploreStagnation).toBe(2);
expect(options.exploreRecoverLock).toBeUndefined();
```

Assert supplied values parse correctly.

**Step 2: Add runtime options**

```ts
explore: boolean;
exploreAgents: number;
exploreRounds: number;
exploreStagnation: number;
exploreRecoverLock?: string;
```

Add defaults to `DEFAULT_OPTIONS`.

**Step 3: Add Commander options**

Use the exact public option names from “User-visible behavior”.

Validate numbers centrally. Do not use `parseInt(...) || default` for values where zero must produce a validation error.

**Step 4: Add mutual-exclusion tests**

Cases:

- `--explore --optimize` rejected;
- `--explore --compete` rejected;
- `--explore --parallel` rejected;
- `--explore --dry-run` rejected in v1 before archive, evaluator, advisor, worktree, commit, or merge
  activity;
- `--explore` without `--evaluate` rejected;
- `--explore-agents 1` and `--explore-agents 2` rejected;
- valid explore options reach `runExploration`.
- `--explore-recover-lock <token>` works without a task/evaluator, is rejected alongside every
  execution mode, calls only the stale-lock quarantine helper, and exits without continuing.

**Step 5: Wire single-task and PRD routes**

Follow the existing optimize/competition routing in both:

- `cli/src/index.ts`
- `cli/src/cli/commands/run.ts`

For PRD mode, preserve current optimize/competition behavior: select the first task as the
exploration target and do not mutate its completion checkbox/status. Exploration treats the PRD as
a target source, not as a sequential checklist.

Construct every `ExploreOptions` field explicitly in both routes:

- direct single-task mode passes `protectedControlPatterns: []`;
- PRD file mode resolves the actual source and passes its repository-relative exact path when it is
  inside `workDir`;
- PRD folder mode passes the repository-relative `<folder>/**` pattern, after validating it with the
  same boundary parser;
- external/GitHub sources pass no local control pattern and never expose an absolute path to model
  prompts;
- both routes map `config.evaluation.protected_paths` to `evaluationProtectedPaths` and
  `config.evaluation.mutable_paths` to `evaluationMutablePaths`;
- both routes map
  `config.evaluation.allow_unverified_dependencies` to
  `allowUnverifiedEvaluatorDependencies`.

Add routing assertions for all four values. A fake worker that edits the real Markdown/YAML/JSON
PRD file or a file in a PRD source folder must reach the boundary gate and be rejected.

**Step 6: Run focused tests**

```powershell
bun test src/cli/args.test.ts src/cli/commands/run.test.ts
```

**Step 7: Commit**

```powershell
git add cli/src/config/types.ts cli/src/cli/args.ts cli/src/cli/args.test.ts cli/src/cli/commands/run.ts cli/src/cli/commands/run.test.ts cli/src/index.ts
git commit -m "feat: expose dual-loop exploration CLI mode"
```

---

### Task 9: Add end-to-end integration coverage

**Files:**

- Create: `cli/src/execution/exploration/explore.integration.test.ts`
- Add fixture scripts under the test temporary directory at runtime; do not commit generated fixture repositories.

**Step 1: Write a temporary git-repository fixture**

The fixture should contain:

- a numeric value file;
- a deterministic evaluation script that prints JSON score;
- a fake engine implementation that applies card-specific changes;
- a clean initial commit.

**Step 2: Write the integration scenarios**

Scenario A: baseline is 10; three candidates score 8, 9, and 10.

Expected:

- no merge;
- HEAD unchanged;
- all three experiment events archived;
- round-finalization intent and matching no-winner result archived, with no selection-intent;
- worktrees cleaned.

Scenario B: baseline is 10; three candidates score 9, 12, and 10, and the critic qualifies the
score-12 card.

Expected:

- score-12 candidate fast-forwarded;
- next round baseline is 12;
- losing strategy remains in archive;
- a round-finalization intent precedes critic/finalization;
- a selection-intent names the score-12 card before base movement;
- the matching applied round-finalization result records the resulting commit;
- no hard-reset fallback occurs.

Scenario C: first two exploration-qualified attempts from `caching` do not improve.

Expected:

- policy reports `caching` saturated in every later portfolio, not only the next one;
- a same-mechanism retry is rejected;
- a later caching card is allowed only when its mechanism/falsifier passes the novelty-unlock
  thresholds;
- if that unlocked attempt crashes or does not improve, `caching` remains saturated.

Scenario D: director returns two semantically duplicate cards with different family labels.

Expected:

- validation retry occurs;
- the cross-family relabel does not bypass similarity validation;
- no candidate starts before a valid portfolio exists.

Scenario E: a worker improves the score but changes a protected file.

Expected:

- candidate is archived as `boundary-violation`;
- evaluation and selection never run for that candidate;
- protected change is never staged or merged;
- base HEAD and protected file remain unchanged.

Scenario F: a worker improves the score by editing files outside every assigned target area.

Expected:

- candidate is archived as `strategy-violation`;
- the candidate gets no exploration credit and is not evaluated or merged;
- the next round still receives an unsatisfied direction constraint.

Scenario G: director and critic fake engines write files and make commits in their current
directories.

Expected:

- writes and commits exist only in their disposable detached advisor worktrees;
- advisor worktrees are removed after evidence is captured;
- base HEAD and filtered status are byte-for-byte unchanged.

Scenario H: a worker commits a protected-file change before returning.

Expected:

- candidate is archived as `worker-commit-violation`;
- controller does not evaluate or merge either committed or uncommitted worker changes;
- base HEAD remains unchanged.

Scenario I: the baseline or candidate evaluation fixture modifies a tracked file.

Expected:

- baseline mutation aborts before the director starts;
- candidate mutation discards its reported score and returns `evaluation-failed`;
- neither path is automatically reset;
- the affected worktree is preserved and reported.

Scenario J: the target fixture intentionally does not ignore `.ralphy/`, and the fake engine creates
only `.ralphy/logs/session.jsonl` plus an otherwise valid candidate.

Expected:

- the known untracked log is never staged;
- the candidate can still be evaluated and selected;
- cleanup removes only the validated untracked log path;
- the candidate worktree is removed normally.

Scenario K: archive append fails at each round-finalization boundary.

Expected:

- round-finalization-intent append failure prevents the critic from starting;
- round-review append failure leaves finalization intent unresolved and preserves every candidate;
- selection-intent append failure leaves base unchanged;
- result append failure after a successful fast-forward leaves both intents durable and the winner
  worktree/branch preserved;
- critic failure followed by no-winner result append failure also leaves a detectable unresolved
  finalization intent;
- the next run rejects either unresolved path before evaluation and prints recovery evidence.

Scenario L: the fixture has an unborn repository or explicitly checks out a detached HEAD.

Expected:

- preflight rejects both;
- no evaluator, director, critic, or worker starts.

Scenario M: several familiar families already have exploration credit while at least three families
have none.

Expected:

- challenger requirements are assigned from the zero-credit families;
- a credited family with an unsatisfied constraint still cannot jump ahead of an available
  zero-credit family;
- the director cannot substitute a familiar family;
- after credit is recorded, debt ordering advances to the remaining uncredited families.

Scenario N: the highest-scoring candidate passes every deterministic evaluation but the critic
reports `mechanismAttempted: false` or `duplicateOf`.

Expected:

- the candidate is reported as a performance discovery and its commit is archived;
- it is excluded from selection and never becomes champion/exploit parent;
- if no other qualified improvement exists, base HEAD remains unchanged with a no-winner result;
- its intended direction returns as an unsatisfied constraint.

Scenario O: a zero-credit `numerical` family is not applicable to the fixture's exact,
integer-only algorithm.

Expected:

- a generic director deferral is rejected and `numerical` remains required;
- a deferral with valid source evidence and no falsifiable numerical intervention is independently
  reviewed and archived;
- unassigned, credited, and saturated-family deferral requests are rejected mechanically even when
  one of those families occupies a challenger slot;
- an accepted deferral earns no credit; the controller picks the next debt family before making a
  separate proposal-only call, and that substitute successfully receives a card without spending
  the proposal retry;
- after a selected code change alters baseline commit/context fingerprint, the deferral expires and
  `numerical` is reconsidered.

Scenario P: invoke exploration twice on the same task, with both invocations starting at round 1;
then invoke it again with a changed metric objective or script.

Expected:

- both runs have distinct run/round/card IDs and critic findings never cross-join;
- the same evaluation context may reuse durable exploration history safely;
- changing script, effective metric key, objective, or protected harness contents creates a
  different evaluation context with no inherited champion, saturation, debt, deferral, or
  stagnation.

Scenario Q: approved deferrals leave fewer challenger families than requested, then a fixture where
all challenger families are actively deferred.

Expected:

- the partial case archives a portfolio adjustment and still dispatches at least one challenger;
- the exhausted case archives `no-applicable-frontier` and terminates cleanly;
- when the frontier was already exhausted before this invocation/round, every advisor and worker call
  count remains zero;
- it never runs exploit-only, loops on proposal validation, or starts workers without a meaningful
  challenger.

Scenario R: `--evaluate "python bench.py"` uses tracked `bench.py -> scorer.py/cases.json` plus
mutable `src/routing.py`.

Expected:

- config classifies `bench.py`, `scorer.py`, and `cases.json` as protected and `src/**` as mutable;
- editing a scorer/case/entrypoint is a boundary violation before evaluation;
- an assigned `src/routing.py` edit remains eligible for evaluation;
- changing protected harness contents or the protected/mutable classification creates a new
  evaluation context.

Scenario S: an evaluator contains a dynamic/unresolvable local dependency.

Expected:

- safe default preflight fails before baseline evaluation and prints the unresolved dependency plus
  a configuration example;
- adding explicit protected/mutable classification resolves it when possible;
- the unsafe override is the only way to proceed otherwise and produces a distinct
  `evaluationContextHash` with a prominent warning.

Scenario T: start two exploration invocations against separate worktrees of the same repository.

Expected:

- the first holds the git-common-dir lock;
- the second stops before archive read or evaluation and reports the bounded owner/token;
- normal/handled failure releases only its own token; confirmed-dead explicit recovery quarantines
  but does not delete or continue.

Scenario U: leave a durable finalization intent without its result, then change task, script, and
harness.

Expected:

- the global archive recovery scan still blocks the new run;
- context filtering occurs only after all unresolved repository intents are cleared;
- duplicate/conflicting/orphan results also block and never count twice toward champion or
  stagnation.

Scenario V: seed the base and worker worktrees with ignored cache files that would print inflated
scores.

Expected:

- baseline and candidate scores come from separate fresh detached worktrees at their exact commits;
- neither ignored cache affects selection;
- the applied commit reproduces the selected score under the same fresh-evaluation procedure.

**Step 3: Run integration tests**

```powershell
bun test src/execution/exploration/explore.integration.test.ts
```

**Step 4: Run all exploration tests**

```powershell
bun test src/execution/selection.test.ts src/execution/exploration
```

**Step 5: Commit**

```powershell
git add cli/src/execution/exploration/explore.integration.test.ts
git commit -m "test: cover dual-loop exploration end to end"
```

---

### Task 10: Document the feature and finish verification

**Files:**

- Modify: `README.md`
- Modify: `cli/README.md`
- Modify: `CLAUDE.md` only if a new permanent repository rule is genuinely required

**Step 1: Document the command**

Include:

- purpose of outer and inner loops;
- full CLI example;
- options and defaults;
- evaluation-script contract;
- meaning of strategy families;
- exploration debt, saturation unlocks, and audited task-inapplicable deferrals;
- archive location;
- run-scoped IDs and evaluation-context isolation;
- strict baseline behavior;
- warning that more agent calls do not equal higher model intelligence;
- repository-wide run locking, stale-lock quarantine, and recovery behavior when a winner cannot be
  safely fast-forwarded;
- advisor isolation and the protected-path/assigned-route hard gates;
- `--explore --dry-run` rejection in v1;
- the limitation that path-level strategy adherence is mechanically enforced while semantic
  adherence is reviewer-guided and requeued, not formally proven.

**Step 2: Document evaluator responsibility**

State explicitly:

- exit code enforces correctness and hard constraints;
- scalar score chooses improvement direction;
- hidden/holdout cases belong inside the user's evaluation script;
- evaluator entrypoints, package scripts, protected dependencies, and mutable candidate dependencies
  are classified before execution;
- scorer/fixture/holdout paths belong in `evaluation.protected_paths`, while code intentionally under
  optimization belongs in `evaluation.mutable_paths`;
- unclassified or unresolved local dependencies fail closed by default; the explicit
  `allow_unverified_dependencies` override disables that guarantee, prints a warning, and creates a
  separate evaluation context;
- both baseline and candidate evaluation run in fresh detached worktrees at exact commits, so worker
  or base ignored caches cannot manufacture a non-reproducible score;
- the evaluator may create repository-ignored build output, but must not move HEAD or change staged,
  tracked, or non-ignored user-code state;
- deterministic evaluation is necessary but not sufficient in `--explore`;
- the critic may withhold exploration qualification and thereby exclude an off-strategy,
  duplicated, or unverified improvement, but it can never make a failing candidate mergeable.

**Step 3: Run formatting/check**

```powershell
cd E:\Ecode\ralphy\cli
bun run check
```

Review any automatic edits made by Biome before proceeding.

**Step 4: Run the full test suite**

```powershell
bun test
```

Expected: zero failed tests.

**Step 5: Run the CLI help smoke test**

```powershell
bun run src/index.ts --help
```

Expected help output contains:

```text
--explore
--explore-agents
--explore-rounds
--explore-stagnation
--explore-recover-lock
```

**Step 6: Run a non-publishing build smoke test**

```powershell
$exploreBuildCheck = Join-Path $env:TEMP ("ralphy-explore-" + [guid]::NewGuid() + ".js")
bun build src/index.ts --target=bun --outfile "$exploreBuildCheck"
```

Expected: exit code 0. Remove only that temporary file after confirming the result:

```powershell
Remove-Item -LiteralPath "$exploreBuildCheck"
```

Do not publish packages.

**Step 7: Commit docs and any reviewed formatter-only edits**

```powershell
git add README.md cli/README.md
git commit -m "docs: explain dual-loop exploration mode"
```

If Step 3 formatted feature files, review and stage those exact files explicitly in a separate
formatting-only commit before the documentation commit. Do not stage the whole repository.

**Step 8: Inspect the final diff**

Use the exact committed SHA from which the feature worktree was created; do not approximate it with
`HEAD~N`:

```powershell
$featureBaseCommit = "<paste the recorded FEATURE_BASE_COMMIT SHA here>"
git status --short
git diff --stat "$featureBaseCommit..HEAD"
git diff --check "$featureBaseCommit..HEAD"
```

Confirm:

- worktree is clean;
- no lockfiles changed;
- no generated binaries added;
- no PRD/progress files changed;
- no unrelated refactors;
- every new module has focused tests.

---

## Acceptance criteria

Implementation is complete only when all of these are demonstrated by tests or fresh command output:

- [ ] `--explore` is a separate, documented mode.
- [ ] `--explore` requires at least three agents and rejects `--dry-run` in v1.
- [ ] Unchanged HEAD is evaluated in a fresh detached worktree at its exact commit before any
      director or worker modifies code.
- [ ] A batch winner that does not beat the baseline is never merged.
- [ ] Round 1 workers receive unique challenger families.
- [ ] Later normal rounds assign exploit, adjacent, and challenger roles.
- [ ] Challenger requirements prioritize uncredited and least-attempted families by exploration
      debt.
- [ ] A family can leave the current debt frontier as not applicable only with concrete repository
      evidence and independent approval; deferral gives no credit and expires on context change.
- [ ] Deferrals are resolved before a separate proposal-only call, cannot target unassigned
      families, and cannot silently exhaust all challenger slots.
- [ ] A partially exhausted frontier is audibly shrunk while retaining a challenger; a fully
      exhausted frontier emits `no-applicable-frontier` and terminates explicitly.
- [ ] Stagnation mechanically removes exploit; a saturated family receives at most a one-attempt
      materially novel unlock and stays saturated unless an exploration-qualified strict improvement
      is applied.
- [ ] Duplicate strategy cards, including cross-family relabels, are rejected before worktrees
      start.
- [ ] Challenger workers do not receive the full incumbent narrative.
- [ ] Director, deferral-review, and critic calls run only in disposable detached advisor
      worktrees.
- [ ] Advisor writes/commits cannot move or dirty the base branch.
- [ ] Baseline evaluation cannot silently mutate the state whose score is recorded or reuse ignored
      base-worktree cache state.
- [ ] Evaluator entrypoint/dependencies are classified as protected harness or mutable candidate
      code; unclassified local dependencies fail closed unless the user explicitly enables the
      context-isolated unsafe override.
- [ ] Protected evaluator/scorer/holdout paths and mutable classification are fingerprinted into the
      evaluation context without prohibiting declared mutable algorithm code.
- [ ] Protected-path and user-boundary checks run before candidate commit and evaluation.
- [ ] Candidate status expands all untracked files; staging uses literal per-file pathspecs; staged
      and committed diff paths exactly match the approved set.
- [ ] Worker-created commits are rejected before evaluation.
- [ ] Candidate evaluation runs in a fresh detached worktree at the exact controller commit, cannot
      reuse worker ignored caches, and cannot mutate the commit/state whose score is used.
- [ ] A patch outside its assigned target areas is archived as `strategy-violation` and cannot merge.
- [ ] A semantic non-adherence, cross-family duplicate, or unverified critic result withholds
      exploration credit, requeues the direction, and excludes that candidate from `--explore`
      selection.
- [ ] All candidates, including crashes, eligible non-winners, and losers, are archived.
- [ ] Invalid/duplicate director portfolios are archived before retry.
- [ ] Every archive line is validated by the discriminated-union Zod schema.
- [ ] Every critic-bound round writes a finalization intent first; winner selection additionally
      uses selection-intent-before-apply and finalization-result-after-apply.
- [ ] Missing review or finalization result leaves a detectable unresolved intent that stops
      automatic continuation and includes recovery evidence.
- [ ] Unresolved intents are scanned across the whole repository archive before context filtering;
      changing task/evaluator cannot bypass recovery.
- [ ] Orphan, duplicate, out-of-order, or mismatched causal events block recovery and cannot
      double-count champion or stagnation.
- [ ] Experiment writes precede finalization intent; durable review precedes selection;
      selection-intent precedes merge; round-finalization-result precedes cleanup.
- [ ] Run/round/card IDs are unique across repeated invocations and never cross-join state.
- [ ] Derived state is isolated by task plus exact script, effective metric key, objective, harness
      fingerprint, protected/mutable classification, and evaluator safety mode.
- [ ] Critic output is structured and counterfactual; it may veto exploration qualification but
      cannot authorize a merge.
- [ ] Critic failure yields no exploration-qualified winner rather than silently accepting an
      unverified route.
- [ ] No candidate merges without both strict deterministic improvement and exploration
      qualification.
- [ ] Winner application is non-destructive and never hard-resets the user's base.
- [ ] A git-common-dir lock prevents concurrent exploration across linked worktrees; stale recovery
      requires a matching token and confirmed-dead owner and only quarantines the lock.
- [ ] Cleanup removes only validated untracked `.ralphy/logs/**` noise in disposable worktrees and
      preserves every unexplained dirty worktree.
- [ ] Existing `--optimize` and `--compete` modes reject first-round/batch regression.
- [ ] Unborn repositories and user-invoked detached HEADs are rejected.
- [ ] Existing tests still pass.
- [ ] New unit and integration tests pass.
- [ ] CLI help and documentation match implemented option names.

## Fixed-budget A/B validation after implementation

Do not claim that the new mode improves search efficiency solely because the feature works.

Run comparable tasks under equal model, token/call, and wall-time budgets:

```text
A: existing --compete
B: new --explore
```

Count director, deferral-review, worker, and critic calls/tokens against B's budget; do not compare
only inner-worker cost.

Record:

- best held-out score;
- time/calls to first strict improvement;
- number of unique strategy families actually executed;
- duplicate proposal rejection rate;
- cross-family duplicate rejection rate;
- family-deferral request/approval/expiry rates;
- route-compliance rejection rate;
- number of strategy families credited after counterfactual review;
- fraction of challenger slots assigned from zero-credit exploration debt;
- strict performance improvements withheld as off-strategy/unverified;
- rounds recovered after stagnation;
- regressions merged (must be zero);
- score improvement per model call.

The feature meets its product objective when `--explore` consistently increases independently
credited mechanisms, reduces repeated causal strategies even under family relabeling, or finds
held-out improvements missed by `--compete`, without increasing regression merges.

## Handoff instruction for the new agent

Copy this entire file into the implementation session and issue:

```text
Implement the attached Ralphy Dual-Loop Exploration Mode plan in E:\Ecode\ralphy.
Use superpowers:executing-plans.
Work in a dedicated clean worktree.
Execute tasks in order with TDD and one logical commit per task.
Do not redesign the architecture, copy AERO source, publish packages, or use destructive operations on the base worktree.
Pause and report concrete evidence if a repository mismatch prevents a stated step.
```
