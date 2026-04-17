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
import { logDebug, logVerboseOutputLine } from "../ui/logger.ts";
import { getOrCreateSessionLog, type SessionLogWriter } from "../ui/session-log.ts";

const isWindows = process.platform === "win32";

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
		return options?.modelOverride || "codex";
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
			if (options?.modelOverride) {
				args.push("--model", options.modelOverride);
			}
			if (options?.engineArgs && options.engineArgs.length > 0) {
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
