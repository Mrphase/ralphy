import { existsSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BaseAIEngine, execCommand, formatCommandError } from "./base.ts";
import type { AIResult, EngineOptions } from "./types.ts";

const isWindows = process.platform === "win32";

function collectCodexErrorText(value: unknown): string[] {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed ? [trimmed] : [];
	}

	if (Array.isArray(value)) {
		return value.flatMap((item) => collectCodexErrorText(item));
	}

	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		if (typeof record.text === "string") {
			return collectCodexErrorText(record.text);
		}

		return [record.message, record.error, record.result, record.content].flatMap((item) =>
			collectCodexErrorText(item),
		);
	}

	return [];
}

export function extractCodexError(output: string): string | null {
	const lines = output.split("\n").filter(Boolean);

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			const isErrorLine =
				parsed.type === "error" ||
				parsed.is_error === true ||
				(typeof parsed.error === "string" && parsed.error.length > 0);

			if (!isErrorLine) {
				continue;
			}

			const messages = [parsed.message, parsed.error, parsed.result]
				.flatMap((item) => collectCodexErrorText(item))
				.filter(Boolean);
			if (messages.length > 0) {
				return messages.join("\n");
			}

			return "Unknown error";
		} catch {
			// Ignore non-JSON lines
		}
	}

	return null;
}

/**
 * Codex AI Engine
 */
export class CodexEngine extends BaseAIEngine {
	name = "Codex";
	cliCommand = "codex";

	private getExecutionDirectory(workDir: string): string {
		if (isWindows && workDir.startsWith("\\\\")) {
			return tmpdir();
		}

		return workDir;
	}

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const executionDir = this.getExecutionDirectory(workDir);
		// Codex uses a separate file for the last message
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
			// Add any additional engine-specific arguments
			if (options?.engineArgs && options.engineArgs.length > 0) {
				args.push(...options.engineArgs);
			}

			// On Windows, pass prompt via stdin to avoid cmd.exe argument parsing issues with multi-line content
			let stdinContent: string | undefined;
			if (isWindows) {
				stdinContent = prompt;
			} else {
				args.push(prompt);
			}

			const { stdout, stderr, exitCode } = await execCommand(
				this.cliCommand,
				args,
				executionDir,
				undefined,
				stdinContent,
			);

			const output = stdout + stderr;

			// Read the last message from the file
			let response = "";
			if (existsSync(lastMessageFile)) {
				response = readFileSync(lastMessageFile, "utf-8");
				// Remove the "Task completed successfully." prefix if present
				response = response.replace(/^Task completed successfully\.\s*/i, "").trim();
				// Clean up the temp file
				try {
					unlinkSync(lastMessageFile);
				} catch {
					// Ignore cleanup errors
				}
			}

			// Check for errors in output
			const codexError = extractCodexError(output);
			if (codexError) {
				return {
					success: false,
					response: "",
					inputTokens: 0,
					outputTokens: 0,
					error: codexError,
				};
			}

			// If command failed with non-zero exit code, provide a meaningful error
			if (exitCode !== 0) {
				return {
					success: false,
					response: response || "Task completed",
					inputTokens: 0,
					outputTokens: 0,
					error: formatCommandError(exitCode, output),
				};
			}

			return {
				success: true,
				response: response || "Task completed",
				inputTokens: 0, // Codex doesn't expose token counts
				outputTokens: 0,
			};
		} finally {
			// Ensure cleanup
			if (existsSync(lastMessageFile)) {
				try {
					unlinkSync(lastMessageFile);
				} catch {
					// Ignore
				}
			}
		}
	}
}
