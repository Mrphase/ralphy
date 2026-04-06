import { tmpdir } from "node:os";
import { logDebug } from "../ui/logger.ts";
import { BaseAIEngine, checkForErrors, execCommand, formatCommandError } from "./base.ts";
import type { AIResult, EngineOptions } from "./types.ts";

/**
 * QGenie CLI AI Engine
 *
 * CLI invocation: `qgenie agent`
 * Model format: azure::gpt-5.4 high (use /model to change interactively)
 *
 * Note: executeStreaming is intentionally not implemented for QGenie
 * because we don't yet know its streaming output format.
 */
export class QGenieEngine extends BaseAIEngine {
	name = "QGenie";
	cliCommand = "qgenie";

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
	private buildArgs(workDir: string, options?: EngineOptions): { args: string[] } {
		const args: string[] = [];

		// Subcommand: agent exec (non-interactive)
		args.push("agent");
		args.push("exec");
		args.push("--full-auto");

		args.push("-C", workDir);
		args.push("--skip-git-repo-check");

		if (options?.modelOverride) {
			args.push("--model", options.modelOverride);
		}
		if (options?.engineArgs && options.engineArgs.length > 0) {
			args.push(...options.engineArgs);
		}
		return { args };
	}

	async execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult> {
		const executionDir = this.getExecutionDirectory(workDir);
		const { args } = this.buildArgs(workDir, options);

		logDebug(`[QGenie] Working directory: ${workDir}`);
		logDebug(`[QGenie] Execution directory: ${executionDir}`);
		logDebug(`[QGenie] Prompt length: ${prompt.length} chars`);
		logDebug(`[QGenie] Command: ${this.cliCommand} ${args.join(" ")}`);

		const startTime = Date.now();
		const { stdout, stderr, exitCode } = await execCommand(
			this.cliCommand,
			args,
			executionDir,
			undefined,
			prompt,
		);
		const durationMs = Date.now() - startTime;

		const output = stdout + stderr;

		logDebug(`[QGenie] Exit code: ${exitCode}`);
		logDebug(`[QGenie] Duration: ${durationMs}ms`);
		logDebug(`[QGenie] Output length: ${output.length} chars`);
		logDebug(`[QGenie] Output preview: ${output.substring(0, 500)}...`);

		// Check for JSON errors (from base)
		const jsonError = checkForErrors(output);
		if (jsonError) {
			return {
				success: false,
				response: "",
				inputTokens: 0,
				outputTokens: 0,
				error: jsonError,
			};
		}

		// Check for QGenie-specific errors
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

		// Parse output
		const { response, inputTokens, outputTokens } = this.parseOutput(output);

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

		const lines = output.split("\n").filter(Boolean);

		const meaningfulLines = lines.filter((line) => {
			const trimmed = line.trim();
			return (
				trimmed &&
				!trimmed.startsWith("?") &&
				!trimmed.startsWith("❯") &&
				!trimmed.includes("Thinking...") &&
				!trimmed.includes("Working on it...") &&
				!trimmed.startsWith("Total usage") &&
				!trimmed.startsWith("API time") &&
				!trimmed.startsWith("Total session") &&
				!trimmed.startsWith("Total code") &&
				!trimmed.startsWith("Breakdown by") &&
				!trimmed.match(
					/^\s*\S+\s+\d+(?:\.\d+)?[km]?\s+in,\s+\d+(?:\.\d+)?[km]?\s+out,\s+\d+(?:\.\d+)?[km]?\s+cached/,
				)
			);
		});

		const response = meaningfulLines.join("\n").trim() || "Task completed";
		return { response, inputTokens, outputTokens };
	}
}
