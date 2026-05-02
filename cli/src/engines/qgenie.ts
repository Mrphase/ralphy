import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logDebug, logVerboseOutputLine, logWarn } from "../ui/logger.ts";
import { type SessionLogWriter, getOrCreateSessionLog } from "../ui/session-log.ts";
import {
	BaseAIEngine,
	type CommandOutputStream,
	execCommand,
	execCommandStreaming,
	extractCodexLikeError,
	extractDisplayLinesFromCodexEventLine,
	extractLatestCodexAgentMessage,
	formatCommandError,
} from "./base.ts";
import type { AIResult, EngineOptions, ProgressCallback } from "./types.ts";

const DEFAULT_QGENIE_MODEL = "azure::gpt-5.5";
const DEFAULT_QGENIE_REASONING_EFFORT = "xhigh";
const DEFAULT_QGENIE_CONTEXT_WINDOW = 1_000_000;
const QGENIE_FALLBACK_MODELS = [
	DEFAULT_QGENIE_MODEL,
	"azure::gpt-5.4",
	"azure::gpt-5.3-codex",
	"anthropic::claude-4-6-opus",
	"anthropic::claude-4-6-opus:1M",
	"anthropic::claude-4-6-sonnet",
] as const;
const QGENIE_NON_FALLBACK_ERROR_PATTERNS = [
	/not authenticated/i,
	/authentication required/i,
	/please authenticate/i,
	/please login/i,
	/spawn error/i,
	/command not found/i,
	/is not recognized as an internal or external command/i,
	/enoent/i,
];
const QGENIE_FALLBACK_ERROR_PATTERNS = [
	/\bmodel\b/i,
	/\bprovider\b/i,
	/unsupported/i,
	/unavailable/i,
	/overloaded/i,
	/rate limit/i,
	/\b429\b/i,
	/\b5\d\d\b/i,
	/context window/i,
	/timeout/i,
	/timed out/i,
	/connection/i,
	/network/i,
	/internal server error/i,
	/service unavailable/i,
];

/**
 * QGenie CLI AI Engine
 *
 * CLI invocation: `qgenie agent exec`
 * Default model: azure::gpt-5.5
 * Default reasoning effort: xhigh
 * Default context window: 1000000
 * Reasoning effort can be overridden via `-c model_reasoning_effort="..."`
 */
export class QGenieEngine extends BaseAIEngine {
	name = "QGenie";
	cliCommand = "qgenie";

	private getLogModelName(options?: EngineOptions): string {
		return options?.modelOverride || DEFAULT_QGENIE_MODEL;
	}

	private hasReasoningEffortOverride(engineArgs?: string[]): boolean {
		return (engineArgs || []).some((arg) => arg.includes("model_reasoning_effort"));
	}

	private hasContextWindowOverride(engineArgs?: string[]): boolean {
		return (engineArgs || []).some((arg) => arg.includes("model_context_window"));
	}

	private getCandidateModels(options?: EngineOptions): string[] {
		const preferredModel = options?.modelOverride || DEFAULT_QGENIE_MODEL;
		return Array.from(new Set([preferredModel, ...QGENIE_FALLBACK_MODELS]));
	}

	private buildAttemptOptions(
		options: EngineOptions | undefined,
		modelOverride: string,
	): EngineOptions {
		return {
			...(options || {}),
			modelOverride,
		};
	}

	private createLastMessageFilePath(executionDir: string, attemptIndex: number): string {
		return join(
			executionDir,
			`.qgenie-last-message-${Date.now()}-${process.pid}-${attemptIndex}.txt`,
		);
	}

	private summarizeError(error: string): string {
		const lines = error
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)
			.filter(
				(line) => !/^Command failed with exit code \d+\.?/i.test(line) && !/^Output:$/i.test(line),
			);

		return lines.at(-1) || lines[0] || "Unknown error";
	}

	private shouldFallbackToNextModel(result: AIResult, nextModel?: string): boolean {
		if (result.success || !nextModel || !result.error) {
			return false;
		}

		if (QGENIE_NON_FALLBACK_ERROR_PATTERNS.some((pattern) => pattern.test(result.error || ""))) {
			return false;
		}

		if (!result.response.trim()) {
			return true;
		}

		return QGENIE_FALLBACK_ERROR_PATTERNS.some((pattern) => pattern.test(result.error || ""));
	}

	private logModelFallback(
		failedModel: string,
		nextModel: string,
		error: string,
		sessionLog?: SessionLogWriter,
	): void {
		const summary = this.summarizeError(error);
		const message = `[QGenie] Model fallback: ${failedModel} -> ${nextModel} (${summary})`;
		logWarn(message);
		sessionLog?.append(message);
	}

	/**
	 * Use a local execution directory on Windows when the target workspace is a UNC path.
	 */
	private getExecutionDirectory(workDir: string): string {
		if (process.platform === "win32" && workDir.startsWith("\\\\")) {
			return tmpdir();
		}

		return workDir;
	}

	/**
	 * Build command arguments for QGenie CLI
	 */
	private buildArgs(
		workDir: string,
		options?: EngineOptions,
		lastMessageFile?: string,
	): { args: string[] } {
		const args: string[] = [];
		const model = options?.modelOverride || DEFAULT_QGENIE_MODEL;
		const reasoningEffort = options?.reasoningEffort || DEFAULT_QGENIE_REASONING_EFFORT;
		const contextWindow = DEFAULT_QGENIE_CONTEXT_WINDOW;

		// Subcommand: agent exec (non-interactive)
		args.push("agent");
		args.push("exec");
		args.push("--full-auto");
		args.push("--json");
		args.push("--color", "never");

		args.push("-C", workDir);
		args.push("--skip-git-repo-check");

		args.push("--model", model);
		if (lastMessageFile) {
			args.push("--output-last-message", lastMessageFile);
		}

		if (reasoningEffort && !this.hasReasoningEffortOverride(options?.engineArgs)) {
			args.push("-c", `model_reasoning_effort="${reasoningEffort}"`);
		}
		if (contextWindow && !this.hasContextWindowOverride(options?.engineArgs)) {
			args.push("-c", `model_context_window=${contextWindow}`);
		}
		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}
		return { args };
	}

	private logExecutionContext(
		prompt: string,
		workDir: string,
		executionDir: string,
		args: string[],
		options?: EngineOptions,
	): void {
		const effectiveModel = options?.modelOverride || DEFAULT_QGENIE_MODEL;
		const effectiveReasoningEffort = options?.reasoningEffort || DEFAULT_QGENIE_REASONING_EFFORT;

		logDebug(`[QGenie] Working directory: ${workDir}`);
		logDebug(`[QGenie] Execution directory: ${executionDir}`);
		logDebug(`[QGenie] Prompt length: ${prompt.length} chars`);
		logDebug(`[QGenie] Prompt preview: ${prompt.substring(0, 200)}...`);
		logDebug(`[QGenie] Model: ${effectiveModel}`);
		logDebug(`[QGenie] Reasoning effort: ${effectiveReasoningEffort}`);
		logDebug(`[QGenie] Context window: ${DEFAULT_QGENIE_CONTEXT_WINDOW}`);
		logDebug(
			`[QGenie] Extra engine args: ${options?.engineArgs?.length ? options.engineArgs.join(" ") : "(none)"}`,
		);
		logDebug(`[QGenie] Command: ${this.cliCommand} ${args.join(" ")}`);
	}

	private logCapturedStreams(stdout: string, stderr: string, sessionLog?: SessionLogWriter): void {
		for (const line of stdout.split(/\r?\n/)) {
			if (line.trim()) {
				this.logOutputLine(line, "stdout", sessionLog);
			}
		}

		for (const line of stderr.split(/\r?\n/)) {
			if (line.trim()) {
				this.logOutputLine(line, "stderr", sessionLog);
			}
		}
	}

	private logOutputLine(
		line: string,
		stream: CommandOutputStream,
		sessionLog?: SessionLogWriter,
	): void {
		const displayLines = extractDisplayLinesFromCodexEventLine(line);
		if (!displayLines) {
			return;
		}

		for (const displayLine of displayLines) {
			sessionLog?.append(displayLine);
			logVerboseOutputLine(`QGenie ${stream}`, displayLine);
		}
	}

	private detectProgressFromLine(line: string): string | null {
		const displayLines = extractDisplayLinesFromCodexEventLine(line);
		if (!displayLines) {
			return null;
		}

		for (const displayLine of displayLines) {
			const trimmedLower = displayLine.trim().toLowerCase();
			if (!trimmedLower) {
				continue;
			}
			if (trimmedLower.startsWith("thinking")) {
				return "Thinking";
			}
			if (trimmedLower.startsWith("reading") || trimmedLower.startsWith("searching")) {
				return "Reading code";
			}
			if (trimmedLower.startsWith("working on it") || trimmedLower.startsWith("editing")) {
				return "Implementing";
			}
			if (trimmedLower.startsWith("testing") || trimmedLower.startsWith("running tests")) {
				return "Testing";
			}
			if (trimmedLower.startsWith("done") || trimmedLower.startsWith("completed")) {
				return "Finalizing";
			}
		}

		return null;
	}

	private consumeLastMessageFile(lastMessageFile: string): string {
		if (!existsSync(lastMessageFile)) {
			return "";
		}

		try {
			return readFileSync(lastMessageFile, "utf-8")
				.replace(/^Task completed successfully\.\s*/i, "")
				.trim();
		} catch {
			return "";
		} finally {
			try {
				unlinkSync(lastMessageFile);
			} catch {
				// Ignore cleanup errors
			}
		}
	}

	private buildResult(
		output: string,
		exitCode: number,
		durationMs: number,
		responseOverride = "",
	): AIResult {
		logDebug(`[QGenie] Exit code: ${exitCode}`);
		logDebug(`[QGenie] Duration: ${durationMs}ms`);
		logDebug(`[QGenie] Output length: ${output.length} chars`);

		const structuredError = extractCodexLikeError(output);
		if (structuredError) {
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error: structuredError,
			};
		}

		const qgenieError = this.checkQGenieErrors(output);
		if (qgenieError) {
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error: qgenieError,
			};
		}

		const { response: parsedResponse, inputTokens, outputTokens } = this.parseOutput(output);
		const response = responseOverride || parsedResponse;

		if (exitCode !== 0) {
			return {
				success: false,
				response,
				inputTokens,
				outputTokens,
				error: formatCommandError(exitCode, output),
			};
		}

		return {
			success: true,
			response,
			inputTokens,
			outputTokens,
			cost: durationMs > 0 ? `duration:${durationMs}` : undefined,
		};
	}

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const executionDir = this.getExecutionDirectory(workDir);
		const sessionLog = getOrCreateSessionLog({
			workDir,
			modelName: this.getLogModelName(options),
		});
		const candidateModels = this.getCandidateModels(options);
		let lastResult: AIResult | null = null;

		for (const [attemptIndex, model] of candidateModels.entries()) {
			const lastMessageFile = this.createLastMessageFilePath(executionDir, attemptIndex);
			const attemptOptions = this.buildAttemptOptions(options, model);
			const { args } = this.buildArgs(workDir, attemptOptions, lastMessageFile);

			this.logExecutionContext(prompt, workDir, executionDir, args, attemptOptions);

			try {
				const startTime = Date.now();
				const { stdout, stderr, exitCode } = await execCommand(
					this.cliCommand,
					args,
					executionDir,
					undefined,
					prompt,
				);
				const durationMs = Date.now() - startTime;

				this.logCapturedStreams(stdout, stderr, sessionLog);

				const output = stdout + stderr;
				const response = this.consumeLastMessageFile(lastMessageFile);
				const result = this.buildResult(output, exitCode, durationMs, response);
				const nextModel = candidateModels[attemptIndex + 1];

				if (!this.shouldFallbackToNextModel(result, nextModel)) {
					return result;
				}

				lastResult = result;
				this.logModelFallback(model, nextModel, result.error || "", sessionLog);
			} finally {
				if (existsSync(lastMessageFile)) {
					try {
						unlinkSync(lastMessageFile);
					} catch {
						// Ignore cleanup errors
					}
				}
			}
		}

		return (
			lastResult || {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error: "QGenie exhausted all configured fallback models.",
			}
		);
	}

	async executeStreaming(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult> {
		const executionDir = this.getExecutionDirectory(workDir);
		const sessionLog = getOrCreateSessionLog({
			workDir,
			modelName: this.getLogModelName(options),
		});
		const candidateModels = this.getCandidateModels(options);
		let lastResult: AIResult | null = null;

		onProgress("Working");

		for (const [attemptIndex, model] of candidateModels.entries()) {
			const lastMessageFile = this.createLastMessageFilePath(executionDir, attemptIndex);
			const attemptOptions = this.buildAttemptOptions(options, model);
			const { args } = this.buildArgs(workDir, attemptOptions, lastMessageFile);
			const outputLines: string[] = [];

			this.logExecutionContext(prompt, workDir, executionDir, args, attemptOptions);

			try {
				const startTime = Date.now();
				const { exitCode } = await execCommandStreaming(
					this.cliCommand,
					args,
					executionDir,
					(line, stream) => {
						outputLines.push(line);
						this.logOutputLine(line, stream, sessionLog);

						const step = this.detectProgressFromLine(line);
						if (step) {
							onProgress(step);
						}
					},
					undefined,
					prompt,
				);
				const durationMs = Date.now() - startTime;
				const output = outputLines.join("\n");
				const response = this.consumeLastMessageFile(lastMessageFile);
				const result = this.buildResult(output, exitCode, durationMs, response);
				const nextModel = candidateModels[attemptIndex + 1];

				if (!this.shouldFallbackToNextModel(result, nextModel)) {
					return result;
				}

				lastResult = result;
				onProgress("Switching model");
				this.logModelFallback(model, nextModel, result.error || "", sessionLog);
			} finally {
				if (existsSync(lastMessageFile)) {
					try {
						unlinkSync(lastMessageFile);
					} catch {
						// Ignore cleanup errors
					}
				}
			}
		}

		return (
			lastResult || {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error: "QGenie exhausted all configured fallback models.",
			}
		);
	}

	/**
	 * Check for QGenie-specific errors in output
	 */
	private checkQGenieErrors(output: string): string | null {
		const trimmed = output.trim();
		const trimmedLower = trimmed.toLowerCase();

		if (
			trimmedLower.startsWith("no authentication") ||
			trimmedLower.startsWith("not authenticated") ||
			trimmedLower.startsWith("authentication required") ||
			trimmedLower.startsWith("please authenticate") ||
			trimmedLower.startsWith("please login")
		) {
			return "QGenie CLI is not authenticated. Run 'qgenie' and log in first.";
		}

		return null;
	}

	/**
	 * Parse a token count string like "17.5k" or "73" into a number
	 */
	private parseTokenCount(str: string): number {
		const trimmed = str.trim().toLowerCase();
		if (trimmed.endsWith("k")) {
			const value = Number.parseFloat(trimmed.slice(0, -1));
			return Number.isNaN(value) ? 0 : Math.round(value * 1000);
		}
		if (trimmed.endsWith("m")) {
			const value = Number.parseFloat(trimmed.slice(0, -1));
			return Number.isNaN(value) ? 0 : Math.round(value * 1000000);
		}
		const value = Number.parseFloat(trimmed);
		return Number.isNaN(value) ? 0 : Math.round(value);
	}

	/**
	 * Extract token counts from output if available
	 */
	private parseTokenCounts(output: string): { inputTokens: number; outputTokens: number } {
		const tokenMatch = output.match(/(\d+(?:\.\d+)?[km]?)\s+in,\s+(\d+(?:\.\d+)?[km]?)\s+out/i);

		if (tokenMatch) {
			const inputTokens = this.parseTokenCount(tokenMatch[1]);
			const outputTokens = this.parseTokenCount(tokenMatch[2]);
			logDebug(`[QGenie] Parsed tokens: ${inputTokens} in, ${outputTokens} out`);
			return { inputTokens, outputTokens };
		}

		return { inputTokens: 0, outputTokens: 0 };
	}

	private parseOutput(output: string): {
		response: string;
		inputTokens: number;
		outputTokens: number;
	} {
		const { inputTokens, outputTokens } = this.parseTokenCounts(output);
		const latestStructuredMessage = extractLatestCodexAgentMessage(output);
		if (latestStructuredMessage !== "Task completed") {
			return {
				response: latestStructuredMessage,
				inputTokens,
				outputTokens,
			};
		}

		const meaningfulLines = output
			.split(/\r?\n/)
			.flatMap((line) => extractDisplayLinesFromCodexEventLine(line) || []);

		const response = meaningfulLines.join("\n").trim() || "Task completed";
		return { response, inputTokens, outputTokens };
	}
}
