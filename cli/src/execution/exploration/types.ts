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
export const StrategyFamilySchema = z.enum(STRATEGY_FAMILIES);
const boundedStrings = (max: number, length: number) =>
	z.array(z.string().min(1).max(length)).max(max);

export const StrategyProposalSchema = z.object({
	slot: z.enum(["exploit", "adjacent", "challenger"]),
	family: StrategyFamilySchema,
	title: z.string().min(3).max(120),
	bottleneck: z.string().min(10).max(800),
	hypothesis: z.string().min(10).max(1200),
	mechanism: z.string().min(10).max(1200),
	expectedImpact: z.string().min(5).max(600),
	targetAreas: z.array(z.string().min(1).max(200)).min(1).max(12),
	supportAreas: boundedStrings(12, 200),
	forbiddenAreas: boundedStrings(12, 200),
	falsifier: z.string().min(10).max(1000),
	differenceFromHistory: z.string().min(10).max(1000),
	forbiddenMechanisms: boundedStrings(12, 300),
});
export const StrategyCardSchema = StrategyProposalSchema.extend({
	id: z.string().min(1).max(180),
	round: z.number().int().positive(),
});
export const ExperimentStatusSchema = z.enum([
	"eligible",
	"no-improvement",
	"agent-crash",
	"evaluation-failed",
	"worker-commit-violation",
	"boundary-violation",
	"strategy-violation",
]);
export const CriticFindingSchema = z.object({
	cardId: z.string().min(1).max(180),
	mechanismAttempted: z.boolean(),
	duplicateOf: z.string().min(1).max(180).nullable(),
	evidenceProblems: z.array(z.string()).max(12),
	failureCause: z.string().max(1200),
	lesson: z.string().max(1200),
	nextConstraint: z.string().max(1200),
});
export const FamilyDeferralProposalSchema = z.object({
	family: StrategyFamilySchema,
	reason: z.string().min(20).max(1200),
	evidencePaths: z.array(z.string().min(1).max(200)).min(1).max(12),
	missingFalsifier: z.string().min(20).max(1000),
	reconsiderWhen: z.string().min(10).max(1000),
});
export const FamilyDeferralReviewSchema = z.object({
	family: StrategyFamilySchema,
	approved: z.boolean(),
	evidenceSufficient: z.boolean(),
	rationale: z.string().min(10).max(1200),
	reconsiderConstraint: z.string().min(10).max(1000),
});
export const DeferralRequestSchema = z.object({
	deferrals: z.array(FamilyDeferralProposalSchema).max(STRATEGY_FAMILIES.length),
});
export const StrategyPortfolioSchema = z.object({
	proposals: z.array(StrategyProposalSchema).max(STRATEGY_FAMILIES.length),
});

const base = {
	version: z.literal(1),
	runId: z.string().min(1).max(128),
	roundId: z.string().min(1).max(180),
	taskHash: z.string().min(1).max(128),
	evaluationContextHash: z.string().min(1).max(128),
	timestamp: z.string().datetime(),
	round: z.number().int().nonnegative(),
};
const error = z.string().min(1).max(4000).optional();
const candidate = z.object({
	cardId: z.string().min(1).max(180),
	score: z.number().finite(),
	candidateCommit: z.string().min(1).max(128),
	branchName: z.string().min(1).max(300),
});
const members = [
	z.object({
		...base,
		type: z.literal("baseline"),
		commit: z.string().min(1).max(128),
		score: z.number().finite(),
		output: z.string().max(4000),
	}),
	z.object({
		...base,
		type: z.literal("family-deferral"),
		contextFingerprint: z.string().min(1).max(128),
		proposal: FamilyDeferralProposalSchema,
		review: FamilyDeferralReviewSchema.nullable(),
		outcome: z.enum(["accepted", "rejected"]),
		error,
	}),
	z.object({
		...base,
		type: z.literal("portfolio-adjustment"),
		requestedAgents: z.number().int().min(3).max(STRATEGY_FAMILIES.length),
		effectiveAgents: z.number().int().min(1).max(STRATEGY_FAMILIES.length),
		deferredFamilies: z.array(StrategyFamilySchema).max(STRATEGY_FAMILIES.length),
		reason: z.string().min(1).max(1000),
	}),
	z.object({
		...base,
		type: z.literal("exploration-terminal"),
		outcome: z.literal("no-applicable-frontier"),
		contextFingerprint: z.string().min(1).max(128),
		deferredFamilies: z.array(StrategyFamilySchema).max(STRATEGY_FAMILIES.length),
		saturatedFamilies: z.array(StrategyFamilySchema).max(STRATEGY_FAMILIES.length),
		reason: z.string().min(1).max(1200),
	}),
	z.object({
		...base,
		type: z.literal("portfolio-rejection"),
		phase: z.enum(["deferral-proposal", "strategy-proposal"]),
		attempt: z.number().int().min(1).max(2),
		reasons: z.array(z.string().min(1).max(1000)).min(1).max(100),
		parsedProposals: z.array(StrategyProposalSchema).max(STRATEGY_FAMILIES.length),
		rawFingerprint: z.string().min(1).max(128),
		rawOutput: z.string().max(4000),
	}),
	z.object({
		...base,
		type: z.literal("experiment"),
		card: StrategyCardSchema,
		baselineScore: z.number().finite(),
		candidateScore: z.number().finite().nullable(),
		candidateCommit: z.string().min(1).max(128).nullable(),
		branchName: z.string().min(1).max(300),
		status: ExperimentStatusSchema,
		changedFiles: z.array(z.string().min(1).max(500)).max(2000),
		routeCompliant: z.boolean(),
		violations: z.array(z.string().max(1000)).max(100),
		diffFingerprint: z.string().max(128),
		evaluationOutput: z.string().max(4000),
		error,
	}),
	z.object({
		...base,
		type: z.literal("round-review"),
		findings: z.array(CriticFindingSchema).max(100),
		error,
	}),
	z.object({
		...base,
		type: z.literal("round-finalization-intent"),
		intentId: z.string().min(1).max(180),
		baselineCommit: z.string().min(1).max(128),
		baselineScore: z.number().finite(),
		performanceCandidates: z.array(candidate).max(STRATEGY_FAMILIES.length),
	}),
	z.object({
		...base,
		type: z.literal("selection-intent"),
		roundIntentId: z.string().min(1).max(180),
		baselineCommit: z.string().min(1).max(128),
		baselineScore: z.number().finite(),
		selectedCardId: z.string().min(1).max(180),
		selectedScore: z.number().finite(),
		candidateCommit: z.string().min(1).max(128),
		branchName: z.string().min(1).max(300),
	}),
	z.object({
		...base,
		type: z.literal("round-finalization-result"),
		roundIntentId: z.string().min(1).max(180),
		baselineCommit: z.string().min(1).max(128),
		baselineScore: z.number().finite(),
		selectedCardId: z.string().min(1).max(180).nullable(),
		selectedScore: z.number().finite().nullable(),
		outcome: z.enum(["applied", "no-winner", "merge-failed"]),
		resultingCommit: z.string().min(1).max(128).nullable(),
		error,
	}),
] as const;

export const ExploreEventSchema = z
	.discriminatedUnion("type", members)
	.superRefine((event, context) => {
		const fail = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
		if (event.type === "family-deferral") {
			if (event.review === null && event.error === undefined)
				fail("missing family-deferral review requires an error");
			if (event.review && event.review.family !== event.proposal.family)
				fail("review family must match proposal family");
			const accepted = event.review?.approved === true && event.review.evidenceSufficient === true;
			if ((event.outcome === "accepted") !== accepted)
				fail("accepted requires an approving sufficient review");
		}
		if (event.type === "round-finalization-result") {
			if (
				event.outcome === "applied" &&
				(!event.selectedCardId || event.selectedScore === null || !event.resultingCommit)
			)
				fail("applied result is incomplete");
			if (
				event.outcome === "merge-failed" &&
				(!event.selectedCardId ||
					event.selectedScore === null ||
					event.resultingCommit !== null ||
					!event.error?.length)
			)
				fail("merge-failed result is invalid");
			if (
				event.outcome === "no-winner" &&
				(event.selectedCardId !== null ||
					event.selectedScore !== null ||
					event.resultingCommit !== null)
			)
				fail("no-winner must not select a result");
		}
	});

export type StrategyFamily = z.infer<typeof StrategyFamilySchema>;
export type StrategyProposal = z.infer<typeof StrategyProposalSchema>;
export type StrategyCard = z.infer<typeof StrategyCardSchema>;
export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;
export type CriticFinding = z.infer<typeof CriticFindingSchema>;
export type FamilyDeferralProposal = z.infer<typeof FamilyDeferralProposalSchema>;
export type FamilyDeferralReview = z.infer<typeof FamilyDeferralReviewSchema>;
export type DeferralRequest = z.infer<typeof DeferralRequestSchema>;
export type StrategyPortfolio = z.infer<typeof StrategyPortfolioSchema>;
export type ExploreEvent = z.infer<typeof ExploreEventSchema>;
export type RoundFinalizationIntentEvent = Extract<
	ExploreEvent,
	{ type: "round-finalization-intent" }
>;
export type SelectionIntentEvent = Extract<ExploreEvent, { type: "selection-intent" }>;
export const strategyFamilySchema = StrategyFamilySchema;
export const strategySlotSchema = StrategyProposalSchema.shape.slot;
export const strategyProposalSchema = StrategyProposalSchema;
export const strategyCardSchema = StrategyCardSchema;
export const experimentStatusSchema = ExperimentStatusSchema;
export const criticFindingSchema = CriticFindingSchema;
export const familyDeferralProposalSchema = FamilyDeferralProposalSchema;
export const familyDeferralReviewSchema = FamilyDeferralReviewSchema;
export const deferralRequestSchema = DeferralRequestSchema;
export const strategyPortfolioSchema = StrategyPortfolioSchema;
export const exploreEventSchema = ExploreEventSchema;
export type StrategySlot = z.infer<typeof strategySlotSchema>;
