import { createHash } from "node:crypto";
import {
	type ExploreEvent,
	STRATEGY_FAMILIES,
	type StrategyFamily,
	type StrategyProposal,
} from "./types.ts";

export interface FamilyState {
	family: StrategyFamily;
	creditCount: number;
	qualifiedAttemptCount: number;
	totalAttemptCount: number;
	unsatisfiedConstraintCount: number;
	noImprovementStreak: number;
	saturated: boolean;
	qualifiedFailedProposals: StrategyProposal[];
}

export interface PortfolioSlot {
	slot: "exploit" | "adjacent" | "challenger";
	family: StrategyFamily | null;
	requiresNovelUnlock: boolean;
}

export interface PortfolioRequirements {
	requestedAgents: number;
	effectiveAgents: number;
	adjusted: boolean;
	terminal: boolean;
	slots: PortfolioSlot[];
	trackedInventory: readonly string[];
	debtOrder: StrategyFamily[];
	deferrableFamilies: StrategyFamily[];
	qualifiedFailureHistoryByFamily: ReadonlyMap<StrategyFamily, readonly StrategyProposal[]>;
}

export interface PortfolioDiagnostic {
	proposalIndex: number;
	comparedTo: string;
	causalSimilarity: number;
	pathSimilarity: number;
	familyBonus: number;
	overallSimilarity: number;
	mechanismSimilarity: number;
	falsifierSimilarity: number;
}

export interface PortfolioValidation {
	ok: boolean;
	valid: boolean;
	reasons: string[];
	diagnostics: PortfolioDiagnostic[];
}

interface SimilarityDetails {
	causal: number;
	path: number;
	familyBonus: number;
	overall: number;
	mechanism: number;
	falsifier: number;
}

const FAMILY_INDEX = new Map(STRATEGY_FAMILIES.map((family, index) => [family, index]));
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const createState = (family: StrategyFamily): FamilyState => ({
	family,
	creditCount: 0,
	qualifiedAttemptCount: 0,
	totalAttemptCount: 0,
	unsatisfiedConstraintCount: 0,
	noImprovementStreak: 0,
	saturated: false,
	qualifiedFailedProposals: [],
});

export function computeExplorationContextFingerprint(input: {
	evaluationContextHash: string;
	baselineCommit: string;
	inventoryFingerprint: string;
	baselineScore: number;
	evaluationOutputFingerprint: string;
}): string {
	return sha256({
		evaluationContextHash: input.evaluationContextHash,
		baselineCommit: input.baselineCommit,
		inventoryFingerprint: input.inventoryFingerprint,
		baselineScore: input.baselineScore,
		evaluationOutputFingerprint: input.evaluationOutputFingerprint,
	});
}

interface AppliedCandidate {
	score: number;
	commit: string;
}

function getAppliedCards(events: ExploreEvent[]): Map<string, AppliedCandidate> {
	const intents = new Map<string, Extract<ExploreEvent, { type: "round-finalization-intent" }>>();
	const selections = new Map<string, Extract<ExploreEvent, { type: "selection-intent" }>>();
	for (const event of events) {
		if (event.type === "round-finalization-intent") intents.set(event.intentId, event);
		if (event.type === "selection-intent") selections.set(event.roundIntentId, event);
	}
	const applied = new Map<string, AppliedCandidate>();
	for (const event of events) {
		if (event.type !== "round-finalization-result" || event.outcome !== "applied") continue;
		const intent = intents.get(event.roundIntentId);
		const selection = selections.get(event.roundIntentId);
		if (
			!intent ||
			!selection ||
			selection.baselineCommit !== intent.baselineCommit ||
			selection.baselineScore !== intent.baselineScore ||
			event.baselineCommit !== intent.baselineCommit ||
			event.baselineScore !== intent.baselineScore ||
			selection.selectedCardId !== event.selectedCardId ||
			selection.selectedScore !== event.selectedScore ||
			selection.candidateCommit !== event.resultingCommit ||
			selection.selectedScore <= intent.baselineScore
		)
			continue;
		const candidate = intent.performanceCandidates.find(
			(item) =>
				item.cardId === selection.selectedCardId &&
				item.score === selection.selectedScore &&
				item.candidateCommit === selection.candidateCommit,
		);
		if (!candidate) continue;
		applied.set(candidate.cardId, { score: candidate.score, commit: candidate.candidateCommit });
	}
	return applied;
}

export function computeFamilyStates(
	events: ExploreEvent[],
	evaluationContextHash: string,
	threshold: number,
): Map<StrategyFamily, FamilyState> {
	const scoped = events.filter((event) => event.evaluationContextHash === evaluationContextHash);
	const states = new Map(STRATEGY_FAMILIES.map((family) => [family, createState(family)]));
	const findings = new Map<
		string,
		Extract<ExploreEvent, { type: "round-review" }>["findings"][number]
	>();
	for (const event of scoped) {
		if (event.type !== "round-review") continue;
		for (const finding of event.findings) findings.set(finding.cardId, finding);
	}
	const appliedCards = getAppliedCards(scoped);
	for (const event of scoped) {
		if (event.type !== "experiment") continue;
		const family = states.get(event.card.family);
		if (!family) continue;
		family.totalAttemptCount++;
		const finding = findings.get(event.card.id);
		const qualified =
			event.routeCompliant &&
			(event.status === "eligible" || event.status === "no-improvement") &&
			event.candidateScore !== null &&
			event.candidateCommit !== null &&
			finding?.mechanismAttempted === true &&
			finding.duplicateOf === null;
		if (!qualified) {
			family.unsatisfiedConstraintCount++;
			continue;
		}
		family.creditCount++;
		family.qualifiedAttemptCount++;
		if (event.status === "no-improvement") {
			family.noImprovementStreak++;
			family.qualifiedFailedProposals.push(event.card);
			continue;
		}
		const applied = appliedCards.get(event.card.id);
		if (
			applied &&
			event.candidateScore === applied.score &&
			event.candidateCommit === applied.commit &&
			event.candidateScore > event.baselineScore
		) {
			family.noImprovementStreak = 0;
			family.qualifiedFailedProposals = [];
		}
	}
	for (const family of states.values()) family.saturated = family.noImprovementStreak >= threshold;
	return states;
}

export function computeActiveDeferrals(
	events: ExploreEvent[],
	contextFingerprint: string,
): Set<StrategyFamily> {
	return new Set(
		events
			.filter(
				(event): event is Extract<ExploreEvent, { type: "family-deferral" }> =>
					event.type === "family-deferral" &&
					event.contextFingerprint === contextFingerprint &&
					event.outcome === "accepted" &&
					event.review?.approved === true &&
					event.review.evidenceSufficient === true,
			)
			.map((event) => event.proposal.family),
	);
}

function debtCompare(
	states: Map<StrategyFamily, FamilyState>,
	left: StrategyFamily,
	right: StrategyFamily,
) {
	const a = states.get(left);
	const b = states.get(right);
	if (!a || !b) return 0;
	const creditGroup = Number(a.creditCount > 0) - Number(b.creditCount > 0);
	if (creditGroup) return creditGroup;
	const constraint = b.unsatisfiedConstraintCount - a.unsatisfiedConstraintCount;
	if (constraint) return constraint;
	return (
		a.creditCount - b.creditCount ||
		a.qualifiedAttemptCount - b.qualifiedAttemptCount ||
		a.totalAttemptCount - b.totalAttemptCount ||
		(FAMILY_INDEX.get(left) ?? 0) - (FAMILY_INDEX.get(right) ?? 0)
	);
}

export function rankFamiliesByExplorationDebt(
	states: Map<StrategyFamily, FamilyState>,
	activeDeferrals: Set<StrategyFamily>,
): StrategyFamily[] {
	const available = STRATEGY_FAMILIES.filter((family) => !activeDeferrals.has(family));
	const unsaturated = available.filter((family) => !states.get(family)?.saturated);
	const saturated = available.filter((family) => states.get(family)?.saturated);
	return [
		...unsaturated.sort((left, right) => debtCompare(states, left, right)),
		...saturated.sort((left, right) => debtCompare(states, left, right)),
	];
}

export function computePortfolioRequirements(
	agentCount: number,
	incumbentFamily: StrategyFamily | null,
	globallyStagnant: boolean,
	states: Map<StrategyFamily, FamilyState>,
	activeDeferrals: Set<StrategyFamily>,
	trackedInventory: readonly string[] = [],
): PortfolioRequirements {
	const requestedAgents = Math.max(0, agentCount);
	const debtOrder = rankFamiliesByExplorationDebt(states, activeDeferrals);
	const qualifiedFailureHistoryByFamily = new Map<StrategyFamily, readonly StrategyProposal[]>(
		STRATEGY_FAMILIES.map((family) => [
			family,
			[...(states.get(family)?.qualifiedFailedProposals ?? [])],
		]),
	);
	const selected = new Set<StrategyFamily>();
	const challengers: PortfolioSlot[] = [];
	const deferrableFamiliesFor = (slots: PortfolioSlot[]): StrategyFamily[] =>
		slots.flatMap((slot) => {
			if (slot.requiresNovelUnlock || slot.family === null) return [];
			return (states.get(slot.family)?.creditCount ?? 0) === 0 ? [slot.family] : [];
		});
	const addChallengers = (count: number) => {
		for (const family of debtOrder) {
			if (challengers.length >= count || selected.has(family)) continue;
			selected.add(family);
			challengers.push({
				slot: "challenger",
				family,
				requiresNovelUnlock: states.get(family)?.saturated ?? false,
			});
		}
	};
	if (!incumbentFamily) {
		addChallengers(requestedAgents);
		return {
			requestedAgents,
			effectiveAgents: challengers.length,
			adjusted: challengers.length !== requestedAgents,
			terminal: challengers.length === 0,
			slots: challengers,
			trackedInventory: [...trackedInventory],
			debtOrder,
			deferrableFamilies: deferrableFamiliesFor(challengers),
			qualifiedFailureHistoryByFamily,
		};
	}
	const replaceExploit = globallyStagnant || (states.get(incumbentFamily)?.saturated ?? false);
	if (replaceExploit) {
		selected.add(incumbentFamily);
		addChallengers(Math.max(1, requestedAgents - 1));
		if (challengers.length === 0)
			return {
				requestedAgents,
				effectiveAgents: 0,
				adjusted: requestedAgents !== 0,
				terminal: true,
				slots: [],
				trackedInventory: [...trackedInventory],
				debtOrder,
				deferrableFamilies: [],
				qualifiedFailureHistoryByFamily,
			};
		const slots: PortfolioSlot[] = [...challengers];
		if (requestedAgents > challengers.length) {
			slots.push({ slot: "adjacent", family: null, requiresNovelUnlock: false });
		}
		return {
			requestedAgents,
			effectiveAgents: slots.length,
			adjusted: slots.length !== requestedAgents,
			terminal: false,
			slots,
			trackedInventory: [...trackedInventory],
			debtOrder,
			deferrableFamilies: deferrableFamiliesFor(challengers),
			qualifiedFailureHistoryByFamily,
		};
	}
	selected.add(incumbentFamily);
	addChallengers(Math.max(0, requestedAgents - 2));
	if (requestedAgents > 2 && challengers.length === 0)
		return {
			requestedAgents,
			effectiveAgents: 0,
			adjusted: requestedAgents !== 0,
			terminal: true,
			slots: [],
			trackedInventory: [...trackedInventory],
			debtOrder,
			deferrableFamilies: [],
			qualifiedFailureHistoryByFamily,
		};
	const slots: PortfolioSlot[] = [
		{ slot: "exploit", family: incumbentFamily, requiresNovelUnlock: false },
	];
	if (requestedAgents > 1)
		slots.push({ slot: "adjacent", family: null, requiresNovelUnlock: false });
	slots.push(...challengers);
	return {
		requestedAgents,
		effectiveAgents: slots.length,
		adjusted: slots.length !== requestedAgents,
		terminal: false,
		slots,
		trackedInventory: [...trackedInventory],
		debtOrder,
		deferrableFamilies: deferrableFamiliesFor(challengers),
		qualifiedFailureHistoryByFamily,
	};
}

function normalizeText(value: string): string {
	return Array.from(
		value
			.normalize("NFKC")
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, " "),
	)
		.join("")
		.trim();
}

function trigrams(value: string): Set<string> {
	const chars = Array.from(normalizeText(value));
	if (chars.length === 0) return new Set();
	if (chars.length < 3) return new Set([chars.join("")]);
	const result = new Set<string>();
	for (let index = 0; index <= chars.length - 3; index++)
		result.add(chars.slice(index, index + 3).join(""));
	return result;
}

function jaccard(left: Set<string>, right: Set<string>): number {
	if (left.size === 0 && right.size === 0) return 1;
	let intersection = 0;
	for (const item of left) if (right.has(item)) intersection++;
	return intersection / (left.size + right.size - intersection);
}

function normalizedAreas(proposal: StrategyProposal): Set<string> {
	return new Set([...proposal.targetAreas, ...proposal.supportAreas].map(normalizePattern));
}

function analyzeSimilarity(left: StrategyProposal, right: StrategyProposal): SimilarityDetails {
	const causalFields = ["bottleneck", "hypothesis", "mechanism", "falsifier"] as const;
	const causal =
		causalFields.reduce(
			(total, key) => total + jaccard(trigrams(left[key]), trigrams(right[key])),
			0,
		) / causalFields.length;
	const path = jaccard(normalizedAreas(left), normalizedAreas(right));
	const familyBonus = left.family === right.family ? 1 : 0;
	const mechanism = jaccard(trigrams(left.mechanism), trigrams(right.mechanism));
	const falsifier = jaccard(trigrams(left.falsifier), trigrams(right.falsifier));
	return {
		causal,
		path,
		familyBonus,
		overall: causal * 0.8 + path * 0.15 + familyBonus * 0.05,
		mechanism,
		falsifier,
	};
}

export function strategySimilarity(left: StrategyProposal, right: StrategyProposal): number {
	return analyzeSimilarity(left, right).overall;
}

export function isSaturationUnlock(
	proposal: StrategyProposal,
	familyHistory: readonly StrategyProposal[],
): boolean {
	return (
		familyHistory.length > 0 &&
		familyHistory.every((previous) => {
			const details = analyzeSimilarity(proposal, previous);
			return details.overall < 0.6 && (details.mechanism < 0.55 || details.falsifier < 0.55);
		})
	);
}

function normalizePattern(value: string): string {
	return value.normalize("NFKC").replace(/\\/g, "/");
}

function isSafePattern(value: string): boolean {
	const pattern = normalizePattern(value);
	if (!pattern || pattern.includes("\0") || pattern === "**") return false;
	if (pattern.startsWith("/") || pattern.startsWith("//") || /^[A-Za-z]:\//.test(pattern))
		return false;
	return !pattern.split("/").some((segment) => segment === "..");
}

function matchSegment(pattern: string, value: string): boolean {
	let patternIndex = 0;
	let valueIndex = 0;
	let starIndex = -1;
	let retryValueIndex = 0;
	while (valueIndex < value.length) {
		if (pattern[patternIndex] === "*") {
			starIndex = patternIndex++;
			retryValueIndex = valueIndex;
			continue;
		}
		if (pattern[patternIndex] === value[valueIndex]) {
			patternIndex++;
			valueIndex++;
			continue;
		}
		if (starIndex === -1) return false;
		patternIndex = starIndex + 1;
		valueIndex = ++retryValueIndex;
	}
	while (pattern[patternIndex] === "*") patternIndex++;
	return patternIndex === pattern.length;
}

function matchesPattern(pattern: string, file: string): boolean {
	const patternSegments = normalizePattern(pattern).split("/");
	const fileSegments = normalizePattern(file).split("/");
	const memo = new Map<string, boolean>();
	const visit = (patternIndex: number, fileIndex: number): boolean => {
		const key = `${patternIndex}:${fileIndex}`;
		const cached = memo.get(key);
		if (cached !== undefined) return cached;
		if (patternIndex === patternSegments.length) return fileIndex === fileSegments.length;
		const segment = patternSegments[patternIndex];
		if (segment === undefined) return false;
		let result = false;
		if (segment === "**") {
			for (let next = fileIndex; next <= fileSegments.length; next++) {
				if (visit(patternIndex + 1, next)) {
					result = true;
					break;
				}
			}
		} else {
			const fileSegment = fileSegments[fileIndex];
			result =
				fileSegment !== undefined &&
				matchSegment(segment, fileSegment) &&
				visit(patternIndex + 1, fileIndex + 1);
		}
		memo.set(key, result);
		return result;
	};
	return visit(0, 0);
}

function targetMatchesInventory(pattern: string, inventory: readonly string[]): boolean {
	if (!isSafePattern(pattern)) return false;
	const normalized = normalizePattern(pattern);
	return inventory.some((item) => {
		const file = normalizePattern(item);
		if (!normalized.includes("*")) return file === normalized || file.startsWith(`${normalized}/`);
		return matchesPattern(normalized, file);
	});
}

export function validatePortfolio(
	proposals: StrategyProposal[],
	requirements: PortfolioRequirements,
	history: StrategyProposal[],
): PortfolioValidation {
	const reasons: string[] = [];
	const diagnostics: PortfolioDiagnostic[] = [];
	if (proposals.length !== requirements.slots.length)
		reasons.push("proposal count does not match required slots");
	for (const [index, proposal] of proposals.entries()) {
		const required = requirements.slots[index];
		if (!required || proposal.slot !== required.slot)
			reasons.push(`proposal ${index + 1} has the wrong slot`);
		if (
			required?.family !== null &&
			required?.family !== undefined &&
			proposal.family !== required.family
		)
			reasons.push(`proposal ${index + 1} has the wrong assigned family`);
		const qualifiedFailures =
			requirements.qualifiedFailureHistoryByFamily.get(proposal.family) ?? [];
		if (required?.requiresNovelUnlock && !isSaturationUnlock(proposal, qualifiedFailures))
			reasons.push(`proposal ${index + 1} does not unlock saturated family ${proposal.family}`);
		for (const target of proposal.targetAreas) {
			if (!targetMatchesInventory(target, requirements.trackedInventory))
				reasons.push(`proposal ${index + 1} has invalid target area ${target}`);
		}
		for (const area of [...proposal.supportAreas, ...proposal.forbiddenAreas]) {
			if (!isSafePattern(area)) reasons.push(`proposal ${index + 1} has unsafe area ${area}`);
		}
		const comparisons: Array<[StrategyProposal, string]> = [
			...history.map(
				(item, historyIndex) => [item, `history:${historyIndex}`] as [StrategyProposal, string],
			),
			...proposals
				.slice(0, index)
				.map(
					(item, proposalIndex) =>
						[item, `proposal:${proposalIndex}`] as [StrategyProposal, string],
				),
		];
		for (const [previous, comparedTo] of comparisons) {
			const details = analyzeSimilarity(proposal, previous);
			diagnostics.push({
				proposalIndex: index,
				comparedTo,
				causalSimilarity: details.causal,
				pathSimilarity: details.path,
				familyBonus: details.familyBonus,
				overallSimilarity: details.overall,
				mechanismSimilarity: details.mechanism,
				falsifierSimilarity: details.falsifier,
			});
			if (details.overall >= 0.78) reasons.push(`proposal ${index + 1} duplicates ${comparedTo}`);
		}
	}
	const challengers = proposals.filter((proposal) => proposal.slot === "challenger");
	if (new Set(challengers.map((proposal) => proposal.family)).size !== challengers.length)
		reasons.push("challenger families must be unique");
	const ok = reasons.length === 0;
	return { ok, valid: ok, reasons, diagnostics };
}
