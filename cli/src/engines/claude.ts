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
import { logDebug, logVerboseOutputLine } from "../ui/logger.ts";
import { getOrCreateSessionLog, type SessionLogWriter } from "../ui/session-log.ts";

const isWindows = process.platform === "win32";

/**
 * Claude Code AI Engine
 */
export class ClaudeEngine extends BaseAIEngine {
	name = "Claude Code";
	cliCommand = "claude";

	private getLogModelName(options?: EngineOptions): string {
		return options?.modelOverride || "claude";
	}

	private logExecutionContext(prompt: string, workDir: string, args: string[], options?: EngineOptions): void {
		logDebug(`[Claude] Working directory: ${workDir}`);
		logDebug(`[Claude] Prompt length: ${prompt.length} chars`);
		logDebug(`[Claude] Prompt preview: ${prompt.substring(0, 200)}...`);
		logDebug(`[Claude] Model: ${options?.modelOverride || "(default)"}`);
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
		const args = ["--dangerously-skip-permissions", "--verbose", "--output-format", "stream-json"];
		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		// Add any additional engine-specific arguments
		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}

		// On Windows, pass prompt via stdin to avoid cmd.exe argument parsing issues with multi-line content
		// On other platforms, pass as argument for compatibility
		let stdinContent: string | undefined;
		if (isWindows) {
			args.push("-p"); // Enable print mode, prompt comes from stdin
			stdinContent = prompt;
		} else {
			args.push("-p", prompt);
		}

		this.logExecutionContext(prompt, workDir, args, options);
		const sessionLog = getOrCreateSessionLog({
			workDir,
			modelName: this.getLogModelName(options),
		});

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

		// Check for errors
		const error = checkForErrors(output);
		if (error) {
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error,
			};
		}

		// Parse result
		const { response, inputTokens, outputTokens } = parseStreamJsonResult(output);

		// If command failed with non-zero exit code, provide a meaningful error
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
	}

	async executeStreaming(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult> {
		const args = ["--dangerously-skip-permissions", "--verbose", "--output-format", "stream-json"];
		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		// Add any additional engine-specific arguments
		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}

		// On Windows, pass prompt via stdin to avoid cmd.exe argument parsing issues with multi-line content
		// On other platforms, pass as argument for compatibility
		let stdinContent: string | undefined;
		if (isWindows) {
			args.push("-p"); // Enable print mode, prompt comes from stdin
			stdinContent = prompt;
		} else {
			args.push("-p", prompt);
		}

		this.logExecutionContext(prompt, workDir, args, options);
		const sessionLog = getOrCreateSessionLog({
			workDir,
			modelName: this.getLogModelName(options),
		});

		const outputLines: string[] = [];

		const { exitCode } = await execCommandStreaming(
			this.cliCommand,
			args,
			workDir,
			(line, stream) => {
				outputLines.push(line);
				this.logOutputLine(line, stream, sessionLog);

				// Detect and report step changes
				const step = detectStepFromOutput(line);
				if (step) {
					onProgress(step);
				}
			},
			undefined,
			stdinContent,
		);

		const output = outputLines.join("\n");

		// Check for errors
		const error = checkForErrors(output);
		if (error) {
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error,
			};
		}

		// Parse result
		const { response, inputTokens, outputTokens } = parseStreamJsonResult(output);

		// If command failed with non-zero exit code, provide a meaningful error
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
	}
}
