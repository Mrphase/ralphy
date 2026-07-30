import { join } from "node:path";
import simpleGit from "simple-git";
import { RALPHY_DIR } from "../config/loader.ts";
import type { AIEngine } from "../engines/types.ts";
import type { KnowledgeOptions } from "../knowledge/index.ts";
import { appendLearning } from "../knowledge/manager.ts";
import { logDebug, logError, logInfo, logSuccess, logWarn } from "../ui/logger.ts";
import { ProgressSpinner } from "../ui/spinner.ts";
import {
	type EvaluateConfig,
	type ResultEntry,
	appendResultsLog,
	formatResultsTable,
	isBetterScore,
	runEvaluation,
} from "./evaluate.ts";
import { buildOptimizePrompt } from "./prompt.ts";
import { isFatalError, isRetryableError, withRetry } from "./retry.ts";
import type { ExecutionResult } from "./sequential.ts";

export interface IterativeOptimizeOptions {
	engine: AIEngine;
	task: string;
	workDir: string;
	evaluateConfig: EvaluateConfig;
	maxRounds: number;
	skipTests: boolean;
	skipLint: boolean;
	maxRetries: number;
	retryDelay: number;
	browserEnabled: "auto" | "true" | "false";
	modelOverride?: string;
	reasoningEffort?: string;
	engineArgs?: string[];
	knowledge?: KnowledgeOptions;
}

export interface OptimizeDependencies {
	evaluate: typeof runEvaluation;
}

const DEFAULT_OPTIMIZE_DEPENDENCIES: OptimizeDependencies = {
	evaluate: runEvaluation,
};

/**
 * Run iterative optimization: execute agent → evaluate → keep/discard → repeat.
 *
 * Inspired by karpathy/autoresearch's experiment loop:
 * - Each round, the agent modifies code to improve a metric
 * - An evaluation script scores the result
 * - If the score improved, the changes are committed (kept)
 * - If not, changes are rolled back via git reset
 * - Score history is injected into the next prompt so the agent learns
 */
export async function runIterativeOptimize(
	options: IterativeOptimizeOptions,
	dependencies: OptimizeDependencies = DEFAULT_OPTIMIZE_DEPENDENCIES,
): Promise<ExecutionResult> {
	const {
		engine,
		task,
		workDir,
		evaluateConfig,
		maxRounds,
		skipTests,
		skipLint,
		maxRetries,
		retryDelay,
		browserEnabled,
		modelOverride,
		reasoningEffort,
		engineArgs,
		knowledge,
	} = options;

	const result: ExecutionResult = {
		tasksCompleted: 0,
		tasksFailed: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
	};

	const git = simpleGit(workDir);
	const resultsLog = join(workDir, RALPHY_DIR, "optimize-results.tsv");
	const entries: ResultEntry[] = [];
	let bestScore: number | null = null;
	let lastEvalOutput = "";
	let consecutiveCrashes = 0;

	logInfo(`Starting iterative optimization: "${task}"`);
	logInfo(
		`Max rounds: ${maxRounds} | Objective: ${evaluateConfig.objective} | Eval: ${evaluateConfig.script}`,
	);
	console.log("");

	const baselineResult = await dependencies.evaluate(evaluateConfig, workDir);
	lastEvalOutput = baselineResult.output || baselineResult.error || "";
	if (!baselineResult.success || baselineResult.score === undefined) {
		logError(
			`Baseline evaluation failed: ${baselineResult.error?.substring(0, 80) || "no score returned"}`,
		);
		result.tasksFailed++;
		return result;
	}

	bestScore = baselineResult.score;
	logInfo(`Baseline score: ${bestScore.toFixed(6)}`);

	for (let round = 1; round <= maxRounds; round++) {
		const spinner = new ProgressSpinner(`Round ${round}/${maxRounds}`);

		// Snapshot current state
		const snapshot = (await git.revparse(["HEAD"])).trim();
		logDebug(`Round ${round}: snapshot at ${snapshot.substring(0, 7)}`);

		// Build prompt with history
		const scoreHistory = formatResultsTable(entries);
		const prompt = buildOptimizePrompt({
			task,
			round,
			bestScore,
			lastEvalOutput,
			scoreHistory,
			workDir,
			skipTests,
			skipLint,
			browserEnabled,
			knowledge,
		});

		// Execute agent
		spinner.updateStep("Agent working");
		let agentSuccess = false;

		try {
			const engineOptions = {
				...(modelOverride && { modelOverride }),
				...(reasoningEffort && { reasoningEffort }),
				...(engineArgs && engineArgs.length > 0 && { engineArgs }),
			};

			const aiResult = await withRetry(
				async () => {
					const res = engine.executeStreaming
						? await engine.executeStreaming(
								prompt,
								workDir,
								(step) => spinner.updateStep(step),
								engineOptions,
							)
						: await engine.execute(prompt, workDir, engineOptions);

					if (!res.success && res.error && isRetryableError(res.error)) {
						throw new Error(res.error);
					}
					return res;
				},
				{
					maxRetries,
					retryDelay,
					onRetry: (attempt) => spinner.updateStep(`Retry ${attempt}`),
				},
			);

			result.totalInputTokens += aiResult.inputTokens;
			result.totalOutputTokens += aiResult.outputTokens;

			if (!aiResult.success) {
				if (isFatalError(aiResult.error || "")) {
					spinner.error(`Fatal: ${aiResult.error}`);
					logError("Aborting optimization due to fatal error.");
					result.tasksFailed++;
					return result;
				}

				spinner.error(`Agent failed: ${aiResult.error}`);
				await resetToSnapshot(git, snapshot);

				const entry: ResultEntry = {
					round,
					score: null,
					status: "crash",
					description: `Agent error: ${aiResult.error?.substring(0, 80) || "unknown"}`,
				};
				entries.push(entry);
				appendResultsLog(resultsLog, entry);
				result.tasksFailed++;
				consecutiveCrashes++;

				if (consecutiveCrashes >= 3) {
					logError("3 consecutive crashes — stopping optimization.");
					break;
				}
				continue;
			}

			agentSuccess = true;
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			spinner.error(`Error: ${errorMsg}`);
			await resetToSnapshot(git, snapshot);

			const entry: ResultEntry = {
				round,
				score: null,
				status: "crash",
				description: `Exception: ${errorMsg.substring(0, 80)}`,
			};
			entries.push(entry);
			appendResultsLog(resultsLog, entry);
			result.tasksFailed++;
			consecutiveCrashes++;

			if (consecutiveCrashes >= 3) {
				logError("3 consecutive crashes — stopping optimization.");
				break;
			}
			continue;
		}

		if (!agentSuccess) continue;

		// Run evaluation
		spinner.updateStep("Evaluating");
		const evalResult = await dependencies.evaluate(evaluateConfig, workDir);
		lastEvalOutput = evalResult.output || evalResult.error || "";

		if (!evalResult.success || evalResult.score === undefined) {
			// Evaluation crashed
			spinner.error(`Eval crashed: ${evalResult.error?.substring(0, 80) || "no score"}`);
			await resetToSnapshot(git, snapshot);

			const entry: ResultEntry = {
				round,
				score: null,
				status: "crash",
				description: `Eval crash: ${evalResult.error?.substring(0, 60) || "no score returned"}`,
			};
			entries.push(entry);
			appendResultsLog(resultsLog, entry);
			result.tasksFailed++;
			consecutiveCrashes++;

			if (consecutiveCrashes >= 3) {
				logError("3 consecutive eval crashes — stopping optimization.");
				break;
			}
			continue;
		}

		consecutiveCrashes = 0;
		const score = evalResult.score;
		const improved = isBetterScore(score, bestScore, evaluateConfig.objective);

		if (improved) {
			// Keep: commit the changes
			bestScore = score;
			const commitMsg = `optimize round ${round}: score=${score.toFixed(6)} (improved)`;

			try {
				await git.add(".");
				await git.commit(commitMsg, { "--allow-empty": null });
			} catch {
				// May already be committed by the agent
				logDebug("Commit skipped (possibly already committed by agent)");
			}

			spinner.success(`Score: ${score.toFixed(6)} ✓ (best)`);

			const entry: ResultEntry = {
				round,
				score,
				status: "keep",
				description: `improved from ${entries.length > 0 ? (entries[entries.length - 1].score?.toFixed(6) ?? "N/A") : "baseline"}`,
			};
			entries.push(entry);
			appendResultsLog(resultsLog, entry);
			result.tasksCompleted++;
		} else {
			// Discard: reset to snapshot
			spinner.error(`Score: ${score.toFixed(6)} ✗ (best: ${bestScore?.toFixed(6) ?? "N/A"})`);
			await resetToSnapshot(git, snapshot);

			const entry: ResultEntry = {
				round,
				score,
				status: "discard",
				description: `no improvement over ${bestScore?.toFixed(6) ?? "N/A"}`,
			};
			entries.push(entry);
			appendResultsLog(resultsLog, entry);
		}
	}

	// Summary
	console.log("");
	logInfo("Optimization complete");
	const kept = entries.filter((e) => e.status === "keep").length;
	const discarded = entries.filter((e) => e.status === "discard").length;
	const crashed = entries.filter((e) => e.status === "crash").length;
	logInfo(
		`Rounds: ${entries.length} | Kept: ${kept} | Discarded: ${discarded} | Crashed: ${crashed}`,
	);
	if (bestScore !== null) {
		logSuccess(`Best score: ${bestScore.toFixed(6)}`);
	}

	// Record optimization summary as a learning
	if (knowledge?.enabled !== false) {
		const summary = `Optimization of "${task}": ${entries.length} rounds, best score ${bestScore?.toFixed(6) ?? "N/A"}, ${kept} kept, ${discarded} discarded`;
		try {
			await appendLearning(task, [summary], workDir);
		} catch {
			logDebug("Failed to append learning (non-critical)");
		}
	}

	return result;
}

/**
 * Reset working directory to a specific commit, discarding all changes.
 */
async function resetToSnapshot(
	git: ReturnType<typeof simpleGit>,
	commitHash: string,
): Promise<void> {
	try {
		await git.reset(["--hard", commitHash]);
		await git.clean("f", ["-d"]);
	} catch (error) {
		logWarn(`Failed to reset to ${commitHash.substring(0, 7)}: ${error}`);
	}
}
