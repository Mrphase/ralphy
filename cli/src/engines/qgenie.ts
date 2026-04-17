import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logDebug, logVerboseOutputLine } from "../ui/logger.ts";
import { getOrCreateSessionLog, type SessionLogWriter } from "../ui/session-log.ts";
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

const DEFAULT_QGENIE_MODEL = "azure::gpt-5.4";
const DEFAULT_QGENIE_REASONING_EFFORT = "xhigh";

/**
 * QGenie CLI AI Engine
 *
 * CLI invocation: `qgenie agent exec`
 * Default model: azure::gpt-5.4
 * Default reasoning effort: xhigh
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
		logDebug(
			`[QGenie] Extra engine args: ${options?.engineArgs?.length ? options.engineArgs.join(" ") : "(none)"}`,
		);
		logDebug(`[QGenie] Command: ${this.cliCommand} ${args.join(" ")}`);
	}

	private logCapturedStreams(
		stdout: string,
		stderr: string,
		sessionLog?: SessionLogWriter,
	): void {
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
		const lastMessageFile = join(
			executionDir,
			`.qgenie-last-message-${Date.now()}-${process.pid}.txt`,
		);
		const { args } = this.buildArgs(workDir, options, lastMessageFile);
		const sessionLog = getOrCreateSessionLog({
			workDir,
			modelName: this.getLogModelName(options),
		});

		this.logExecutionContext(prompt, workDir, executionDir, args, options);

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
			return this.buildResult(output, exitCode, durationMs, response);
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

	async executeStreaming(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult> {
		const executionDir = this.getExecutionDirectory(workDir);
		const lastMessageFile = join(
			executionDir,
			`.qgenie-last-message-${Date.now()}-${process.pid}.txt`,
		);
		const { args } = this.buildArgs(workDir, options, lastMessageFile);
		const outputLines: string[] = [];
		const sessionLog = getOrCreateSessionLog({
			workDir,
			modelName: this.getLogModelName(options),
		});

		this.logExecutionContext(prompt, workDir, executionDir, args, options);
		onProgress("Working");

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

			return this.buildResult(output, exitCode, durationMs, response);
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
