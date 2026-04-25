import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import simpleGit from "simple-git";
import { RALPHY_DIR } from "../config/loader.ts";
import type { AIEngine } from "../engines/types.ts";
import {
	cleanupAgentWorktree,
	createAgentWorktree,
	getWorktreeBase,
} from "../git/worktree.ts";
import { deleteLocalBranch, mergeAgentBranch } from "../git/merge.ts";
import { getCurrentBranch } from "../git/branch.ts";
import type { KnowledgeOptions } from "../knowledge/index.ts";
import { PROGRESS_MD_FILE, appendLearning } from "../knowledge/manager.ts";
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
import { buildCompetitionPrompt } from "./prompt.ts";
import { isRetryableError, withRetry } from "./retry.ts";
import type { ExecutionResult } from "./sequential.ts";

export interface CompetitionOptions {
	engine: AIEngine;
	task: string;
	workDir: string;
	evaluateConfig: EvaluateConfig;
	numAgents: number;
	numRounds: number;
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

interface AgentScore {
	agentNum: number;
	worktreeDir: string;
	branchName: string;
	score: number | null;
	evalOutput: string;
	success: boolean;
}

/**
 * Run multi-agent competition: N agents solve the same task in parallel,
 * each is evaluated, the best wins. Repeat for multiple rounds.
 *
 * Each round:
 * 1. Create N worktrees from current base
 * 2. All agents work on the same task in parallel
 * 3. Run evaluation script on each worktree
 * 4. Pick the winner (best score)
 * 5. Merge winner into base branch
 * 6. Clean up all worktrees and losing branches
 */
export async function runCompetition(
	options: CompetitionOptions,
): Promise<ExecutionResult> {
	const {
		engine,
		task,
		workDir,
		evaluateConfig,
		numAgents,
		numRounds,
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
	const resultsLog = join(workDir, RALPHY_DIR, "compete-results.tsv");
	const entries: ResultEntry[] = [];
	let previousWinnerScore: number | undefined;
	let previousWinnerDescription: string | undefined;

	logInfo(`Starting competition: "${task}"`);
	logInfo(`Rounds: ${numRounds} | Agents per round: ${numAgents} | Objective: ${evaluateConfig.objective} | Eval: ${evaluateConfig.script}`);
	console.log("");

	for (let round = 1; round <= numRounds; round++) {
		logInfo(`--- Competition Round ${round}/${numRounds} ---`);

		const baseBranch = (await getCurrentBranch(workDir)) || "main";
		const worktreeBase = getWorktreeBase(workDir);

		// 1. Create worktrees and run agents in parallel
		const agentPromises: Promise<AgentScore>[] = [];

		for (let agentNum = 1; agentNum <= numAgents; agentNum++) {
			agentPromises.push(
				runSingleCompetitor(
					engine,
					task,
					agentNum,
					round,
					numRounds,
					numAgents,
					baseBranch,
					worktreeBase,
					workDir,
					{
						skipTests,
						skipLint,
						maxRetries,
						retryDelay,
						browserEnabled,
						modelOverride,
						reasoningEffort,
						engineArgs,
						knowledge,
						evaluateConfig,
						previousWinnerScore,
						previousWinnerDescription,
						scoreHistory: formatResultsTable(entries),
					},
				),
			);
		}

		const spinner = new ProgressSpinner(`Round ${round}: ${numAgents} agents competing`);
		spinner.updateStep("Agents working");

		const agentScores = await Promise.all(agentPromises);

		// Accumulate tokens
		for (const _as of agentScores) {
			// Token counts are tracked inside the agent runs
		}

		// 2. Evaluate and pick winner
		spinner.updateStep("Selecting winner");

		const successfulAgents = agentScores.filter((a) => a.success && a.score !== null);

		if (successfulAgents.length === 0) {
			spinner.error("All agents crashed this round");
			logWarn("No successful agents in this round — skipping");

			const entry: ResultEntry = {
				round,
				score: null,
				status: "crash",
				description: `all ${numAgents} agents failed`,
			};
			entries.push(entry);
			appendResultsLog(resultsLog, entry);
			result.tasksFailed++;

			// Clean up all worktrees
			await cleanupRoundWorktrees(agentScores, workDir);
			continue;
		}

		// Find best score
		let winner: AgentScore | null = null;
		for (const agent of successfulAgents) {
			if (agent.score === null) continue;
			if (winner === null || isBetterScore(agent.score, winner.score, evaluateConfig.objective)) {
				winner = agent;
			}
		}

		if (!winner || winner.score === null) {
			spinner.error("Could not determine winner");
			await cleanupRoundWorktrees(agentScores, workDir);
			continue;
		}

		// Log all scores for this round
		const scoresSummary = agentScores
			.map((a) => `Agent ${a.agentNum}: ${a.score !== null ? a.score.toFixed(6) : "crash"}`)
			.join(" | ");
		logInfo(`Scores: ${scoresSummary}`);
		spinner.success(`Winner: Agent ${winner.agentNum} (score: ${winner.score.toFixed(6)})`);

		// 3. Merge winner into base branch
		try {
			await git.checkout(baseBranch);
			const mergeResult = await mergeAgentBranch(winner.branchName, workDir);
			if (mergeResult.success) {
				logSuccess(`Merged winning branch: ${winner.branchName}`);
				result.tasksCompleted++;
			} else {
				logWarn(`Merge had conflicts, attempting resolution`);
				// Force merge with theirs strategy for competition winner
				await git.merge([winner.branchName, "--strategy-option", "theirs"]);
				result.tasksCompleted++;
			}
		} catch (error) {
			logError(`Failed to merge winner: ${error}`);
			// Fallback: hard reset to winner's branch
			try {
				await git.reset(["--hard", winner.branchName]);
				result.tasksCompleted++;
			} catch (resetError) {
				logError(`Failed to reset to winner: ${resetError}`);
				result.tasksFailed++;
			}
		}

		previousWinnerScore = winner.score;
		previousWinnerDescription = `Agent ${winner.agentNum} in round ${round}`;

		const entry: ResultEntry = {
			round,
			score: winner.score,
			status: "keep",
			description: `winner: agent ${winner.agentNum} of ${numAgents} (${scoresSummary})`,
		};
		entries.push(entry);
		appendResultsLog(resultsLog, entry);

		// 4. Clean up all worktrees and branches
		await cleanupRoundWorktrees(agentScores, workDir);

		// Delete non-winning branches
		for (const agent of agentScores) {
			if (agent.branchName && agent.branchName !== winner.branchName) {
				try {
					await deleteLocalBranch(agent.branchName, workDir);
				} catch {
					logDebug(`Failed to delete branch ${agent.branchName}`);
				}
			}
		}
		// Also delete winning branch (already merged)
		try {
			await deleteLocalBranch(winner.branchName, workDir);
		} catch {
			logDebug(`Failed to delete winner branch ${winner.branchName}`);
		}
	}

	// Summary
	console.log("");
	logInfo("Competition complete");
	const keptRounds = entries.filter((e) => e.status === "keep").length;
	const crashedRounds = entries.filter((e) => e.status === "crash").length;
	logInfo(`Rounds: ${entries.length} | Successful: ${keptRounds} | Crashed: ${crashedRounds}`);
	if (previousWinnerScore !== undefined) {
		logSuccess(`Final best score: ${previousWinnerScore.toFixed(6)}`);
	}

	// Record competition summary as learning
	if (knowledge?.enabled !== false) {
		const summary = `Competition on "${task}": ${numRounds} rounds × ${numAgents} agents, final score ${previousWinnerScore?.toFixed(6) ?? "N/A"}`;
		try {
			await appendLearning(task, [summary], workDir);
		} catch {
			logDebug("Failed to append learning (non-critical)");
		}
	}

	return result;
}

/**
 * Run a single competing agent in its own worktree: build prompt → execute → evaluate.
 */
async function runSingleCompetitor(
	engine: AIEngine,
	task: string,
	agentNum: number,
	round: number,
	totalRounds: number,
	totalAgents: number,
	baseBranch: string,
	worktreeBase: string,
	originalDir: string,
	opts: {
		skipTests: boolean;
		skipLint: boolean;
		maxRetries: number;
		retryDelay: number;
		browserEnabled: "auto" | "true" | "false";
		modelOverride?: string;
		reasoningEffort?: string;
		engineArgs?: string[];
		knowledge?: KnowledgeOptions;
		evaluateConfig: EvaluateConfig;
		previousWinnerScore?: number;
		previousWinnerDescription?: string;
		scoreHistory: string;
	},
): Promise<AgentScore> {
	let worktreeDir = "";
	let branchName = "";

	try {
		// Create worktree
		const worktree = await createAgentWorktree(
			`compete-r${round}`,
			agentNum,
			baseBranch,
			worktreeBase,
			originalDir,
		);
		worktreeDir = worktree.worktreeDir;
		branchName = worktree.branchName;

		logDebug(`Agent ${agentNum}: worktree at ${worktreeDir}`);

		// Ensure .ralphy/ exists in worktree
		const ralphyDir = join(worktreeDir, RALPHY_DIR);
		if (!existsSync(ralphyDir)) {
			mkdirSync(ralphyDir, { recursive: true });
		}
		const progressSrc = join(originalDir, RALPHY_DIR, PROGRESS_MD_FILE);
		const progressDest = join(worktreeDir, RALPHY_DIR, PROGRESS_MD_FILE);
		if (existsSync(progressSrc) && !existsSync(progressDest)) {
			copyFileSync(progressSrc, progressDest);
		}

		// Build competition prompt
		const prompt = buildCompetitionPrompt({
			task,
			round,
			totalRounds,
			agentNum,
			totalAgents,
			previousWinnerScore: opts.previousWinnerScore,
			previousWinnerDescription: opts.previousWinnerDescription,
			scoreHistory: opts.scoreHistory || undefined,
			workDir: originalDir,
			skipTests: opts.skipTests,
			skipLint: opts.skipLint,
			browserEnabled: opts.browserEnabled,
			knowledge: opts.knowledge,
		});

		// Execute engine
		const engineOptions = {
			...(opts.modelOverride && { modelOverride: opts.modelOverride }),
			...(opts.reasoningEffort && { reasoningEffort: opts.reasoningEffort }),
			...(opts.engineArgs && opts.engineArgs.length > 0 && { engineArgs: opts.engineArgs }),
		};

		const aiResult = await withRetry(
			async () => {
				const res = engine.executeStreaming
					? await engine.executeStreaming(
							prompt,
							worktreeDir,
							(step) => logDebug(`Agent ${agentNum}: ${step}`),
							engineOptions,
						)
					: await engine.execute(prompt, worktreeDir, engineOptions);

				if (!res.success && res.error && isRetryableError(res.error)) {
					throw new Error(res.error);
				}
				return res;
			},
			{ maxRetries: opts.maxRetries, retryDelay: opts.retryDelay },
		);

		if (!aiResult.success) {
			return {
				agentNum,
				worktreeDir,
				branchName,
				score: null,
				evalOutput: aiResult.error || "Agent failed",
				success: false,
			};
		}

		// Commit any uncommitted changes in the worktree
		const worktreeGit = simpleGit(worktreeDir);
		try {
			const status = await worktreeGit.status();
			if (status.files.length > 0) {
				await worktreeGit.add(".");
				await worktreeGit.commit(`competition round ${round}, agent ${agentNum}`);
			}
		} catch {
			logDebug(`Agent ${agentNum}: commit skipped`);
		}

		// Run evaluation in the worktree
		const evalResult = await runEvaluation(opts.evaluateConfig, worktreeDir);

		return {
			agentNum,
			worktreeDir,
			branchName,
			score: evalResult.score ?? null,
			evalOutput: evalResult.output || evalResult.error || "",
			success: evalResult.success && evalResult.score !== undefined,
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		logDebug(`Agent ${agentNum} crashed: ${errorMsg}`);
		return {
			agentNum,
			worktreeDir,
			branchName,
			score: null,
			evalOutput: errorMsg,
			success: false,
		};
	}
}

/**
 * Clean up all worktrees from a competition round.
 */
async function cleanupRoundWorktrees(
	agents: AgentScore[],
	originalDir: string,
): Promise<void> {
	for (const agent of agents) {
		if (agent.worktreeDir) {
			try {
				await cleanupAgentWorktree(agent.worktreeDir, agent.branchName, originalDir);
			} catch {
				logDebug(`Failed to cleanup worktree for agent ${agent.agentNum}`);
			}
		}
	}
}
