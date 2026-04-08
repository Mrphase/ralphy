import { existsSync, statSync } from "node:fs";
import { Command } from "commander";
import type { RuntimeOptions } from "../config/types.ts";
import { VERSION } from "../version.ts";

/**
 * Create the CLI program with all options
 */
export function createProgram(): Command {
	const program = new Command();

	program
		.name("ralphy")
		.description(
			"Autonomous AI Coding Loop - Supports Claude Code, OpenCode, Codex, Cursor, Qwen-Code, Factory Droid, GitHub Copilot, Gemini CLI and QGenie",
		)
		.version(VERSION)
		.argument("[task]", "Single task to execute (brownfield mode)")
		.allowExcessArguments(true)
		.option("--init", "Initialize .ralphy/ configuration")
		.option("--config", "Show current configuration")
		.option("--add-rule <rule>", "Add a rule to config")
		.option("--no-tests, --skip-tests", "Skip running tests")
		.option("--no-lint, --skip-lint", "Skip running lint")
		.option("--fast", "Skip both tests and lint")
		.option("--claude", "Use Claude Code (default)")
		.option("--opencode", "Use OpenCode")
		.option("--cursor", "Use Cursor Agent")
		.option("--codex", "Use Codex")
		.option("--qwen", "Use Qwen-Code")
		.option("--droid", "Use Factory Droid")
		.option("--copilot", "Use GitHub Copilot")
		.option("--gemini", "Use Gemini CLI")
		.option("--qgenie", "Use QGenie")
		.option("--dry-run", "Show what would be done without executing")
		.option("--max-iterations <n>", "Maximum iterations (0 = unlimited)", "0")
		.option("--max-retries <n>", "Maximum retries per task", "3")
		.option("--retry-delay <n>", "Delay between retries in seconds", "5")
		.option(
			"--usage-limit-wait-hours <n>",
			"Fallback hours to wait before retrying a Codex usage limit",
			"5.5",
		)
		.option("--no-usage-limit-resume", "Disable automatic wait-and-resume for Codex usage limits")
		.option("--parallel", "Run tasks in parallel using worktrees")
		.option(
			"--sandbox",
			"Use lightweight sandboxes instead of git worktrees (faster for large repos)",
		)
		.option("--max-parallel <n>", "Maximum parallel agents", "3")
		.option("--branch-per-task", "Create a branch for each task")
		.option("--base-branch <branch>", "Base branch for PRs")
		.option("--create-pr", "Create pull request after each task")
		.option("--draft-pr", "Create PRs as draft")
		.option("--prd <path>", "PRD file or folder (auto-detected)", "PRD.md")
		.option("--yaml <file>", "YAML task file")
		.option("--json <file>", "JSON task file")
		.option("--github <repo>", "GitHub repo for issues (owner/repo)")
		.option("--github-label <label>", "Filter GitHub issues by label")
		.option("--sync-issue <number>", "Sync PRD file to GitHub issue body on each iteration")
		.option("--no-commit", "Don't auto-commit changes")
		.option("--browser", "Enable browser automation (agent-browser)")
		.option("--no-browser", "Disable browser automation")
		.option("--model <name>", "Override default model for the engine")
		.option("--effort <level>", "Override reasoning effort for supported engines")
		.option("--sonnet", "Shortcut for --claude --model sonnet")
		.option("--no-merge", "Skip automatic branch merging after parallel execution")
		.option("--no-knowledge", "Disable cross-iteration knowledge system")
		.option("--knowledge-context <n>", "Number of recent learnings to inject into prompts", "10")
		.option("--knowledge-max-chars <n>", "Maximum characters of knowledge to inject", "8000")
		.option("-v, --verbose", "Verbose output")
		.allowUnknownOption();

	return program;
}

/**
 * Parse command line arguments into RuntimeOptions
 */
export function parseArgs(args: string[]): {
	options: RuntimeOptions;
	task: string | undefined;
	initMode: boolean;
	showConfig: boolean;
	addRule: string | undefined;
	knowledgeCommand: "show" | "reset" | undefined;
} {
	// Find the -- separator and extract engine-specific arguments
	const separatorIndex = args.indexOf("--");
	let engineArgs: string[] = [];
	let ralphyArgs = args;

	if (separatorIndex !== -1) {
		engineArgs = args.slice(separatorIndex + 1);
		ralphyArgs = args.slice(0, separatorIndex);
	}

	const program = createProgram();
	program.parse(ralphyArgs);

	const opts = program.opts();
	const [firstArg, secondArg] = program.args;

	// Handle `ralphy knowledge show|reset` subcommand
	let knowledgeCommand: "show" | "reset" | undefined;
	if (firstArg === "knowledge") {
		if (secondArg === "show" || secondArg === "reset") {
			knowledgeCommand = secondArg;
		} else {
			knowledgeCommand = "show"; // default to show
		}
	}

	const task = knowledgeCommand ? undefined : firstArg;

	// Determine AI engine (--sonnet implies --claude)
	let aiEngine = "claude";
	if (opts.sonnet) aiEngine = "claude";
	else if (opts.opencode) aiEngine = "opencode";
	else if (opts.cursor) aiEngine = "cursor";
	else if (opts.codex) aiEngine = "codex";
	else if (opts.qwen) aiEngine = "qwen";
	else if (opts.droid) aiEngine = "droid";
	else if (opts.copilot) aiEngine = "copilot";
	else if (opts.gemini) aiEngine = "gemini";
	else if (opts.qgenie) aiEngine = "qgenie";

	// Determine model override (--sonnet is shortcut for --model sonnet)
	const modelOverride = opts.sonnet ? "sonnet" : opts.model || undefined;
	const reasoningEffort = opts.effort || undefined;

	// Determine PRD source with auto-detection for file vs folder
	let prdSource: "markdown" | "markdown-folder" | "yaml" | "json" | "github" = "markdown";
	let prdFile = opts.prd || "PRD.md";
	let prdIsFolder = false;

	if (opts.json) {
		prdSource = "json";
		prdFile = opts.json;
	} else if (opts.yaml) {
		prdSource = "yaml";
		prdFile = opts.yaml;
	} else if (opts.github) {
		prdSource = "github";
	} else {
		// Auto-detect if PRD path is a file or folder
		if (existsSync(prdFile)) {
			const stat = statSync(prdFile);
			if (stat.isDirectory()) {
				prdSource = "markdown-folder";
				prdIsFolder = true;
			} else if (prdFile.toLowerCase().endsWith(".json")) {
				prdSource = "json";
			}
		}
	}

	// Handle --fast
	const skipTests = opts.fast || opts.skipTests;
	const skipLint = opts.fast || opts.skipLint;

	const options: RuntimeOptions = {
		skipTests,
		skipLint,
		aiEngine,
		dryRun: opts.dryRun || false,
		maxIterations: Number.parseInt(opts.maxIterations, 10) || 0,
		maxRetries: Number.parseInt(opts.maxRetries, 10) || 3,
		retryDelay: Number.parseInt(opts.retryDelay, 10) || 5,
		usageLimitResume: opts.usageLimitResume !== false,
		usageLimitWaitHours: Number.parseFloat(opts.usageLimitWaitHours) || 5.5,
		verbose: opts.verbose || false,
		branchPerTask: opts.branchPerTask || false,
		baseBranch: opts.baseBranch || "",
		createPr: opts.createPr || false,
		draftPr: opts.draftPr || false,
		parallel: opts.parallel || false,
		maxParallel: Number.parseInt(opts.maxParallel, 10) || 3,
		prdSource,
		prdFile,
		prdIsFolder,
		githubRepo: opts.github || "",
		githubLabel: opts.githubLabel || "",
		syncIssue: opts.syncIssue ? Number.parseInt(opts.syncIssue, 10) || undefined : undefined,
		autoCommit: opts.commit !== false,
		browserEnabled: opts.browser === true ? "true" : opts.browser === false ? "false" : "auto",
		modelOverride,
		reasoningEffort,
		skipMerge: opts.merge === false,
		useSandbox: opts.sandbox || false,
		engineArgs,
		knowledge: opts.knowledge !== false,
		knowledgeContext: Number.parseInt(opts.knowledgeContext, 10) || 10,
		knowledgeMaxChars: Number.parseInt(opts.knowledgeMaxChars, 10) || 8000,
	};

	return {
		options,
		task,
		initMode: opts.init || false,
		showConfig: opts.config || false,
		addRule: opts.addRule,
		knowledgeCommand,
	};
}

/**
 * Print version
 */
export function printVersion(): void {
	console.log(`ralphy v${VERSION}`);
}

/**
 * Print help
 */
export function printHelp(): void {
	const program = createProgram();
	program.outputHelp();
}
