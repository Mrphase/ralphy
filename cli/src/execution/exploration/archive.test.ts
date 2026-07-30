import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	appendExploreEvent,
	findUnresolvedFinalizations,
	getExploreHistoryPath,
	hashEvaluationContext,
	hashTask,
	readEvaluationContextEvents,
	readExploreEvents,
	readTaskEvents,
	truncateEvidence,
	validateExploreEventCausality,
} from "./archive.ts";
import { type ExploreEvent, ExploreEventSchema } from "./types.ts";

const roots: string[] = [];
const tempRoot = () => {
	const root = mkdtempSync(join(tmpdir(), "ralphy-archive-"));
	roots.push(root);
	return root;
};
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const proposal = {
	slot: "exploit" as const,
	family: "algorithm" as const,
	title: "Faster candidate search",
	bottleneck: "The current search explores too many candidates.",
	hypothesis: "A bounded frontier will reduce unnecessary candidate work.",
	mechanism: "Prioritize candidates by measured expected improvement.",
	expectedImpact: "Reduce total evaluation time.",
	targetAreas: ["src/search.ts"],
	supportAreas: [],
	forbiddenAreas: [],
	falsifier: "No runtime improvement across three representative cases.",
	differenceFromHistory: "Uses measurements rather than static ordering.",
	forbiddenMechanisms: [],
};
const base = {
	version: 1 as const,
	runId: "run-1",
	roundId: "round-1",
	taskHash: "task",
	evaluationContextHash: "context",
	timestamp: "2026-07-31T01:02:03.000Z",
	round: 1,
};
const card = { ...proposal, id: "card-1", round: 1 };
const candidate = {
	cardId: "card-1",
	score: 12,
	candidateCommit: "abc",
	branchName: "candidate/a",
};

const fixtures = {
	baseline: { ...base, type: "baseline", commit: "base", score: 10, output: "baseline output" },
	"family-deferral": {
		...base,
		type: "family-deferral",
		contextFingerprint: "fingerprint",
		proposal: {
			family: "caching",
			reason: "Existing evidence shows caching cannot affect this bottleneck.",
			evidencePaths: ["src/cache.ts"],
			missingFalsifier: "A cache-hit trace showing repeated computations.",
			reconsiderWhen: "The workload begins repeating identical requests.",
		},
		review: {
			family: "caching",
			approved: true,
			evidenceSufficient: true,
			rationale: "The cited trace directly supports the requested deferral.",
			reconsiderConstraint: "Reconsider when duplicate calls exceed ten percent.",
		},
		outcome: "accepted",
	},
	"portfolio-adjustment": {
		...base,
		type: "portfolio-adjustment",
		requestedAgents: 3,
		effectiveAgents: 2,
		deferredFamilies: ["caching"],
		reason: "One requested family was accepted for deferral.",
	},
	"exploration-terminal": {
		...base,
		type: "exploration-terminal",
		outcome: "no-applicable-frontier",
		contextFingerprint: "fingerprint",
		deferredFamilies: ["caching"],
		saturatedFamilies: ["algorithm"],
		reason: "All applicable strategy families are deferred or saturated.",
	},
	"portfolio-rejection": {
		...base,
		type: "portfolio-rejection",
		phase: "strategy-proposal",
		attempt: 1,
		reasons: ["Proposal omitted a falsifier."],
		parsedProposals: [],
		rawFingerprint: "raw",
		rawOutput: "raw output",
	},
	experiment: {
		...base,
		type: "experiment",
		card,
		baselineScore: 10,
		candidateScore: 12,
		candidateCommit: "abc",
		branchName: "candidate/a",
		status: "eligible",
		changedFiles: ["src/search.ts"],
		routeCompliant: true,
		violations: [],
		diffFingerprint: "diff",
		evaluationOutput: "score=12",
	},
	"round-review": {
		...base,
		type: "round-review",
		findings: [
			{
				cardId: "card-1",
				mechanismAttempted: true,
				duplicateOf: null,
				evidenceProblems: [],
				failureCause: "The mechanism worked on the measured workload.",
				lesson: "Measured ordering is useful for this candidate set.",
				nextConstraint: "Preserve deterministic ordering for equal scores.",
			},
		],
	},
	"round-finalization-intent": {
		...base,
		type: "round-finalization-intent",
		intentId: "intent-1",
		baselineCommit: "base",
		baselineScore: 10,
		performanceCandidates: [candidate],
	},
	"selection-intent": {
		...base,
		type: "selection-intent",
		roundIntentId: "intent-1",
		baselineCommit: "base",
		baselineScore: 10,
		selectedCardId: "card-1",
		selectedScore: 12,
		candidateCommit: "abc",
		branchName: "candidate/a",
	},
	"round-finalization-result": {
		...base,
		type: "round-finalization-result",
		roundIntentId: "intent-1",
		baselineCommit: "base",
		baselineScore: 10,
		selectedCardId: "card-1",
		selectedScore: 12,
		outcome: "applied",
		resultingCommit: "abc",
	},
} satisfies Record<ExploreEvent["type"], ExploreEvent>;

describe("exploration event schemas and archive", () => {
	it("round-trips every event variant and strips unknown keys", async () => {
		const root = tempRoot();
		for (const event of Object.values(fixtures)) {
			await appendExploreEvent(root, { ...event, secret: "do not persist" } as ExploreEvent);
		}
		const read = await readExploreEvents(root);
		expect(read).toEqual(Object.values(fixtures));
		expect(readFileSync(getExploreHistoryPath(root), "utf8")).not.toContain("secret");
		expect(readFileSync(getExploreHistoryPath(root), "utf8").trim().split("\n")).toHaveLength(10);
	});

	it("exposes synchronous append and read APIs", () => {
		const root = tempRoot();
		expect(appendExploreEvent(root, fixtures.baseline)).toBeUndefined();
		const events = readExploreEvents(root);
		expect(Array.isArray(events)).toBe(true);
		expect(readTaskEvents(root, "task")).toEqual([fixtures.baseline]);
		expect(readEvaluationContextEvents(root, "context")).toEqual([fixtures.baseline]);
	});

	it("has no side effect for invalid append and creates compact ordered JSONL", () => {
		const root = tempRoot();
		expect(readExploreEvents(root)).toEqual([]);
		expect(() => appendExploreEvent(root, { ...fixtures.baseline, score: Number.NaN })).toThrow();
		expect(existsSync(join(root, ".ralphy"))).toBe(false);
		appendExploreEvent(root, fixtures.baseline);
		appendExploreEvent(root, fixtures["round-review"]);
		const text = readFileSync(getExploreHistoryPath(root), "utf8");
		expect(text.endsWith("\n")).toBe(true);
		expect(text).not.toContain("\n ");
		expect(readExploreEvents(root).map((event) => event.type)).toEqual([
			"baseline",
			"round-review",
		]);
	});

	it("warns without leaking raw content and skips malformed/schema-invalid lines", async () => {
		const root = tempRoot();
		const path = getExploreHistoryPath(root);
		await appendExploreEvent(root, fixtures.baseline);
		writeFileSync(
			path,
			`${readFileSync(path, "utf8")}SECRET malformed\n{"version":1,"type":"baseline"}\n`,
			"utf8",
		);
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		expect(await readExploreEvents(root)).toEqual([fixtures.baseline]);
		expect(warn).toHaveBeenCalledTimes(2);
		expect(warn.mock.calls.flat().join(" ")).not.toContain("SECRET");
		expect(warn.mock.calls.flat().join(" ").length).toBeLessThan(2500);
		warn.mockRestore();
	});

	it("bounds explicit evidence and filters exact hashes", async () => {
		const root = tempRoot();
		await appendExploreEvent(root, { ...fixtures.baseline, output: "x".repeat(5000) });
		expect(
			(await readExploreEvents(root))[0]?.type === "baseline" &&
				(await readExploreEvents(root))[0].output.length,
		).toBe(4000);
		expect(truncateEvidence("abc", 2)).toBe("ab");
		expect(await readTaskEvents(root, "task")).toHaveLength(1);
		expect(await readTaskEvents(root, "other")).toEqual([]);
		expect(await readEvaluationContextEvents(root, "context")).toHaveLength(1);
	});

	it("bounds raw and error evidence and filters actual mixed context records", () => {
		const root = tempRoot();
		appendExploreEvent(root, {
			...fixtures["portfolio-rejection"],
			rawOutput: "r".repeat(5000),
		});
		appendExploreEvent(root, {
			...fixtures.experiment,
			evaluationContextHash: "other-context",
			evaluationOutput: "o".repeat(5000),
			error: "e".repeat(5000),
		});
		const contextEvents = readEvaluationContextEvents(root, "context");
		expect(contextEvents).toHaveLength(1);
		expect(contextEvents[0]?.type).toBe("portfolio-rejection");
		if (contextEvents[0]?.type === "portfolio-rejection")
			expect(contextEvents[0].rawOutput).toHaveLength(4000);
		const otherEvents = readEvaluationContextEvents(root, "other-context");
		expect(otherEvents).toHaveLength(1);
		if (otherEvents[0]?.type === "experiment") {
			expect(otherEvents[0].evaluationOutput).toHaveLength(4000);
			expect(otherEvents[0].error).toHaveLength(4000);
		}
	});

	it("hashes task and canonical evaluation inputs deterministically and independently", () => {
		expect(hashTask("a")).toBe(hashTask("a"));
		expect(hashTask("a")).not.toBe(hashTask("a "));
		const implicit = hashEvaluationContext("task", { script: "run", objective: "maximize" }, "h");
		expect(implicit).toBe(
			hashEvaluationContext(
				"task",
				{ script: "run", objective: "maximize", metricKey: "score" },
				"h",
			),
		);
		expect(
			new Set([
				implicit,
				hashEvaluationContext("task2", { script: "run", objective: "maximize" }, "h"),
				hashEvaluationContext("task", { script: "run2", objective: "maximize" }, "h"),
				hashEvaluationContext("task", { script: "run", objective: "minimize" }, "h"),
				hashEvaluationContext("task", { script: "run", objective: "maximize" }, "h2"),
			]).size,
		).toBe(5);
		expect(
			hashEvaluationContext(
				"task",
				{ script: "run", objective: "maximize", metricKey: "latencyMs" },
				"h",
			),
		).not.toBe(implicit);
	});

	it("finds unresolved intents across contexts and validates valid terminal timelines", () => {
		const applied = [
			{ ...fixtures.baseline, round: 0, roundId: "run-1:r0" },
			...Object.values(fixtures).filter((event) =>
				[
					"experiment",
					"round-finalization-intent",
					"selection-intent",
					"round-finalization-result",
				].includes(event.type),
			),
		];
		expect(validateExploreEventCausality(applied).valid).toBe(true);
		const roundTwoIntent = {
			...fixtures["round-finalization-intent"],
			round: 2,
			roundId: "run-1:r2",
			intentId: "intent-2",
			baselineCommit: "abc",
			baselineScore: 12,
			performanceCandidates: [],
		};
		const roundTwoResult = {
			...fixtures["round-finalization-result"],
			round: 2,
			roundId: "run-1:r2",
			roundIntentId: "intent-2",
			baselineCommit: "abc",
			baselineScore: 12,
			selectedCardId: null,
			selectedScore: null,
			outcome: "no-winner" as const,
			resultingCommit: null,
		};
		expect(
			validateExploreEventCausality([...applied, roundTwoIntent, roundTwoResult] as ExploreEvent[])
				.valid,
		).toBe(true);
		const unresolved = findUnresolvedFinalizations([
			fixtures["round-finalization-intent"],
			{
				...fixtures["round-finalization-intent"],
				intentId: "intent-2",
				evaluationContextHash: "other",
			},
			fixtures["selection-intent"],
			fixtures["round-finalization-result"],
		]);
		expect(unresolved).toHaveLength(1);
		expect(unresolved[0]?.intent.intentId).toBe("intent-2");

		const noWinner = [
			{ ...fixtures.baseline, round: 0, roundId: "run-1:r0" },
			{ ...fixtures["round-finalization-intent"], performanceCandidates: [] },
			{
				...fixtures["round-finalization-result"],
				selectedCardId: null,
				selectedScore: null,
				outcome: "no-winner" as const,
				resultingCommit: null,
			},
		];
		expect(validateExploreEventCausality(noWinner).valid).toBe(true);
		const mergeFailed = [
			{ ...fixtures.baseline, round: 0, roundId: "run-1:r0" },
			fixtures.experiment,
			fixtures["round-finalization-intent"],
			fixtures["selection-intent"],
			{
				...fixtures["round-finalization-result"],
				outcome: "merge-failed" as const,
				resultingCommit: null,
				error: "merge conflict",
			},
		];
		expect(validateExploreEventCausality(mergeFailed).valid).toBe(true);
	});

	it.each([
		["orphan selection", [fixtures["selection-intent"]]],
		[
			"duplicate intent",
			[fixtures["round-finalization-intent"], fixtures["round-finalization-intent"]],
		],
		[
			"result before selection",
			[
				fixtures.experiment,
				fixtures["round-finalization-intent"],
				fixtures["round-finalization-result"],
				fixtures["selection-intent"],
			],
		],
		[
			"envelope mismatch",
			[
				fixtures.experiment,
				fixtures["round-finalization-intent"],
				{ ...fixtures["selection-intent"], runId: "other" },
			],
		],
		[
			"candidate mismatch",
			[{ ...fixtures.experiment, candidateScore: 11 }, fixtures["round-finalization-intent"]],
		],
	])("rejects %s", (_name, events) => {
		expect(validateExploreEventCausality(events as ExploreEvent[]).valid).toBe(false);
	});

	it("rejects a finalization intent without an earlier baseline", () => {
		const events = [fixtures.experiment, fixtures["round-finalization-intent"]];
		const audit = validateExploreEventCausality(events as ExploreEvent[]);
		expect(audit.valid).toBe(false);
		expect(audit.issues.some((issue) => issue.message.includes("baseline"))).toBe(true);
	});

	it.each([
		["commit", { commit: "different-base" }],
		["score", { score: 9 }],
	])("rejects a finalization intent with a mismatching earlier baseline %s", (_name, override) => {
		const events = [
			{ ...fixtures.baseline, round: 0, roundId: "run-1:r0", ...override },
			fixtures.experiment,
			fixtures["round-finalization-intent"],
		];
		const audit = validateExploreEventCausality(events as ExploreEvent[]);
		expect(audit.valid).toBe(false);
		expect(audit.issues.some((issue) => issue.message.includes("baseline"))).toBe(true);
	});

	it("rejects duplicate and conflicting finalization results", () => {
		const events = [
			fixtures.experiment,
			fixtures["round-finalization-intent"],
			fixtures["selection-intent"],
			fixtures["round-finalization-result"],
			{
				...fixtures["round-finalization-result"],
				outcome: "merge-failed" as const,
				resultingCommit: null,
				error: "conflicting terminal result",
			},
		];
		expect(validateExploreEventCausality(events as ExploreEvent[]).valid).toBe(false);
	});

	it("enforces cross-field rules on the completed discriminated union", () => {
		expect(
			ExploreEventSchema.safeParse({
				...fixtures["round-finalization-result"],
				resultingCommit: null,
			}).success,
		).toBe(false);
		expect(
			ExploreEventSchema.safeParse({ ...fixtures["family-deferral"], review: null }).success,
		).toBe(false);
	});

	it("requires a bounded nonempty error when a family deferral review is unavailable", () => {
		const rejectedWithoutReview = {
			...fixtures["family-deferral"],
			review: null,
			outcome: "rejected" as const,
		};
		expect(ExploreEventSchema.safeParse(rejectedWithoutReview).success).toBe(false);
		expect(ExploreEventSchema.safeParse({ ...rejectedWithoutReview, error: "" }).success).toBe(
			false,
		);
		expect(
			ExploreEventSchema.safeParse({
				...rejectedWithoutReview,
				error: "e".repeat(4001),
			}).success,
		).toBe(false);
		expect(
			ExploreEventSchema.safeParse({
				...rejectedWithoutReview,
				error: "review agent did not return a parseable decision",
			}).success,
		).toBe(true);
	});

	it("caps evidence-problem count without imposing a per-entry length limit", () => {
		const finding = fixtures["round-review"].findings[0];
		expect(
			ExploreEventSchema.safeParse({
				...fixtures["round-review"],
				findings: [{ ...finding, evidenceProblems: ["x".repeat(5000)] }],
			}).success,
		).toBe(true);
		expect(
			ExploreEventSchema.safeParse({
				...fixtures["round-review"],
				findings: [{ ...finding, evidenceProblems: Array(13).fill("problem") }],
			}).success,
		).toBe(false);
	});
});
