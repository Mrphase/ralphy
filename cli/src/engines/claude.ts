import { logDebug, logVerboseOutputLine, logWarn } from "../ui/logger.ts";
import { type SessionLogWriter, getOrCreateSessionLog } from "../ui/session-log.ts";
import {
	BaseAIEngine,
	checkForErrors,
	detectStepFromOutput,
	execCommand,
	execCommandStreaming,
	extractDisplayLinesFromStreamJsonLine,
	formatCommandError,
	parseStreamJsonResult,
} from "./base.ts";
import type { AIResult, EngineOptions, ProgressCallback } from "./types.ts";

const isWindows = process.platform === "win32";
const DEFAULT_CLAUDE_MODEL = "claude-opus-4-7[1m]";
const CLAUDE_FALLBACK_MODELS = [
	DEFAULT_CLAUDE_MODEL,
	"claude-opus-4-7",
	"claude-opus-4-6[1m]",
	"claude-opus-4-6",
	"claude-sonnet-4-6[1m]",
	"claude-sonnet-4-6",
] as const;
const CLAUDE_NON_FALLBACK_ERROR_PATTERNS = [
	/invalid api key/i,
	/authentication/i,
	/not authenticated/i,
	/unauthorized/i,
	/please login/i,
	/spawn error/i,
	/command not found/i,
	/is not recognized as an internal or external command/i,
	/enoent/i,
];
const CLAUDE_FALLBACK_ERROR_PATTERNS = [
	/\bmodel\b/i,
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
	/forbidden/i,
	/access denied/i,
];

/**
 * Claude Code AI Engine
 */
export class ClaudeEngine extends BaseAIEngine {
	name = "Claude Code";
	cliCommand = "claude";

	private getLogModelName(options?: EngineOptions): string {
		return options?.modelOverride || DEFAULT_CLAUDE_MODEL;
	}

	private getCandidateModels(options?: EngineOptions): string[] {
		const preferredModel = options?.modelOverride || DEFAULT_CLAUDE_MODEL;
		return Array.from(new Set([preferredModel, ...CLAUDE_FALLBACK_MODELS]));
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

		if (CLAUDE_NON_FALLBACK_ERROR_PATTERNS.some((pattern) => pattern.test(result.error || ""))) {
			return false;
		}

		if (!result.response.trim()) {
			return true;
		}

		return CLAUDE_FALLBACK_ERROR_PATTERNS.some((pattern) => pattern.test(result.error || ""));
	}

	private logModelFallback(
		failedModel: string,
		nextModel: string,
		error: string,
		sessionLog?: SessionLogWriter,
	): void {
		const summary = this.summarizeError(error);
		const message = `[Claude] Model fallback: ${failedModel} -> ${nextModel} (${summary})`;
		logWarn(message);
		sessionLog?.append(message);
	}

	private buildArgs(
		prompt: string,
		options?: EngineOptions,
	): { args: string[]; stdinContent?: string } {
		const args = ["--dangerously-skip-permissions", "--verbose", "--output-format", "stream-json"];
		const model = options?.modelOverride || DEFAULT_CLAUDE_MODEL;

		args.push("--model", model);
		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}

		let stdinContent: string | undefined;
		if (isWindows) {
			args.push("-p");
			stdinContent = prompt;
		} else {
			args.push("-p", prompt);
		}

		return { args, stdinContent };
	}

	private logExecutionContext(
		prompt: string,
		workDir: string,
		args: string[],
		options?: EngineOptions,
	): void {
		logDebug(`[Claude] Working directory: ${workDir}`);
		logDebug(`[Claude] Prompt length: ${prompt.length} chars`);
		logDebug(`[Claude] Prompt preview: ${prompt.substring(0, 200)}...`);
		logDebug(`[Claude] Model: ${options?.modelOverride || DEFAULT_CLAUDE_MODEL}`);
		logDebug(
			`[Claude] Extra engine args: ${options?.engineArgs?.length ? options.engineArgs.join(" ") : "(none)"}`,
		);
		logDebug(`[Claude] Command: ${this.cliCommand} ${args.join(" ")}`);
	}

	private logOutputLine(
		line: string,
		stream: "stdout" | "stderr",
		sessionLog?: SessionLogWriter,
	): void {
		const displayLines = extractDisplayLinesFromStreamJsonLine(line);
		if (!displayLines) {
			return;
		}

		for (const displayLine of displayLines) {
			sessionLog?.append(displayLine);
			logVerboseOutputLine(`Claude ${stream}`, displayLine);
		}
	}

	private logCapturedOutput(
		output: string,
		stream: "stdout" | "stderr",
		sessionLog?: SessionLogWriter,
	): void {
		for (const line of output.split(/\r?\n/)) {
			if (line.trim()) {
				this.logOutputLine(line, stream, sessionLog);
			}
		}
	}

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const sessionLog = getOrCreateSessionLog({
			workDir,
			modelName: this.getLogModelName(options),
		});
		const candidateModels = this.getCandidateModels(options);
		let lastResult: AIResult | null = null;

		for (const [attemptIndex, model] of candidateModels.entries()) {
			const attemptOptions = this.buildAttemptOptions(options, model);
			const { args, stdinContent } = this.buildArgs(prompt, attemptOptions);

			this.logExecutionContext(prompt, workDir, args, attemptOptions);

			const { stdout, stderr, exitCode } = await execCommand(
				this.cliCommand,
				args,
				workDir,
				undefined,
				stdinContent,
			);

			this.logCapturedOutput(stdout, "stdout", sessionLog);
			this.logCapturedOutput(stderr, "stderr", sessionLog);

			const output = stdout + stderr;
			const error = checkForErrors(output);
			const result = error
				? {
						success: false,
						response: "",
						inputTokens: 0,
						outputTokens: 0,
						error,
					}
				: ((() => {
						const { response, inputTokens, outputTokens } = parseStreamJsonResult(output);
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
						};
					}) satisfies AIResult);

			const nextModel = candidateModels[attemptIndex + 1];
			if (!this.shouldFallbackToNextModel(result, nextModel)) {
				return result;
			}

			lastResult = result;
			this.logModelFallback(model, nextModel, result.error || "", sessionLog);
		}

		return {
			success: false,
			response: lastResult?.response || "",
			inputTokens: lastResult?.inputTokens || 0,
			outputTokens: lastResult?.outputTokens || 0,
			error: lastResult?.error || "Claude exhausted all configured fallback models.",
		};
	}

	async executeStreaming(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult> {
		const sessionLog = getOrCreateSessionLog({
			workDir,
			modelName: this.getLogModelName(options),
		});
		const candidateModels = this.getCandidateModels(options);
		let lastResult: AIResult | null = null;

		for (const [attemptIndex, model] of candidateModels.entries()) {
			const attemptOptions = this.buildAttemptOptions(options, model);
			const { args, stdinContent } = this.buildArgs(prompt, attemptOptions);
			const outputLines: string[] = [];

			this.logExecutionContext(prompt, workDir, args, attemptOptions);

			const { exitCode } = await execCommandStreaming(
				this.cliCommand,
				args,
				workDir,
				(line, stream) => {
					outputLines.push(line);
					this.logOutputLine(line, stream, sessionLog);

					const step = detectStepFromOutput(line);
					if (step) {
						onProgress(step);
					}
				},
				undefined,
				stdinContent,
			);

			const output = outputLines.join("\n");
			const error = checkForErrors(output);
			const result = error
				? {
						success: false,
						response: "",
						inputTokens: 0,
						outputTokens: 0,
						error,
					}
				: ((() => {
						const { response, inputTokens, outputTokens } = parseStreamJsonResult(output);
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
						};
					}) satisfies AIResult);

			const nextModel = candidateModels[attemptIndex + 1];
			if (!this.shouldFallbackToNextModel(result, nextModel)) {
				return result;
			}

			lastResult = result;
			onProgress("Switching model");
			this.logModelFallback(model, nextModel, result.error || "", sessionLog);
		}

		return {
			success: false,
			response: lastResult?.response || "",
			inputTokens: lastResult?.inputTokens || 0,
			outputTokens: lastResult?.outputTokens || 0,
			error: lastResult?.error || "Claude exhausted all configured fallback models.",
		};
	}
}
