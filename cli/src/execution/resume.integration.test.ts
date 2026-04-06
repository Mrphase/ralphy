import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AIEngine } from "../engines/types.ts";
import * as branchModule from "../git/branch.ts";
import * as notifyModule from "../ui/notify.ts";
import * as writerModule from "../config/writer.ts";
import * as worktreeModule from "../git/worktree.ts";
import { runParallel } from "./parallel.ts";
import { runSequential, type ExecutionOptions } from "./sequential.ts";

interface InMemoryTaskSource {
	type: "markdown";
	getAllTasks: () => Promise<Array<{ id: string; title: string; completed: boolean }>>;
	getNextTask: () => Promise<{ id: string; title: string; completed: boolean } | null>;
	markComplete: (id: string) => Promise<void>;
	countRemaining: () => Promise<number>;
	countCompleted: () => Promise<number>;
}

function createExecutionOptions(
	workDir: string,
	engine: AIEngine,
	taskSource: InMemoryTaskSource,
	overrides: Partial<ExecutionOptions> = {},
): ExecutionOptions {
	return {
		engine,
		taskSource,
		workDir,
		skipTests: true,
		skipLint: true,
		dryRun: false,
		maxIterations: 0,
		maxRetries: 2,
		retryDelay: 0,
		usageLimitResume: true,
		usageLimitWaitHours: 0,
		branchPerTask: false,
		baseBranch: "",
		createPr: false,
		draftPr: false,
		autoCommit: false,
		browserEnabled: "false",
		activeSettings: [],
		skipMerge: true,
		knowledge: {
			enabled: false,
			contextWindow: 0,
			maxChars: 0,
		},
		...overrides,
	};
}

function createInMemoryTaskSource(tasks: Array<{ id: string; title: string; completed: boolean }>): {
	taskSource: InMemoryTaskSource;
	completedIds: string[];
} {
	const completedIds: string[] = [];

	const remainingTasks = () => tasks.filter((task) => !completedIds.includes(task.id));

	return {
		completedIds,
		taskSource: {
			type: "markdown",
			getAllTasks: async () => remainingTasks(),
			getNextTask: async () => remainingTasks()[0] ?? null,
			markComplete: async (id: string) => {
				if (!completedIds.includes(id)) {
					completedIds.push(id);
				}
			},
			countRemaining: async () => remainingTasks().length,
			countCompleted: async () => completedIds.length,
		},
	};
}

describe("usage-limit execution integration", () => {
	let workDir = "";
	let spyRestorers: Array<() => void> = [];

	beforeEach(() => {
		workDir = join(
			tmpdir(),
			`ralphy-resume-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(workDir, { recursive: true });
		spyRestorers = [];

		const notifyCompleteSpy = spyOn(notifyModule, "notifyTaskComplete").mockImplementation(() => {});
		spyRestorers.push(() => notifyCompleteSpy.mockRestore());
		const notifyFailedSpy = spyOn(notifyModule, "notifyTaskFailed").mockImplementation(() => {});
		spyRestorers.push(() => notifyFailedSpy.mockRestore());
		const progressSpy = spyOn(writerModule, "logTaskProgress").mockImplementation(() => {});
		spyRestorers.push(() => progressSpy.mockRestore());
	});

	afterEach(() => {
		for (const restore of spyRestorers.reverse()) {
			restore();
		}
		if (existsSync(workDir)) {
			rmSync(workDir, { recursive: true, force: true });
		}
	});

	it("runSequential resumes the same task after a usage-limit deferral", async () => {
		let attempts = 0;
		const { taskSource, completedIds } = createInMemoryTaskSource([
			{ id: "task-1", title: "Fix auth", completed: false },
		]);
		const engine: AIEngine = {
			name: "Codex",
			cliCommand: "codex",
			isAvailable: async () => true,
			execute: async () => {
				attempts++;
				if (attempts <= 2) {
					return {
						success: false,
						response: "",
						inputTokens: 0,
						outputTokens: 0,
						error: "You've hit your usage limit.",
					};
				}

				return {
					success: true,
					response: "Fixed",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
		};

		const result = await runSequential(createExecutionOptions(workDir, engine, taskSource));

		expect(attempts).toBe(3);
		expect(result).toEqual({
			tasksCompleted: 1,
			tasksFailed: 0,
			totalInputTokens: 0,
			totalOutputTokens: 0,
		});
		expect(completedIds).toEqual(["task-1"]);

		const deferredPath = join(workDir, ".ralphy", "deferred.json");
		expect(existsSync(deferredPath)).toBe(true);
		expect(JSON.parse(readFileSync(deferredPath, "utf-8"))).toEqual({ tasks: {} });
	});

	it("runParallel pauses once at the batch level and resumes unfinished tasks", async () => {
		let stableAttempts = 0;
		let delayedAttempts = 0;
		const { taskSource, completedIds } = createInMemoryTaskSource([
			{ id: "task-1", title: "Stable task", completed: false },
			{ id: "task-2", title: "Delayed task", completed: false },
		]);
		const worktreeBase = join(workDir, ".ralphy-worktrees");

		const getCurrentBranchSpy = spyOn(branchModule, "getCurrentBranch").mockResolvedValue("feature/test");
		spyRestorers.push(() => getCurrentBranchSpy.mockRestore());
		const canUseWorktreesSpy = spyOn(worktreeModule, "canUseWorktrees").mockReturnValue(true);
		spyRestorers.push(() => canUseWorktreesSpy.mockRestore());
		const getWorktreeBaseSpy = spyOn(worktreeModule, "getWorktreeBase").mockImplementation(() => {
			mkdirSync(worktreeBase, { recursive: true });
			return worktreeBase;
		});
		spyRestorers.push(() => getWorktreeBaseSpy.mockRestore());
		const createAgentWorktreeSpy = spyOn(worktreeModule, "createAgentWorktree").mockImplementation(
			async (_taskName, agentNum) => {
				const agentDir = join(worktreeBase, `agent-${agentNum}`);
				mkdirSync(agentDir, { recursive: true });
				return {
					worktreeDir: agentDir,
					branchName: `ralphy/agent-${agentNum}`,
				};
			},
		);
		spyRestorers.push(() => createAgentWorktreeSpy.mockRestore());
		const cleanupAgentWorktreeSpy = spyOn(worktreeModule, "cleanupAgentWorktree").mockResolvedValue({
			leftInPlace: false,
		});
		spyRestorers.push(() => cleanupAgentWorktreeSpy.mockRestore());

		const engine: AIEngine = {
			name: "Codex",
			cliCommand: "codex",
			isAvailable: async () => true,
			execute: async (prompt) => {
				if (prompt.includes("Stable task")) {
					stableAttempts++;
					return {
						success: true,
						response: "Stable done",
						inputTokens: 0,
						outputTokens: 0,
					};
				}

				delayedAttempts++;
				if (delayedAttempts <= 2) {
					return {
						success: false,
						response: "",
						inputTokens: 0,
						outputTokens: 0,
						error: "You've hit your usage limit.",
					};
				}

				return {
					success: true,
					response: "Delayed done",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
		};

		const result = await runParallel({
			...createExecutionOptions(workDir, engine, taskSource, {
				baseBranch: "main",
				skipMerge: true,
			}),
			maxParallel: 2,
			prdSource: "markdown",
			prdFile: "PRD.md",
			prdIsFolder: false,
		});

		expect(stableAttempts).toBe(1);
		expect(delayedAttempts).toBe(3);
		expect(result).toEqual({
			tasksCompleted: 2,
			tasksFailed: 0,
			totalInputTokens: 0,
			totalOutputTokens: 0,
		});
		expect(completedIds.sort()).toEqual(["task-1", "task-2"]);

		const deferredPath = join(workDir, ".ralphy", "deferred.json");
		expect(existsSync(deferredPath)).toBe(true);
		expect(JSON.parse(readFileSync(deferredPath, "utf-8"))).toEqual({ tasks: {} });
	});
});
