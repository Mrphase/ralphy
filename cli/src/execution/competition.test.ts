import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import type { AIEngine } from "../engines/types.ts";
import type { mergeAgentBranch } from "../git/merge.ts";
import { runCompetition } from "./competition.ts";
import type { MetricObjective } from "./evaluate.ts";
import { selectBestImprovingCandidate } from "./selection.ts";

const tempDirs: string[] = [];

async function createTestRepository(): Promise<{ workDir: string; baseBranch: string }> {
	const workDir = mkdtempSync(join(tmpdir(), "ralphy-competition-"));
	tempDirs.push(workDir);

	mkdirSync(join(workDir, ".ralphy"));
	writeFileSync(join(workDir, ".gitignore"), ".ralphy/\n.ralphy-worktrees/\n", "utf-8");
	writeFileSync(join(workDir, "candidate.txt"), "baseline\n", "utf-8");

	const git = simpleGit(workDir);
	await git.init();
	await git.addConfig("user.name", "Ralphy Test");
	await git.addConfig("user.email", "ralphy@example.com");
	await git.add(".");
	await git.commit("baseline");

	const baseBranch = (await git.status()).current;
	if (!baseBranch) throw new Error("test repository has no current branch");

	return { workDir, baseBranch };
}

function createEngine(sequence: string[]): AIEngine {
	return {
		name: "test",
		cliCommand: "test",
		isAvailable: async () => true,
		execute: async (_prompt, worktreeDir) => {
			sequence.push("execute agent");
			writeFileSync(join(worktreeDir, "candidate.txt"), "candidate\n", "utf-8");
			return {
				success: true,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
			};
		},
	};
}

function selectWithEvidence<T extends { score: number | null }>(
	candidates: T[],
	baselineScore: number,
	objective: MetricObjective,
	selectionCalls: Array<{
		scores: Array<number | null>;
		baselineScore: number;
		objective: MetricObjective;
	}>,
): T | null {
	selectionCalls.push({
		scores: candidates.map((candidate) => candidate.score),
		baselineScore,
		objective,
	});
	return selectBestImprovingCandidate(candidates, baselineScore, objective);
}

afterEach(() => {
	for (const tempDir of tempDirs.splice(0)) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

describe("runCompetition", () => {
	it("discards a round when the best candidate does not beat the measured baseline", async () => {
		const { workDir } = await createTestRepository();
		const sequence: string[] = [];
		const selectionCalls: Array<{
			scores: Array<number | null>;
			baselineScore: number;
			objective: MetricObjective;
		}> = [];
		const mergeCalls: Array<Parameters<typeof mergeAgentBranch>> = [];

		const result = await runCompetition(
			{
				engine: createEngine(sequence),
				task: "improve the candidate",
				workDir,
				evaluateConfig: { script: "unused", objective: "maximize" },
				numAgents: 1,
				numRounds: 1,
				skipTests: true,
				skipLint: true,
				maxRetries: 1,
				retryDelay: 0,
				browserEnabled: "false",
				knowledge: { enabled: false },
			},
			{
				evaluate: async (_config, evaluationDir) => {
					const isBaseline = evaluationDir === workDir;
					sequence.push(isBaseline ? "evaluate baseline" : "evaluate candidate");
					return {
						success: true,
						score: isBaseline ? 10 : 9,
						output: isBaseline ? "10" : "9",
					};
				},
				selectBestImprovingCandidate: (candidates, baselineScore, objective) =>
					selectWithEvidence(candidates, baselineScore, objective, selectionCalls),
				mergeAgentBranch: async (...args) => {
					mergeCalls.push(args);
					return { success: true, hasConflicts: false };
				},
			},
		);

		expect(sequence).toEqual(["evaluate baseline", "execute agent", "evaluate candidate"]);
		expect(selectionCalls).toEqual([{ scores: [9], baselineScore: 10, objective: "maximize" }]);
		expect(mergeCalls).toEqual([]);
		expect(result.tasksCompleted).toBe(0);
		expect(readFileSync(join(workDir, "candidate.txt"), "utf-8").trim()).toBe("baseline");
		expect(readFileSync(join(workDir, ".ralphy", "compete-results.tsv"), "utf-8")).toContain(
			"\tdiscard\t",
		);

		const worktreeList = await simpleGit(workDir).raw(["worktree", "list", "--porcelain"]);
		expect(worktreeList.split("\n").filter((line) => line.startsWith("worktree "))).toHaveLength(1);
	});

	it("passes the winner branch, base branch, and work directory to merge", async () => {
		const { workDir, baseBranch } = await createTestRepository();
		const sequence: string[] = [];
		const mergeCalls: Array<Parameters<typeof mergeAgentBranch>> = [];

		await runCompetition(
			{
				engine: createEngine(sequence),
				task: "improve the candidate",
				workDir,
				evaluateConfig: { script: "unused", objective: "maximize" },
				numAgents: 1,
				numRounds: 1,
				skipTests: true,
				skipLint: true,
				maxRetries: 1,
				retryDelay: 0,
				browserEnabled: "false",
				knowledge: { enabled: false },
			},
			{
				evaluate: async (_config, evaluationDir) => {
					const isBaseline = evaluationDir === workDir;
					sequence.push(isBaseline ? "evaluate baseline" : "evaluate candidate");
					return {
						success: true,
						score: isBaseline ? 10 : 11,
						output: isBaseline ? "10" : "11",
					};
				},
				selectBestImprovingCandidate,
				mergeAgentBranch: async (...args) => {
					mergeCalls.push(args);
					return { success: true, hasConflicts: false };
				},
			},
		);

		expect(sequence).toEqual(["evaluate baseline", "execute agent", "evaluate candidate"]);
		expect(mergeCalls).toHaveLength(1);
		expect(mergeCalls[0][0]).toMatch(/^ralphy\/agent-1-.+-compete-r1$/);
		expect(mergeCalls[0][1]).toBe(baseBranch);
		expect(mergeCalls[0][2]).toBe(workDir);
	});
});
