import { describe, expect, it } from "bun:test";
import {
	computeActiveDeferrals,
	computeExplorationContextFingerprint,
	computeFamilyStates,
	computePortfolioRequirements,
	isSaturationUnlock,
	rankFamiliesByExplorationDebt,
	strategySimilarity,
	validatePortfolio,
} from "./policy.ts";
import type { ExploreEvent, StrategyFamily, StrategyProposal } from "./types.ts";

const CONTEXT = "evaluation-context";
const TRACKED = ["src/search.ts", "src/cache/index.ts", "test/search.test.ts"];

function envelope(round = 1, evaluationContextHash = CONTEXT) {
	return {
		version: 1 as const,
		runId: "run-a",
		roundId: `run-a:r${round}`,
		taskHash: "task",
		evaluationContextHash,
		timestamp: `2026-07-${String(round).padStart(2, "0")}T00:00:00.000Z`,
		round,
	};
}

function stateFor(
	states: Map<
		StrategyFamily,
		ReturnType<typeof computeFamilyStates> extends Map<StrategyFamily, infer State> ? State : never
	>,
	family: StrategyFamily,
) {
	const state = states.get(family);
	if (!state) throw new Error(`missing ${family} state`);
	return state;
}

function itemAt<T>(items: readonly T[], index: number): T {
	const item = items[index];
	if (item === undefined) throw new Error(`missing item ${index}`);
	return item;
}
function proposal(
	family: StrategyFamily,
	overrides: Partial<StrategyProposal> = {},
): StrategyProposal {
	return {
		slot: "challenger",
		family,
		title: `${family} strategy`,
		bottleneck: "Repeated full scans dominate the measured execution time",
		hypothesis: "Reducing repeated scans will lower the measured execution time",
		mechanism: "Build a compact index and query it instead of scanning every record",
		expectedImpact: "Fewer repeated scans",
		targetAreas: ["src/search.ts"],
		supportAreas: ["test/search.test.ts"],
		forbiddenAreas: [".ralphy/**"],
		falsifier: "The evaluation score does not improve after the index is used",
		differenceFromHistory: "This uses a distinct indexed lookup mechanism",
		forbiddenMechanisms: ["Reuse the incumbent full scan"],
		...overrides,
	};
}

function experiment(
	id: string,
	family: StrategyFamily,
	status: Extract<ExploreEvent, { type: "experiment" }>["status"],
	round: number,
	options: {
		context?: string;
		routeCompliant?: boolean;
		candidateScore?: number | null;
	} = {},
): Extract<ExploreEvent, { type: "experiment" }> {
	return {
		...envelope(round, options.context),
		type: "experiment",
		card: { ...proposal(family), id, round },
		baselineScore: 10,
		candidateScore:
			options.candidateScore === undefined
				? status === "eligible"
					? 11
					: status === "no-improvement"
						? 10
						: null
				: options.candidateScore,
		candidateCommit: status === "eligible" || status === "no-improvement" ? `commit-${id}` : null,
		branchName: `candidate/${id}`,
		status,
		changedFiles: options.routeCompliant === false ? [] : ["src/search.ts"],
		routeCompliant: options.routeCompliant ?? true,
		violations: options.routeCompliant === false ? ["route violation"] : [],
		diffFingerprint: `diff-${id}`,
		evaluationOutput: "",
	};
}

function review(
	id: string,
	round: number,
	options: { attempted?: boolean; duplicateOf?: string | null; context?: string } = {},
): Extract<ExploreEvent, { type: "round-review" }> {
	return {
		...envelope(round, options.context),
		type: "round-review",
		findings: [
			{
				cardId: id,
				mechanismAttempted: options.attempted ?? true,
				duplicateOf: options.duplicateOf ?? null,
				evidenceProblems: [],
				failureCause: "",
				lesson: "",
				nextConstraint: "Try a mechanically distinct route",
			},
		],
	};
}

function appliedResult(
	id: string,
	round: number,
): [
	Extract<ExploreEvent, { type: "round-finalization-intent" }>,
	Extract<ExploreEvent, { type: "selection-intent" }>,
	Extract<ExploreEvent, { type: "round-finalization-result" }>,
] {
	const common = envelope(round);
	const intentId = `intent-${round}`;
	return [
		{
			...common,
			type: "round-finalization-intent",
			intentId,
			baselineCommit: `base-${round}`,
			baselineScore: 10,
			performanceCandidates: [
				{
					cardId: id,
					score: 11,
					candidateCommit: `commit-${id}`,
					branchName: `candidate/${id}`,
				},
			],
		},
		{
			...common,
			type: "selection-intent",
			roundIntentId: intentId,
			baselineCommit: `base-${round}`,
			baselineScore: 10,
			selectedCardId: id,
			selectedScore: 11,
			candidateCommit: `commit-${id}`,
			branchName: `candidate/${id}`,
		},
		{
			...common,
			type: "round-finalization-result",
			roundIntentId: intentId,
			baselineCommit: `base-${round}`,
			baselineScore: 10,
			selectedCardId: id,
			selectedScore: 11,
			outcome: "applied",
			resultingCommit: `commit-${id}`,
		},
	];
}

function acceptedDeferral(
	family: StrategyFamily,
	contextFingerprint: string,
	options: { outcome?: "accepted" | "rejected"; reviewed?: boolean } = {},
): Extract<ExploreEvent, { type: "family-deferral" }> {
	const reviewed = options.reviewed ?? true;
	const accepted = options.outcome !== "rejected" && reviewed;
	return {
		...envelope(),
		type: "family-deferral",
		contextFingerprint,
		proposal: {
			family,
			reason: "No repository path provides a falsifiable intervention for this family",
			evidencePaths: ["src/search.ts"],
			missingFalsifier: "No observable family-specific effect exists in this repository",
			reconsiderWhen: "Tracked implementation or baseline evidence changes",
		},
		review: reviewed
			? {
					family,
					approved: accepted,
					evidenceSufficient: accepted,
					rationale: "The repository evidence supports the recorded decision",
					reconsiderConstraint: "Reconsider after repository evidence changes",
				}
			: null,
		outcome: accepted ? "accepted" : "rejected",
		...(reviewed ? {} : { error: "review unavailable" }),
	};
}

describe("computeExplorationContextFingerprint", () => {
	it("is stable and changes when any scoped input changes", () => {
		const input = {
			evaluationContextHash: "task-and-evaluator",
			baselineCommit: "abc123",
			inventoryFingerprint: "inventory-a",
			baselineScore: 10,
			evaluationOutputFingerprint: "evidence-a",
		};
		const first = computeExplorationContextFingerprint(input);
		expect(first).toMatch(/^[a-f0-9]{64}$/);
		expect(computeExplorationContextFingerprint({ ...input })).toBe(first);
		for (const changed of [
			{ evaluationContextHash: "changed" },
			{ baselineCommit: "changed" },
			{ inventoryFingerprint: "changed" },
			{ baselineScore: 11 },
			{ evaluationOutputFingerprint: "changed" },
		]) {
			expect(computeExplorationContextFingerprint({ ...input, ...changed })).not.toBe(first);
		}
	});
});

describe("computeFamilyStates", () => {
	it("filters contexts and saturates only qualified no-improvement attempts", () => {
		const events: ExploreEvent[] = [
			experiment("foreign", "caching", "no-improvement", 1, { context: "other" }),
			review("foreign", 1, { context: "other" }),
			experiment("cache-1", "caching", "no-improvement", 1),
			review("cache-1", 1),
			experiment("cache-crash", "caching", "agent-crash", 2),
			experiment("cache-2", "caching", "no-improvement", 3),
			review("cache-2", 3),
		];
		const state = computeFamilyStates(events, CONTEXT, 2).get("caching");
		expect(state).toMatchObject({
			creditCount: 2,
			qualifiedAttemptCount: 2,
			totalAttemptCount: 3,
			unsatisfiedConstraintCount: 1,
			noImprovementStreak: 2,
			saturated: true,
		});
		expect(state?.qualifiedFailedProposals).toHaveLength(2);
	});

	it("does not credit gate violations, missing critic coverage, or semantic duplicates", () => {
		const events: ExploreEvent[] = [
			experiment("boundary", "algorithm", "boundary-violation", 1, {
				routeCompliant: false,
			}),
			experiment("unreviewed", "algorithm", "no-improvement", 2),
			experiment("duplicate", "algorithm", "no-improvement", 3),
			review("duplicate", 3, { duplicateOf: "older-card" }),
			experiment("not-attempted", "algorithm", "no-improvement", 4),
			review("not-attempted", 4, { attempted: false }),
		];
		const state = computeFamilyStates(events, CONTEXT, 2).get("algorithm");
		expect(state).toMatchObject({
			creditCount: 0,
			qualifiedAttemptCount: 0,
			totalAttemptCount: 4,
			unsatisfiedConstraintCount: 4,
			noImprovementStreak: 0,
			saturated: false,
		});
	});

	it("clears a saturated streak only after a qualified strict improvement is applied", () => {
		const events: ExploreEvent[] = [
			experiment("cache-1", "caching", "no-improvement", 1),
			review("cache-1", 1),
			experiment("cache-2", "caching", "no-improvement", 2),
			review("cache-2", 2),
			experiment("cache-winner", "caching", "eligible", 3),
			review("cache-winner", 3),
			...appliedResult("cache-winner", 3),
		];
		const state = computeFamilyStates(events, CONTEXT, 2).get("caching");
		expect(state).toMatchObject({
			creditCount: 3,
			noImprovementStreak: 0,
			saturated: false,
		});
		expect(state?.qualifiedFailedProposals).toEqual([]);
	});
});

describe("deferral and debt policy", () => {
	it("activates only accepted decisions for the exact context fingerprint", () => {
		const events: ExploreEvent[] = [
			acceptedDeferral("algorithm", "current"),
			acceptedDeferral("caching", "old"),
			acceptedDeferral("pruning", "current", { outcome: "rejected" }),
			acceptedDeferral("runtime", "current", { reviewed: false }),
			acceptedDeferral("algorithm", "current"),
		];
		expect([...computeActiveDeferrals(events, "current")]).toEqual(["algorithm"]);
	});

	it("orders zero-credit unsaturated families before credited or saturated families", () => {
		const states = computeFamilyStates([], CONTEXT, 2);
		Object.assign(stateFor(states, "algorithm"), {
			creditCount: 1,
			qualifiedAttemptCount: 1,
			totalAttemptCount: 1,
			unsatisfiedConstraintCount: 5,
		});
		Object.assign(stateFor(states, "data-structure"), { totalAttemptCount: 2 });
		Object.assign(stateFor(states, "memory-layout"), { unsatisfiedConstraintCount: 1 });
		Object.assign(stateFor(states, "caching"), {
			creditCount: 2,
			qualifiedAttemptCount: 2,
			totalAttemptCount: 2,
			noImprovementStreak: 2,
			saturated: true,
		});
		const ranked = rankFamiliesByExplorationDebt(states, new Set(["pruning"]));
		expect(ranked.slice(0, 3)).toEqual(["memory-layout", "parallelism", "precomputation"]);
		expect(ranked.indexOf("data-structure")).toBeLessThan(ranked.indexOf("algorithm"));
		expect(ranked.at(-1)).toBe("caching");
		expect(ranked).not.toContain("pruning");
	});
});

describe("computePortfolioRequirements", () => {
	it("assigns unique debt-ranked challengers in round one", () => {
		const requirements = computePortfolioRequirements(
			3,
			null,
			false,
			computeFamilyStates([], CONTEXT, 2),
			new Set(),
			TRACKED,
		);
		expect(requirements.slots).toEqual([
			{ slot: "challenger", family: "algorithm", requiresNovelUnlock: false },
			{ slot: "challenger", family: "data-structure", requiresNovelUnlock: false },
			{ slot: "challenger", family: "memory-layout", requiresNovelUnlock: false },
		]);
		expect(requirements).toMatchObject({
			requestedAgents: 3,
			effectiveAgents: 3,
			adjusted: false,
			terminal: false,
			trackedInventory: TRACKED,
		});
	});

	it("returns exploit, adjacent, and an exact challenger in a normal round", () => {
		const requirements = computePortfolioRequirements(
			3,
			"algorithm",
			false,
			computeFamilyStates([], CONTEXT, 2),
			new Set(),
			TRACKED,
		);
		expect(requirements.slots.map((slot) => slot.slot)).toEqual([
			"exploit",
			"adjacent",
			"challenger",
		]);
		expect(requirements.slots[0]?.family).toBe("algorithm");
		expect(requirements.slots[2]?.family).toBe("data-structure");
	});

	it("replaces exploit during stagnation and audibly represents partial and full shortage", () => {
		const states = computeFamilyStates([], CONTEXT, 2);
		const deferred = new Set<StrategyFamily>([
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
		] as const);
		const partial = computePortfolioRequirements(3, "algorithm", true, states, deferred, TRACKED);
		expect(partial.slots).toEqual([
			{ slot: "challenger", family: "data-structure", requiresNovelUnlock: false },
			{ slot: "adjacent", family: null, requiresNovelUnlock: false },
		]);
		expect(partial).toMatchObject({ effectiveAgents: 2, adjusted: true, terminal: false });
		const full = computePortfolioRequirements(
			3,
			"algorithm",
			true,
			states,
			new Set([...deferred, "algorithm", "data-structure"]),
			TRACKED,
		);
		expect(full).toMatchObject({ effectiveAgents: 0, adjusted: true, terminal: true });
		expect(full.slots).toEqual([]);
	});
});

describe("similarity and portfolio validation", () => {
	it("detects cross-family relabels but not genuinely different mechanisms", () => {
		const original = proposal("algorithm");
		const relabel = proposal("caching");
		expect(strategySimilarity(original, relabel)).toBeGreaterThanOrEqual(0.78);
		const distinct = proposal("parallelism", {
			bottleneck: "Independent shards wait on one serial coordinator during every batch",
			hypothesis: "Running independent shards concurrently will remove coordinator idle time",
			mechanism: "Dispatch isolated shards to worker threads and reduce their results once",
			falsifier: "Thread scheduling overhead offsets all concurrency gains in the evaluation",
			targetAreas: ["src/cache/index.ts"],
			supportAreas: [],
		});
		expect(strategySimilarity(original, distinct)).toBeLessThan(0.78);
	});

	it("normalizes Unicode punctuation and ignores differenceFromHistory as novelty evidence", () => {
		const original = proposal("algorithm");
		const normalized = proposal("caching", {
			bottleneck: "ＲＥＰＥＡＴＥＤ—full scans dominate the measured execution time!!!",
			differenceFromHistory: "A completely different self-reported story",
		});
		expect(strategySimilarity(original, normalized)).toBeGreaterThanOrEqual(0.78);
	});

	it("allows a saturation unlock only when every failed route is mechanically novel", () => {
		const first = proposal("caching");
		const second = proposal("caching", {
			bottleneck: "Tree traversal repeatedly allocates temporary node arrays per lookup",
			hypothesis: "Eliminating temporary arrays will reduce allocation and collection overhead",
			mechanism: "Use a preallocated flat node buffer with integer offsets for traversal",
			falsifier: "Allocation counts fall but the measured evaluation score remains unchanged",
			targetAreas: ["src/cache/index.ts"],
			supportAreas: [],
		});
		const nearFirst = proposal("caching", { differenceFromHistory: "Claims to be novel" });
		expect(isSaturationUnlock(nearFirst, [first, second])).toBe(false);

		const novel = proposal("caching", {
			bottleneck: "Independent cache partitions serialize through one global eviction lock",
			hypothesis: "Partition-local admission and eviction will eliminate lock contention",
			mechanism: "Shard the cache and maintain independent admission queues per partition",
			falsifier: "Contention disappears but end-to-end throughput does not increase",
			targetAreas: ["src/cache/index.ts"],
			supportAreas: [],
		});
		expect(isSaturationUnlock(novel, [first, second])).toBe(true);
		expect(isSaturationUnlock(novel, [])).toBe(false);
	});

	it("validates exact slots and challenger assignments with explainable duplicate diagnostics", () => {
		const states = computeFamilyStates([], CONTEXT, 2);
		const requirements = computePortfolioRequirements(3, null, false, states, new Set(), TRACKED);
		const valid = requirements.slots.map((required, index) =>
			proposal(
				itemAt(
					[required.family].filter((family): family is StrategyFamily => family !== null),
					0,
				),
				{
					slot: required.slot,
					title: `Distinct strategy ${index}`,
					bottleneck: `Measured bottleneck number ${index} consumes the dominant runtime budget`,
					hypothesis: `Changing mechanism number ${index} will improve the external evaluation`,
					mechanism: `Apply independent mechanism number ${index} to the assigned target path`,
					falsifier: `External evaluation disproves mechanism number ${index} after implementation`,
					targetAreas: [itemAt(TRACKED, index)],
					supportAreas: [],
				},
			),
		);
		expect(validatePortfolio(valid, requirements, [])).toMatchObject({ ok: true, reasons: [] });

		const substituted = valid.map((item) => ({ ...item }));
		substituted[0] = { ...itemAt(substituted, 0), family: "runtime" };
		expect(validatePortfolio(substituted, requirements, []).ok).toBe(false);

		const duplicate = valid.map((item) => ({ ...item }));
		duplicate[1] = { ...itemAt(duplicate, 0), family: itemAt(valid, 1).family };
		const rejected = validatePortfolio(duplicate, requirements, []);
		expect(rejected.ok).toBe(false);
		expect(rejected.diagnostics[0]).toMatchObject({
			proposalIndex: 1,
			comparedTo: "proposal:0",
		});
		expect(rejected.diagnostics[0]).toHaveProperty("causalSimilarity");
		expect(rejected.diagnostics[0]).toHaveProperty("pathSimilarity");
		expect(rejected.diagnostics[0]).toHaveProperty("familyBonus");
		expect(rejected.diagnostics[0]).toHaveProperty("overallSimilarity");
		expect(rejected.diagnostics[0]).toHaveProperty("mechanismSimilarity");
		expect(rejected.diagnostics[0]).toHaveProperty("falsifierSimilarity");
	});

	it("checks current and historical duplicates, including cross-family relabels", () => {
		const states = computeFamilyStates([], CONTEXT, 2);
		const requirements = computePortfolioRequirements(1, null, false, states, new Set(), TRACKED);
		const historical = proposal("algorithm");
		const relabel = proposal("data-structure", {
			slot: "challenger",
			title: "Relabelled index strategy",
		});
		const result = validatePortfolio([relabel], requirements, [historical]);
		expect(result.ok).toBe(false);
		expect(result.diagnostics[0]?.comparedTo).toBe("history:0");
	});

	it.each([
		"/src/search.ts",
		"C:\\repo\\src\\search.ts",
		"\\\\server\\share\\search.ts",
		"src/../secret.ts",
		"../secret.ts",
		"**",
		"missing/**",
	])("rejects unsafe or inventory-free target pattern %s", (targetArea) => {
		const states = computeFamilyStates([], CONTEXT, 2);
		const requirements = computePortfolioRequirements(1, null, false, states, new Set(), TRACKED);
		const result = validatePortfolio(
			[proposal("algorithm", { targetAreas: [targetArea] })],
			requirements,
			[],
		);
		expect(result.ok).toBe(false);
	});

	it.each(["src/search.ts", "src", "src/*.ts", "src/**", "src\\*.ts"])(
		"accepts safe inventory-backed target pattern %s",
		(targetArea) => {
			const states = computeFamilyStates([], CONTEXT, 2);
			const requirements = computePortfolioRequirements(1, null, false, states, new Set(), TRACKED);
			const result = validatePortfolio(
				[proposal("algorithm", { targetAreas: [targetArea] })],
				requirements,
				[],
			);
			expect(result.ok).toBe(true);
		},
	);

	it.each([
		"/support.ts",
		"C:\\repo\\support.ts",
		"\\\\server\\share\\support.ts",
		"../support.ts",
	])("rejects unsafe support patterns %s", (supportArea) => {
		const states = computeFamilyStates([], CONTEXT, 2);
		const requirements = computePortfolioRequirements(1, null, false, states, new Set(), TRACKED);
		expect(
			validatePortfolio([proposal("algorithm", { supportAreas: [supportArea] })], requirements, [])
				.ok,
		).toBe(false);
	});
});

describe("saturated frontier fallback", () => {
	it("uses saturated families only as marked novelty-unlock fallbacks", () => {
		const states = computeFamilyStates([], CONTEXT, 2);
		Object.assign(stateFor(states, "caching"), {
			creditCount: 2,
			qualifiedAttemptCount: 2,
			totalAttemptCount: 2,
			noImprovementStreak: 2,
			saturated: true,
			qualifiedFailedProposals: [proposal("caching")],
		});
		const deferrals = new Set<StrategyFamily>([
			"algorithm",
			"data-structure",
			"memory-layout",
			"pruning",
			"parallelism",
			"precomputation",
			"decomposition",
			"approximation",
			"numerical",
			"runtime",
			"other",
		]);
		const requirements = computePortfolioRequirements(1, null, false, states, deferrals, TRACKED);
		expect(requirements.slots).toEqual([
			{ slot: "challenger", family: "caching", requiresNovelUnlock: true },
		]);
		expect(validatePortfolio([proposal("caching")], requirements, [proposal("caching")]).ok).toBe(
			false,
		);
	});
});

describe("Task 4 review regressions", () => {
	it("excludes a stagnant incumbent from replacement challengers when another family is available", () => {
		const requirements = computePortfolioRequirements(
			3,
			"algorithm",
			true,
			computeFamilyStates([], CONTEXT, 2),
			new Set(),
			TRACKED,
		);
		expect(requirements.slots[0]?.family).toBe("data-structure");
		expect(requirements.slots.some((slot) => slot.family === "algorithm")).toBe(false);
	});

	it("does not reset saturation from a damaged finalization causal chain", () => {
		const causal = appliedResult("cache-winner", 3);
		const selection = causal[1];
		selection.baselineCommit = "wrong-base";
		const state = computeFamilyStates(
			[
				experiment("cache-1", "caching", "no-improvement", 1),
				review("cache-1", 1),
				experiment("cache-2", "caching", "no-improvement", 2),
				review("cache-2", 2),
				experiment("cache-winner", "caching", "eligible", 3),
				review("cache-winner", 3),
				...causal,
			],
			CONTEXT,
			2,
		).get("caching");
		if (!state) throw new Error("missing caching state");
		expect(state.noImprovementStreak).toBe(2);
		expect(state.saturated).toBe(true);
	});

	it("uses recorded qualified failed proposals for saturated-family unlock validation", () => {
		const states = computeFamilyStates([], CONTEXT, 2);
		const cached = states.get("caching");
		if (!cached) throw new Error("missing caching state");
		Object.assign(cached, {
			creditCount: 2,
			qualifiedAttemptCount: 2,
			totalAttemptCount: 2,
			noImprovementStreak: 2,
			saturated: true,
			qualifiedFailedProposals: [proposal("caching")],
		});
		const deferred = new Set<StrategyFamily>([
			"algorithm",
			"data-structure",
			"memory-layout",
			"pruning",
			"parallelism",
			"precomputation",
			"decomposition",
			"approximation",
			"numerical",
			"runtime",
			"other",
		]);
		const requirements = computePortfolioRequirements(1, null, false, states, deferred, TRACKED);
		const novel = proposal("caching", {
			bottleneck: "Independent partitions queue behind a global eviction coordinator",
			hypothesis: "Partition-local eviction removes the coordinator bottleneck",
			mechanism: "Shard the cache into independent eviction queues",
			falsifier: "Throughput remains flat after partition-local eviction is enabled",
			targetAreas: ["src/cache/index.ts"],
			supportAreas: [],
		});
		expect(validatePortfolio([novel], requirements, []).ok).toBe(true);
	});
});

it("does not use rejected portfolio history to reject an otherwise valid saturation unlock", () => {
	const states = computeFamilyStates([], CONTEXT, 2);
	const cached = states.get("caching");
	if (!cached) throw new Error("missing caching state");
	Object.assign(cached, {
		creditCount: 2,
		qualifiedAttemptCount: 2,
		totalAttemptCount: 2,
		noImprovementStreak: 2,
		saturated: true,
		qualifiedFailedProposals: [proposal("caching")],
	});
	const deferred = new Set<StrategyFamily>([
		"algorithm",
		"data-structure",
		"memory-layout",
		"pruning",
		"parallelism",
		"precomputation",
		"decomposition",
		"approximation",
		"numerical",
		"runtime",
		"other",
	]);
	const requirements = computePortfolioRequirements(1, null, false, states, deferred, TRACKED);
	const novel = proposal("caching", {
		bottleneck: "Independent partitions queue behind a global eviction coordinator",
		hypothesis: "Partition-local eviction removes the coordinator bottleneck",
		mechanism: "Shard the cache into independent eviction queues",
		falsifier: "Throughput remains flat after partition-local eviction is enabled",
		targetAreas: ["src/cache/index.ts"],
		supportAreas: [],
	});
	const rejected = proposal("caching", {
		bottleneck: novel.bottleneck,
		hypothesis: novel.hypothesis,
		mechanism: "Use a separate telemetry pipeline to report unrelated process counters",
		falsifier: "The telemetry report omits the required process counter output",
		targetAreas: novel.targetAreas,
		supportAreas: novel.supportAreas,
	});
	const similarity = strategySimilarity(novel, rejected);
	expect(similarity).toBeGreaterThanOrEqual(0.6);
	expect(similarity).toBeLessThan(0.78);
	expect(validatePortfolio([novel], requirements, [rejected]).ok).toBe(true);
});
