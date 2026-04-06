import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeOptions } from "../../config/types.ts";
import * as enginesIndex from "../../engines/index.ts";
import * as notifyModule from "../../ui/notify.ts";
import * as writerModule from "../../config/writer.ts";
import { runTask } from "./task.ts";

function createRuntimeOptions(overrides: Partial<RuntimeOptions> = {}): RuntimeOptions {
	return {
		skipTests: true,
		skipLint: true,
		aiEngine: "codex",
		dryRun: false,
		maxIterations: 0,
		maxRetries: 2,
		retryDelay: 0,
		usageLimitResume: true,
		usageLimitWaitHours: 0,
		verbose: false,
		branchPerTask: false,
		baseBranch: "",
		createPr: false,
		draftPr: false,
		parallel: false,
		maxParallel: 1,
		prdSource: "markdown",
		prdFile: "PRD.md",
		prdIsFolder: false,
		githubRepo: "",
		githubLabel: "",
		autoCommit: false,
		browserEnabled: "false",
		knowledge: false,
		knowledgeContext: 0,
		knowledgeMaxChars: 0,
		...overrides,
	};
}

describe("runTask usage-limit integration", () => {
	const originalCwd = process.cwd();
	let workDir = "";
	let spyRestorers: Array<() => void> = [];

	beforeEach(() => {
		workDir = join(tmpdir(), `ralphy-run-task-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(workDir, { recursive: true });
		process.chdir(workDir);
		spyRestorers = [];
	});

	afterEach(() => {
		for (const restore of spyRestorers.reverse()) {
			restore();
		}
		process.chdir(originalCwd);
		if (existsSync(workDir)) {
			rmSync(workDir, { recursive: true, force: true });
		}
	});

	it("retries a Codex task after exhausting short retries on a usage limit", async () => {
		let attempts = 0;
		const completions: Array<[string, string, string]> = [];
		const notifiedComplete: string[] = [];
		const notifiedFailure: Array<{ task: string; error: string }> = [];

		const fakeEngine = {
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
					response: "Done",
					inputTokens: 0,
					outputTokens: 0,
				};
			},
		};

		const createEngineSpy = spyOn(enginesIndex, "createEngine").mockReturnValue(fakeEngine);
		spyRestorers.push(() => createEngineSpy.mockRestore());
		const engineAvailableSpy = spyOn(enginesIndex, "isEngineAvailable").mockResolvedValue(true);
		spyRestorers.push(() => engineAvailableSpy.mockRestore());
		const progressSpy = spyOn(writerModule, "logTaskProgress").mockImplementation(
			(task, status, cwd) => {
				completions.push([task, status, cwd]);
			},
		);
		spyRestorers.push(() => progressSpy.mockRestore());
		const notifyCompleteSpy = spyOn(notifyModule, "notifyTaskComplete").mockImplementation((task) => {
			notifiedComplete.push(task);
		});
		spyRestorers.push(() => notifyCompleteSpy.mockRestore());
		const notifyFailedSpy = spyOn(notifyModule, "notifyTaskFailed").mockImplementation((task, error) => {
			notifiedFailure.push({ task, error });
		});
		spyRestorers.push(() => notifyFailedSpy.mockRestore());

		await runTask("fix auth bug", createRuntimeOptions());

		expect(attempts).toBe(3);
		expect(completions).toEqual([["fix auth bug", "completed", workDir]]);
		expect(notifiedComplete).toEqual(["fix auth bug"]);
		expect(notifiedFailure).toEqual([]);

		const deferredPath = join(workDir, ".ralphy", "deferred.json");
		expect(existsSync(deferredPath)).toBe(true);
		expect(JSON.parse(readFileSync(deferredPath, "utf-8"))).toEqual({ tasks: {} });
	});
});
