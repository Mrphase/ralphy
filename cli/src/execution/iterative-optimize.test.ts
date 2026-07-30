import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import type { AIEngine } from "../engines/types.ts";
import type { EvaluateResult } from "./evaluate.ts";
import { runIterativeOptimize } from "./iterative-optimize.ts";

const tempDirs: string[] = [];

async function createTestRepository(): Promise<string> {
	const workDir = mkdtempSync(join(tmpdir(), "ralphy-optimize-"));
	tempDirs.push(workDir);

	mkdirSync(join(workDir, ".ralphy"));
	writeFileSync(join(workDir, ".gitignore"), ".ralphy/\n", "utf-8");
	writeFileSync(join(workDir, "candidate.txt"), "baseline\n", "utf-8");

	const git = simpleGit(workDir);
	await git.init();
	await git.addConfig("user.name", "Ralphy Test");
	await git.addConfig("user.email", "ralphy@example.com");
	await git.add(".");
	await git.commit("baseline");

	return workDir;
}

afterEach(() => {
	for (const tempDir of tempDirs.splice(0)) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

describe("runIterativeOptimize", () => {
	it("measures unchanged HEAD and rejects a worse first candidate", async () => {
		const workDir = await createTestRepository();
		const sequence: string[] = [];
		const evaluations: EvaluateResult[] = [
			{ success: true, score: 10, output: "10" },
			{ success: true, score: 9, output: "9" },
		];
		const engine: AIEngine = {
			name: "test",
			cliCommand: "test",
			isAvailable: async () => true,
			execute: async () => {
				sequence.push("execute agent");
				writeFileSync(join(workDir, "candidate.txt"), "candidate\n", "utf-8");
				return {
					success: true,
					response: "",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
		};

		const result = await runIterativeOptimize(
			{
				engine,
				task: "improve the candidate",
				workDir,
				evaluateConfig: { script: "unused", objective: "maximize" },
				maxRounds: 1,
				skipTests: true,
				skipLint: true,
				maxRetries: 1,
				retryDelay: 0,
				browserEnabled: "false",
				knowledge: { enabled: false },
			},
			{
				evaluate: async () => {
					sequence.push(sequence.length === 0 ? "evaluate baseline" : "evaluate candidate");
					const evaluation = evaluations.shift();
					if (!evaluation) throw new Error("unexpected evaluation");
					return evaluation;
				},
			},
		);

		expect(sequence).toEqual(["evaluate baseline", "execute agent", "evaluate candidate"]);
		expect(readFileSync(join(workDir, "candidate.txt"), "utf-8").trim()).toBe("baseline");
		expect(result.tasksCompleted).toBe(0);
	});

	it("aborts before the agent when baseline evaluation fails or returns no score", async () => {
		const baselines: EvaluateResult[] = [
			{ success: false, output: "", error: "baseline crashed" },
			{ success: true, output: "missing score" },
		];

		for (const baseline of baselines) {
			const workDir = await createTestRepository();
			let evaluateCalls = 0;
			let engineCalls = 0;
			const engine: AIEngine = {
				name: "test",
				cliCommand: "test",
				isAvailable: async () => true,
				execute: async () => {
					engineCalls++;
					return {
						success: true,
						response: "",
						inputTokens: 0,
						outputTokens: 0,
					};
				},
			};

			const result = await runIterativeOptimize(
				{
					engine,
					task: "improve the candidate",
					workDir,
					evaluateConfig: { script: "unused", objective: "maximize" },
					maxRounds: 1,
					skipTests: true,
					skipLint: true,
					maxRetries: 1,
					retryDelay: 0,
					browserEnabled: "false",
					knowledge: { enabled: false },
				},
				{
					evaluate: async () => {
						evaluateCalls++;
						return baseline;
					},
				},
			);

			expect(evaluateCalls).toBe(1);
			expect(engineCalls).toBe(0);
			expect(result.tasksCompleted).toBe(0);
			expect(result.tasksFailed).toBe(1);
		}
	});
});
