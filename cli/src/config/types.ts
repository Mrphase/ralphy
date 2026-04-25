import { z } from "zod";

/**
 * Project info schema
 */
export const ProjectSchema = z.object({
	name: z.string().default(""),
	language: z.string().default(""),
	framework: z.string().default(""),
	description: z.string().default(""),
});

/**
 * Notifications schema for webhook configuration
 */
export const NotificationsSchema = z.object({
	discord_webhook: z.string().default(""),
	slack_webhook: z.string().default(""),
	custom_webhook: z.string().default(""),
});

/**
 * Commands schema
 */
export const CommandsSchema = z.object({
	test: z.string().default(""),
	lint: z.string().default(""),
	build: z.string().default(""),
});

/**
 * Boundaries schema
 */
export const BoundariesSchema = z.object({
	never_touch: z
		.array(z.string())
		.nullable()
		.transform((v) => v ?? [])
		.default([]),
});

/**
 * Full Ralphy config schema
 */
export const RalphyConfigSchema = z.object({
	project: ProjectSchema.default({}),
	commands: CommandsSchema.default({}),
	rules: z
		.array(z.string())
		.nullable()
		.transform((v) => v ?? [])
		.default([]),
	boundaries: BoundariesSchema.default({}),
	notifications: NotificationsSchema.default({}),
});

/**
 * Ralphy configuration from .ralphy/config.yaml
 */
export type RalphyConfig = z.infer<typeof RalphyConfigSchema>;

/**
 * Runtime options parsed from CLI args
 */
export interface RuntimeOptions {
	/** Enable/disable knowledge system */
	knowledge: boolean;
	/** Number of recent learnings to inject into prompts */
	knowledgeContext: number;
	/** Maximum number of knowledge characters to inject into prompts */
	knowledgeMaxChars: number;
	/** Skip running tests */
	skipTests: boolean;
	/** Skip running lint */
	skipLint: boolean;
	/** AI engine to use */
	aiEngine: string;
	/** Dry run mode (don't execute) */
	dryRun: boolean;
	/** Maximum iterations (0 = unlimited) */
	maxIterations: number;
	/** Maximum retries per task */
	maxRetries: number;
	/** Delay between retries in seconds */
	retryDelay: number;
	/** Automatically wait and resume after a Codex usage-limit failure */
	usageLimitResume: boolean;
	/** Fallback hours to wait when Codex does not provide a retry time */
	usageLimitWaitHours: number;
	/** Verbose output */
	verbose: boolean;
	/** Create branch per task */
	branchPerTask: boolean;
	/** Base branch for PRs */
	baseBranch: string;
	/** Create PR after task */
	createPr: boolean;
	/** Create draft PR */
	draftPr: boolean;
	/** Run tasks in parallel */
	parallel: boolean;
	/** Maximum parallel agents */
	maxParallel: number;
	/** PRD source type */
	prdSource: "markdown" | "markdown-folder" | "yaml" | "json" | "github";
	/** PRD file or folder path */
	prdFile: string;
	/** Whether PRD path is a folder */
	prdIsFolder: boolean;
	/** GitHub repo (owner/repo) */
	githubRepo: string;
	/** GitHub issue label filter */
	githubLabel: string;
	/** GitHub issue number to sync PRD with on each iteration */
	syncIssue?: number;
	/** Auto-commit changes */
	autoCommit: boolean;
	/** Browser automation mode: 'auto' | 'true' | 'false' */
	browserEnabled: "auto" | "true" | "false";
	/** Override default model for the engine */
	modelOverride?: string;
	/** Override reasoning effort for engines that support it */
	reasoningEffort?: string;
	/** Skip automatic branch merging after parallel execution */
	skipMerge?: boolean;
	/** Use lightweight sandboxes instead of git worktrees for parallel execution */
	useSandbox?: boolean;
	/** Additional arguments to pass to the engine CLI */
	engineArgs?: string[];
	/** Iterative optimization mode */
	optimize: boolean;
	/** Multi-agent competition mode */
	compete: boolean;
	/** Evaluation script command (required for --optimize/--compete) */
	evaluateScript?: string;
	/** Maximum optimization rounds */
	optimizeMaxRounds: number;
	/** Number of competing agents per round */
	competeAgents: number;
	/** Number of competition rounds */
	competeRounds: number;
	/** Metric objective direction */
	metricObjective: "minimize" | "maximize" | "pass-fail";
}

/**
 * Default runtime options
 */
export const DEFAULT_OPTIONS: RuntimeOptions = {
	skipTests: false,
	skipLint: false,
	aiEngine: "claude",
	dryRun: false,
	maxIterations: 0,
	maxRetries: 3,
	retryDelay: 5,
	usageLimitResume: true,
	usageLimitWaitHours: 5.5,
	verbose: false,
	branchPerTask: false,
	baseBranch: "",
	createPr: false,
	draftPr: false,
	parallel: false,
	maxParallel: 3,
	prdSource: "markdown",
	prdFile: "PRD.md",
	prdIsFolder: false,
	githubRepo: "",
	githubLabel: "",
	autoCommit: true,
	browserEnabled: "auto",
	knowledge: true,
	knowledgeContext: 10,
	knowledgeMaxChars: 8000,
	optimize: false,
	compete: false,
	optimizeMaxRounds: 20,
	competeAgents: 3,
	competeRounds: 5,
	metricObjective: "maximize",
};
