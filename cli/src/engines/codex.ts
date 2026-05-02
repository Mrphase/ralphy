import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	BaseAIEngine,
	execCommandStreaming,
	extractCodexLikeError,
	extractDisplayLinesFromCodexEventLine,
	formatCommandError,
} from "./base.ts";
import type { AIResult, EngineOptions } from "./types.ts";
import { logDebug, logVerboseOutputLine, logWarn } from "../ui/logger.ts";
import { getOrCreateSessionLog, type SessionLogWriter } from "../ui/session-log.ts";

const isWindows = process.platform === "win32";

const DEFAULT_CODEX_MODEL = "gpt-5.5";
const CODEX_FALLBACK_MODELS = [
	DEFAULT_CODEX_MODEL,
	"gpt-5.4",
	"gpt-5.3-codex",
] as const;
// Errors that must NOT trigger automatic model fallback. Usage-limit errors
// are handled by the upper-layer wait-and-resume flow (see execution/usage-limit.ts),
// auth/spawn errors are unrecoverable by retrying with a different model.
const CODEX_NON_FALLBACK_ERROR_PATTERNS = [
	/usage limit/i,
	/hit your limit/i,
	/try again at/i,
	/not authenticated/i,
	/authentication required/i,
	/please authenticate/i,
	/please login/i,
	/spawn error/i,
	/command not found/i,
	/is not recognized as an internal or external command/i,
	/enoent/i,
];
const CODEX_FALLBACK_ERROR_PATTERNS = [
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

export function extractCodexError(output: string): string | null {
	return extractCodexLikeError(output);
}

/**
 * Codex AI Engine - with verbose logging and clean session logs
 */
export class CodexEngine extends BaseAIEngine {
	name = "Codex";
	cliCommand = "codex";

	private getLogModelName(options?: EngineOptions): string {
		return options?.modelOverride || DEFAULT_CODEX_MODEL;
	}

	private getCandidateModels(options?: EngineOptions): string[] {
		const preferredModel = options?.modelOverride || DEFAULT_CODEX_MODEL;
		return Array.from(new Set([preferredModel, ...CODEX_FALLBACK_MODELS]));
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
		if (CODEX_NON_FALLBACK_ERROR_PATTERNS.some((pattern) => pattern.test(result.error || ""))) {
			return false;
		}
		if (!result.response.trim()) {
			return true;
		}
		return CODEX_FALLBACK_ERROR_PATTERNS.some((pattern) => pattern.test(result.error || ""));
	}

	private logModelFallback(
		failedModel: string,
		nextModel: string,
		error: string,
		sessionLog?: SessionLogWriter,
	): void {
		const summary = this.summarizeError(error);
		const message = `[Codex] Model fallback: ${failedModel} -> ${nextModel} (${summary})`;
		logWarn(message);
		sessionLog?.append(message);
	}

	private logExecutionContext(prompt: string, workDir: string, args: string[], options?: EngineOptions): void {
		logDebug(`[Codex] Working directory: ${workDir}`);
		logDebug(`[Codex] Prompt length: ${prompt.length} chars`);
		logDebug(`[Codex] Prompt preview: ${prompt.substring(0, 200)}...`);
		logDebug(`[Codex] Model: ${options?.modelOverride || "(default)"}`);
		logDebug(
			`[Codex] Extra engine args: ${options?.engineArgs?.length ? options.engineArgs.join(" ") : "(none)"}`,
		);
		logDebug(`[Codex] Command: ${this.cliCommand} ${args.join(" ")}`);
	}

	private logOutputLine(
		line: string,
		stream: "stdout" | "stderr",
		sessionLog?: SessionLogWriter,
	): void {
		const displayLines = extractDisplayLinesFromCodexEventLine(line);
		if (!displayLines || displayLines.length === 0) {
			return;
		}

		for (const displayLine of displayLines) {
			sessionLog?.append(displayLine);
			logVerboseOutputLine(`Codex ${stream}`, displayLine);
		}
	}

	private getExecutionDirectory(workDir: string): string {
		if (isWindows && workDir.startsWith("\\\\")) {
			return tmpdir();
		}

		return workDir;
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
			const attemptOptions: EngineOptions = { ...(options || {}), modelOverride: model };
			const result = await this.executeOnce(prompt, workDir, executionDir, attemptOptions, sessionLog);
			const nextModel = candidateModels[attemptIndex + 1];

			if (!this.shouldFallbackToNextModel(result, nextModel)) {
				return result;
			}

			lastResult = result;
			this.logModelFallback(model, nextModel as string, result.error || "", sessionLog);
		}

		return (
			lastResult || {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error: "Codex exhausted all configured fallback models.",
			}
		);
	}

	private async executeOnce(
		prompt: string,
		workDir: string,
		executionDir: string,
		options: EngineOptions,
		sessionLog: SessionLogWriter | undefined,
	): Promise<AIResult> {
		const lastMessageFile = join(
			executionDir,
			`.codex-last-message-${Date.now()}-${process.pid}.txt`,
		);

		try {
			const args = [
				"exec",
				"--full-auto",
				"--json",
				"--skip-git-repo-check",
				"-C",
				workDir,
				"--output-last-message",
				lastMessageFile,
			];
			const effectiveModel = options.modelOverride || DEFAULT_CODEX_MODEL;
			args.push("--model", effectiveModel);
			if (options.engineArgs && options.engineArgs.length > 0) {
				args.push(...options.engineArgs);
			}

			let stdinContent: string | undefined;
			if (isWindows) {
				stdinContent = prompt;
			} else {
				args.push(prompt);
			}

			this.logExecutionContext(prompt, workDir, args, options);

			// Use streaming for real-time logging
			const outputLines: string[] = [];

			const { exitCode } = await execCommandStreaming(
				this.cliCommand,
				args,
				executionDir,
				(line, stream) => {
					outputLines.push(line);
					this.logOutputLine(line, stream, sessionLog);
				},
				undefined,
				stdinContent,
			);

			const output = outputLines.join("\n");

			let response = "";
			if (existsSync(lastMessageFile)) {
				response = readFileSync(lastMessageFile, "utf-8");
				response = response.replace(/^Task completed successfully\.\s*/i, "").trim();
				try { unlinkSync(lastMessageFile); } catch { /* ignore */ }
			}

			const codexError = extractCodexError(output);
			if (codexError) {
				return { success: false, response: "", inputTokens: 0, outputTokens: 0, error: codexError };
			}

			if (exitCode !== 0) {
				return { success: false, response: response || "Task completed", inputTokens: 0, outputTokens: 0, error: formatCommandError(exitCode, output) };
			}

			return { success: true, response: response || "Task completed", inputTokens: 0, outputTokens: 0 };
		} finally {
			if (existsSync(lastMessageFile)) {
				try { unlinkSync(lastMessageFile); } catch { /* ignore */ }
			}
		}
	}
}
