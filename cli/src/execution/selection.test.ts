import { describe, expect, it } from "bun:test";
import { isCandidateAcceptable, selectBestImprovingCandidate } from "./selection.ts";

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

	it("accepts pass-fail only when a failing baseline becomes passing", () => {
		expect(isCandidateAcceptable(1, 0, "pass-fail")).toBe(true);
		expect(isCandidateAcceptable(1, -1, "pass-fail")).toBe(true);
		expect(isCandidateAcceptable(0, 0, "pass-fail")).toBe(false);
		expect(isCandidateAcceptable(2, 1, "pass-fail")).toBe(false);
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

	it("ignores null scores and candidates that do not beat baseline", () => {
		const result = selectBestImprovingCandidate(
			[
				{ id: "missing", score: null },
				{ id: "regression", score: 9 },
				{ id: "winner", score: 11 },
			],
			10,
			"maximize",
		);
		expect(result?.id).toBe("winner");
	});
});
