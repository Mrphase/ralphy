import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeOptions } from "../../config/types.ts";
import * as enginesIndex from "../../engines/index.ts";
import * as loggerModule from "../../ui/logger.ts";
import { runLoop } from "./run.ts";

function createRuntimeOptions(overrides: Partial<RuntimeOptions> = {}): RuntimeOptions {
	return {
		knowledge: false,
		knowledgeContext: 0,
		knowledgeMaxChars: 0,
		skipTests: true,
		skipLint: true,
		aiEngine: "codex",
		dryRun: false,
		maxIterations: 0,
		maxRetries: 1,
		retryDelay: 0,
		usageLimitResume: true,
		usageLimitWaitHours: 1,
		verbose: false,
		branchPerTask: false,
		baseBranch: "",
		createPr: false,
		draftPr: false,
		parallel: false,
		maxParallel: 1,
		prdSource: "markdown",
		prdFile: "tasks.yaml",
		prdIsFolder: false,
		githubRepo: "",
		githubLabel: "",
		autoCommit: false,
		browserEnabled: "false",
		modelOverride: undefined,
		reasoningEffort: undefined,
		skipMerge: false,
		useSandbox: false,
		engineArgs: [],
		...overrides,
	};
}

describe("runLoop", () => {
	const originalCwd = process.cwd();
	let workDir = "";
	let spyRestorers: Array<() => void> = [];

	beforeEach(() => {
		workDir = join(tmpdir(), `ralphy-run-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(workDir, { recursive: true });
		process.chdir(workDir);
		spyRestorers = [];
	});

	afterEach(() => {
		for (const restore of spyRestorers.reverse()) {
			restore();
		}
		process.chdir(originalCwd);
		rmSync(workDir, { recursive: true, force: true });
	});

	it("warns when a yaml file is routed through --prd and no tasks are found", async () => {
		writeFileSync(
			join(workDir, "tasks.yaml"),
			"tasks:\n  - title: create auth\n    completed: false\n",
			"utf-8",
		);

		const fakeEngine = {
			name: "Codex",
			cliCommand: "codex",
			isAvailable: async () => true,
			execute: async () => ({
				success: true,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
			}),
		};

		const createEngineSpy = spyOn(enginesIndex, "createEngine").mockReturnValue(fakeEngine);
		spyRestorers.push(() => createEngineSpy.mockRestore());
		const engineAvailableSpy = spyOn(enginesIndex, "isEngineAvailable").mockResolvedValue(true);
		spyRestorers.push(() => engineAvailableSpy.mockRestore());

		const warnings: string[] = [];
		const successes: string[] = [];
		const warnSpy = spyOn(loggerModule, "logWarn").mockImplementation((...args: unknown[]) => {
			warnings.push(args.join(" "));
		});
		spyRestorers.push(() => warnSpy.mockRestore());
		const successSpy = spyOn(loggerModule, "logSuccess").mockImplementation((...args: unknown[]) => {
			successes.push(args.join(" "));
		});
		spyRestorers.push(() => successSpy.mockRestore());

		await runLoop(createRuntimeOptions());

		expect(warnings).toEqual([
			'"tasks.yaml" looks like a YAML task file. Re-run with --yaml tasks.yaml instead of --prd tasks.yaml.',
		]);
		expect(successes).toContain("No tasks remaining. All done!");
	});
});