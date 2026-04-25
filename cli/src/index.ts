#!/usr/bin/env bun
import { parseArgs } from "./cli/args.ts";
import { addRule, showConfig } from "./cli/commands/config.ts";
import { runInit } from "./cli/commands/init.ts";
import { runKnowledgeReset, runKnowledgeShow } from "./cli/commands/knowledge.ts";
import { runLoop } from "./cli/commands/run.ts";
import { runTask } from "./cli/commands/task.ts";
import { flushAllProgressWrites } from "./config/writer.ts";
import type { RuntimeOptions } from "./config/types.ts";
import { createEngine, isEngineAvailable } from "./engines/index.ts";
import type { AIEngineName } from "./engines/types.ts";
import { runCompetition } from "./execution/competition.ts";
import { runIterativeOptimize } from "./execution/iterative-optimize.ts";
import { logError, logInfo, setVerbose } from "./ui/logger.ts";

/**
 * Handle single-task mode with --optimize or --compete.
 * Creates the engine, validates --evaluate, and dispatches to the right executor.
 */
async function runOptimizeOrCompeteTask(task: string, options: RuntimeOptions): Promise<void> {
	setVerbose(options.verbose);

	if (!options.evaluateScript) {
		logError("--evaluate <script> is required for --optimize and --compete modes");
		logInfo('Example: ralphy --optimize --evaluate "node eval.js" "improve sorting"');
		process.exit(1);
	}

	const engine = createEngine(options.aiEngine as AIEngineName);
	const available = await isEngineAvailable(options.aiEngine as AIEngineName);
	if (!available) {
		logError(`${engine.name} CLI not found. Make sure '${engine.cliCommand}' is in your PATH.`);
		process.exit(1);
	}

	const workDir = process.cwd();
	const evaluateConfig = {
		script: options.evaluateScript,
		objective: options.metricObjective,
	};
	const knowledgeOptions = {
		enabled: options.knowledge,
		contextWindow: options.knowledgeContext,
		maxChars: options.knowledgeMaxChars,
	};

	if (options.optimize) {
		await runIterativeOptimize({
			engine,
			task,
			workDir,
			evaluateConfig,
			maxRounds: options.optimizeMaxRounds,
			skipTests: options.skipTests,
			skipLint: options.skipLint,
			maxRetries: options.maxRetries,
			retryDelay: options.retryDelay,
			browserEnabled: options.browserEnabled,
			modelOverride: options.modelOverride,
			reasoningEffort: options.reasoningEffort,
			engineArgs: options.engineArgs,
			knowledge: knowledgeOptions,
		});
	} else {
		await runCompetition({
			engine,
			task,
			workDir,
			evaluateConfig,
			numAgents: options.competeAgents,
			numRounds: options.competeRounds,
			skipTests: options.skipTests,
			skipLint: options.skipLint,
			maxRetries: options.maxRetries,
			retryDelay: options.retryDelay,
			browserEnabled: options.browserEnabled,
			modelOverride: options.modelOverride,
			reasoningEffort: options.reasoningEffort,
			engineArgs: options.engineArgs,
			knowledge: knowledgeOptions,
		});
	}
}

async function main(): Promise<void> {
	try {
		const {
			options,
			task,
			initMode,
			showConfig: showConfigMode,
			addRule: rule,
			knowledgeCommand,
		} = parseArgs(process.argv);

		// Handle --init
		if (initMode) {
			await runInit();
			return;
		}

		// Handle --config
		if (showConfigMode) {
			await showConfig();
			return;
		}

		// Handle --add-rule
		if (rule) {
			await addRule(rule);
			return;
		}

		// Handle `ralphy knowledge show|reset`
		if (knowledgeCommand) {
			if (knowledgeCommand === "reset") {
				runKnowledgeReset();
			} else {
				runKnowledgeShow();
			}
			return;
		}

		// Single task mode (brownfield)
		// If --optimize or --compete, route through runLoop which handles eval setup
		if (task && (options.optimize || options.compete)) {
			// Treat the CLI task as the optimization/competition target via runLoop
			// We set a temporary in-memory task source
			options.prdSource = "markdown";
			// runLoop will use the task from the first PRD entry,
			// but for single-task optimize/compete we route through runTask wrapper
			await runOptimizeOrCompeteTask(task, options);
			return;
		}

		if (task) {
			await runTask(task, options);
			return;
		}

		// PRD loop mode
		await runLoop(options);
	} catch (error) {
		logError(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	} finally {
		// Ensure all progress writes are flushed before exit
		await flushAllProgressWrites();
	}
}

main();
