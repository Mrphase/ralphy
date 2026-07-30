import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EvaluateConfig } from "../evaluate.ts";
import {
	type ExploreEvent,
	ExploreEventSchema,
	type RoundFinalizationIntentEvent,
	type SelectionIntentEvent,
} from "./types.ts";

export const EXPLORE_HISTORY_FILE = "explore-history.jsonl";
export const getExploreHistoryPath = (workDir: string) =>
	join(workDir, ".ralphy", EXPLORE_HISTORY_FILE);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const hashTask = (task: string) => digest(task);
export function hashEvaluationContext(
	task: string,
	config: EvaluateConfig,
	harnessFingerprint: string,
): string {
	return digest(
		JSON.stringify({
			task,
			script: config.script,
			metricKey: config.metricKey ?? "score",
			objective: config.objective,
			harnessFingerprint,
		}),
	);
}
export const truncateEvidence = (value: string, max = 4000) => value.slice(0, max);

function boundedEvent(event: ExploreEvent): ExploreEvent {
	const clone = structuredClone(event) as ExploreEvent;
	if (clone.type === "baseline") clone.output = truncateEvidence(clone.output);
	if (clone.type === "portfolio-rejection") clone.rawOutput = truncateEvidence(clone.rawOutput);
	if (clone.type === "experiment") {
		clone.evaluationOutput = truncateEvidence(clone.evaluationOutput);
		if (clone.error !== undefined) clone.error = truncateEvidence(clone.error);
	}
	if (
		(clone.type === "family-deferral" ||
			clone.type === "round-review" ||
			clone.type === "round-finalization-result") &&
		clone.error !== undefined
	)
		clone.error = truncateEvidence(clone.error);
	return clone;
}
export function appendExploreEvent(workDir: string, event: ExploreEvent): void {
	const parsed = ExploreEventSchema.safeParse(boundedEvent(event));
	if (!parsed.success)
		throw new Error(
			`Invalid exploration event: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
		);
	const path = getExploreHistoryPath(workDir);
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, `${JSON.stringify(parsed.data)}\n`, "utf8");
}
export function readExploreEvents(workDir: string): ExploreEvent[] {
	const path = getExploreHistoryPath(workDir);
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const events: ExploreEvent[] = [];
	for (const [index, line] of text.split(/\r?\n/).entries()) {
		if (!line.trim()) continue;
		const location = truncateEvidence(`${path}:${index + 1}`, 1000);
		try {
			const parsed = ExploreEventSchema.safeParse(JSON.parse(line));
			if (parsed.success) events.push(parsed.data);
			else
				console.warn(
					`Skipping invalid exploration archive event at ${location} [schema:${parsed.error.issues[0]?.code ?? "unknown"}]`,
				);
		} catch (error) {
			const code = error instanceof SyntaxError ? "syntax" : "unknown";
			console.warn(`Skipping invalid exploration archive event at ${location} [json:${code}]`);
		}
	}
	return events;
}
export function readTaskEvents(workDir: string, taskHash: string) {
	return readExploreEvents(workDir).filter((event) => event.taskHash === taskHash);
}
export function readEvaluationContextEvents(workDir: string, evaluationContextHash: string) {
	return readExploreEvents(workDir).filter(
		(event) => event.evaluationContextHash === evaluationContextHash,
	);
}
export interface UnresolvedFinalization {
	intent: RoundFinalizationIntentEvent;
	selection: SelectionIntentEvent | null;
}
export function findUnresolvedFinalizations(events: ExploreEvent[]): UnresolvedFinalization[] {
	const results = new Set(
		events
			.filter((event) => event.type === "round-finalization-result")
			.map((event) => event.roundIntentId),
	);
	return events
		.filter(
			(event): event is RoundFinalizationIntentEvent =>
				event.type === "round-finalization-intent" && !results.has(event.intentId),
		)
		.map((intent) => ({
			intent,
			selection:
				events.find(
					(event): event is SelectionIntentEvent =>
						event.type === "selection-intent" && event.roundIntentId === intent.intentId,
				) ?? null,
		}));
}
export interface EventCausalityIssue {
	eventIndex: number;
	roundIntentId: string | null;
	message: string;
}
export interface EventCausalityAudit {
	valid: boolean;
	issues: EventCausalityIssue[];
}
export function validateExploreEventCausality(events: ExploreEvent[]): EventCausalityAudit {
	const issues: EventCausalityIssue[] = [];
	const intents = new Map<string, { event: RoundFinalizationIntentEvent; index: number }>();
	const selections = new Map<string, { event: SelectionIntentEvent; index: number }>();
	const results = new Set<string>();
	const baselines = new Map<string, { commit: string; score: number }>();
	const baselineKey = (event: Pick<ExploreEvent, "runId" | "taskHash" | "evaluationContextHash">) =>
		[event.runId, event.taskHash, event.evaluationContextHash].join("\0");
	const invalidRoundIntentIds = new Set<string>();
	const issue = (eventIndex: number, id: string | null, message: string) => {
		if (id !== null) invalidRoundIntentIds.add(id);
		if (issues.length < 100)
			issues.push({ eventIndex, roundIntentId: id, message: truncateEvidence(message, 1000) });
	};
	const envelopeMatches = (a: ExploreEvent, b: ExploreEvent) =>
		a.runId === b.runId &&
		a.roundId === b.roundId &&
		a.round === b.round &&
		a.taskHash === b.taskHash &&
		a.evaluationContextHash === b.evaluationContextHash;
	for (const [index, event] of events.entries()) {
		if (event.type === "baseline") baselines.set(baselineKey(event), event);
		if (event.type === "round-finalization-intent") {
			if (intents.has(event.intentId))
				issue(index, event.intentId, "duplicate finalization intent");
			else {
				const baseline = baselines.get(baselineKey(event));
				if (!baseline) issue(index, event.intentId, "finalization intent has no earlier baseline");
				else if (baseline.commit !== event.baselineCommit || baseline.score !== event.baselineScore)
					issue(index, event.intentId, "finalization intent baseline mismatch");
				for (const candidate of event.performanceCandidates) {
					const experiment = events
						.slice(0, index)
						.find(
							(prior) =>
								prior.type === "experiment" &&
								envelopeMatches(prior, event) &&
								prior.baselineScore === event.baselineScore &&
								prior.card.id === candidate.cardId &&
								prior.candidateScore === candidate.score &&
								prior.candidateCommit === candidate.candidateCommit &&
								prior.branchName === candidate.branchName,
						);
					if (!experiment)
						issue(
							index,
							event.intentId,
							`shortlisted candidate ${candidate.cardId} has no matching earlier experiment`,
						);
				}
				intents.set(event.intentId, { event, index });
			}
		}
		if (event.type === "selection-intent") {
			const intent = intents.get(event.roundIntentId);
			if (!intent) issue(index, event.roundIntentId, "orphan or out-of-order selection");
			if (selections.has(event.roundIntentId))
				issue(index, event.roundIntentId, "duplicate selection");
			if (intent) {
				if (
					!envelopeMatches(intent.event, event) ||
					intent.event.baselineCommit !== event.baselineCommit ||
					intent.event.baselineScore !== event.baselineScore
				)
					issue(index, event.roundIntentId, "selection envelope mismatch");
				const candidate = intent.event.performanceCandidates.find(
					(item) => item.cardId === event.selectedCardId,
				);
				if (
					!candidate ||
					candidate.score !== event.selectedScore ||
					candidate.candidateCommit !== event.candidateCommit ||
					candidate.branchName !== event.branchName
				)
					issue(index, event.roundIntentId, "selection does not exactly match shortlist");
			}
			selections.set(event.roundIntentId, { event, index });
		}
		if (event.type === "round-finalization-result") {
			const intent = intents.get(event.roundIntentId);
			const selection = selections.get(event.roundIntentId);
			if (!intent) issue(index, event.roundIntentId, "orphan or out-of-order result");
			if (results.has(event.roundIntentId)) issue(index, event.roundIntentId, "duplicate result");
			results.add(event.roundIntentId);
			if (
				intent &&
				(!envelopeMatches(intent.event, event) ||
					intent.event.baselineCommit !== event.baselineCommit ||
					intent.event.baselineScore !== event.baselineScore)
			)
				issue(index, event.roundIntentId, "result envelope mismatch");
			if (event.outcome === "no-winner" && selection)
				issue(index, event.roundIntentId, "no-winner cannot have selection");
			if (event.outcome !== "no-winner" && !selection)
				issue(index, event.roundIntentId, "result requires earlier selection");
			if (
				selection &&
				(event.selectedCardId !== selection.event.selectedCardId ||
					event.selectedScore !== selection.event.selectedScore)
			)
				issue(index, event.roundIntentId, "result selection mismatch");
			if (
				selection &&
				event.outcome === "applied" &&
				event.resultingCommit !== selection.event.candidateCommit
			)
				issue(index, event.roundIntentId, "applied commit does not match selection");
			if (
				event.outcome === "applied" &&
				event.resultingCommit !== null &&
				event.selectedScore !== null &&
				!invalidRoundIntentIds.has(event.roundIntentId)
			)
				baselines.set(baselineKey(event), {
					commit: event.resultingCommit,
					score: event.selectedScore,
				});
		}
	}
	return { valid: issues.length === 0, issues };
}
