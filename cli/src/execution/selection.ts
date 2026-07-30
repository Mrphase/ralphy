import type { MetricObjective } from "./evaluate.ts";

export function isCandidateAcceptable(
	candidateScore: number,
	baselineScore: number,
	objective: MetricObjective,
): boolean {
	if (objective === "minimize") return candidateScore < baselineScore;
	if (objective === "maximize") return candidateScore > baselineScore;
	return baselineScore <= 0 && candidateScore > 0;
}

export function selectBestImprovingCandidate<T extends { score: number | null }>(
	candidates: T[],
	baselineScore: number,
	objective: MetricObjective,
): T | null {
	let best: T | null = null;

	for (const candidate of candidates) {
		if (
			candidate.score === null ||
			!isCandidateAcceptable(candidate.score, baselineScore, objective)
		) {
			continue;
		}

		if (best === null || isCandidateAcceptable(candidate.score, best.score as number, objective)) {
			best = candidate;
		}
	}

	return best;
}
