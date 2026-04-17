import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setVerbose } from "../ui/logger.ts";
import * as baseModule from "./base.ts";
import { CodexEngine } from "./codex.ts";

describe("CodexEngine", () => {
	let engine: CodexEngine;
	const testWorkDir = join(tmpdir(), "codex-test");
	const originalInvocation = process.env.RALPHY_INVOCATION;

	function readCodexDisplayLog(workDir: string): string {
		const logDir = join(workDir, ".ralphy", "logs");
		const logFiles = readdirSync(logDir).filter(
			(file) => file.startsWith("codex-") && file.endsWith(".log"),
		);

		expect(logFiles).toHaveLength(1);

		return readFileSync(join(logDir, logFiles[0]), "utf-8");
	}

	function writeLastMessageFile(args: string[], content: string): void {
		const lastMessageIndex = args.indexOf("--output-last-message");
		if (lastMessageIndex === -1 || !args[lastMessageIndex + 1]) {
			throw new Error("Missing --output-last-message argument");
		}

		writeFileSync(args[lastMessageIndex + 1], content, "utf-8");
	}

	beforeEach(() => {
		engine = new CodexEngine();
		process.env.RALPHY_INVOCATION =
			"D:\\D_Code_2\\ralph\\ralphy\\ralphy.ps1 --codex -v \"test prompt\" --no-commit";
		if (existsSync(testWorkDir)) {
			rmSync(testWorkDir, { recursive: true, force: true });
		}
		mkdirSync(testWorkDir, { recursive: true });
	});

	afterEach(() => {
		setVerbose(false);
		if (originalInvocation === undefined) {
			delete process.env.RALPHY_INVOCATION;
		} else {
			process.env.RALPHY_INVOCATION = originalInvocation;
		}
		if (existsSync(testWorkDir)) {
			rmSync(testWorkDir, { recursive: true, force: true });
		}
	});

	it("preserves multiline usage-limit errors from Codex JSON output", async () => {
		const usageLimitError = [
			"You've hit your usage limit. To get more access now, send a request to your admin or try again at 2:57 PM.",
			"You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Feb 23rd, 2026 9:01 PM.",
		].join("\n");

		const execSpy = spyOn(baseModule, "execCommandStreaming").mockImplementation(
			async (_cmd, _args, _cwd, onLine) => {
				onLine(
					JSON.stringify({
						type: "error",
						message: usageLimitError,
					}),
					"stdout",
				);

				return { exitCode: 1 };
			},
		);

		try {
			const result = await engine.execute("test prompt", testWorkDir);

			expect(result.success).toBe(false);
			expect(result.error).toBe(usageLimitError);
		} finally {
			execSpy.mockRestore();
		}
	});

	it("filters PowerShell profile ANSI noise from display logs while preserving reasoning and messages", async () => {
		setVerbose(true);

		const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
		const execSpy = spyOn(baseModule, "execCommandStreaming").mockImplementation(
			async (_cmd, args, _cwd, onLine) => {
				writeLastMessageFile(
					args,
					"Task completed successfully. Final answer stays intact.",
				);

				onLine(
					JSON.stringify({
						type: "item.updated",
						item: {
							type: "reasoning",
							text: "Inspecting shell startup noise before continuing.",
						},
					}),
					"stdout",
				);
				onLine(
					"\u001b[31;1mSet-PSReadLineOption: \u001b[0mC:\\Users\\test\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1:30\u001b[0m",
					"stderr",
				);
				onLine(
					"\u001b[31;1m  30 | \u001b[0m \u001b[36;1mSet-PSReadLineOption -PredictionSource HistoryAndPlugin\u001b[0m",
					"stderr",
				);
				onLine(
					"\u001b[31;1m     | \u001b[31;1mThe predictive suggestion feature cannot be enabled because the console output doesn't support virtual terminal processing or it's redirected.\u001b[0m",
					"stderr",
				);
				onLine(
					JSON.stringify({
						type: "item.completed",
						item: {
							type: "command_execution",
							command: "pwsh -NoLogo -Command Write-Error boom",
							exit_code: 1,
							status: "failed",
							aggregated_output:
								"\u001b[31;1mSet-PSReadLineOption: \u001b[0m...\n\u001b[31;1mTool error block\u001b[0m",
						},
					}),
					"stdout",
				);
				onLine(
					JSON.stringify({
						type: "item.completed",
						item: {
							type: "agent_message",
							text: "Retried with a clean shell and kept the summary concise.",
						},
					}),
					"stdout",
				);

				return { exitCode: 0 };
			},
		);

		try {
			const result = await engine.execute("test prompt", testWorkDir);
			const displayLog = readCodexDisplayLog(testWorkDir);
			const [invocationLine, ...bodyLines] = displayLog.split(/\r?\n/);
			const logBody = bodyLines.join("\n");
			const renderedStrings = consoleSpy.mock.calls
				.flat()
				.filter((arg): arg is string => typeof arg === "string");

			expect(result.success).toBe(true);
			expect(result.response).toBe("Final answer stays intact.");
			expect(invocationLine).toBe(process.env.RALPHY_INVOCATION);
			expect(logBody).toContain("Inspecting shell startup noise before continuing.");
			expect(logBody).toContain("Retried with a clean shell and kept the summary concise.");
			expect(logBody).not.toContain("\u001b[31;1m");
			expect(logBody).not.toContain("[31;1m");
			expect(logBody).not.toContain("Set-PSReadLineOption");
			expect(logBody).not.toContain("PredictionSource HistoryAndPlugin");
			expect(logBody).not.toContain("virtual terminal processing");
			expect(logBody).not.toContain("Write-Error boom");
			expect(logBody).not.toContain("[cmd:done]");
			expect(
				renderedStrings.some((arg) =>
					arg.includes("Inspecting shell startup noise before continuing."),
				),
			).toBe(true);
			expect(
				renderedStrings.some((arg) =>
					arg.includes("Retried with a clean shell and kept the summary concise."),
				),
			).toBe(true);
			expect(renderedStrings.some((arg) => arg.includes("Set-PSReadLineOption"))).toBe(false);
			expect(renderedStrings.some((arg) => arg.includes("[31;1m"))).toBe(false);
		} finally {
			execSpy.mockRestore();
			consoleSpy.mockRestore();
		}
	});

	it("drops failed command traces and aggregated tool error blocks from display logs", async () => {
		const execSpy = spyOn(baseModule, "execCommandStreaming").mockImplementation(
			async (_cmd, args, _cwd, onLine) => {
				writeLastMessageFile(args, "Task completed successfully. Continued after the tool failure.");

				onLine(
					JSON.stringify({
						type: "item.completed",
						item: {
							type: "command_execution",
							command: "python scripts/fail.py --flag",
							exit_code: 1,
							status: "failed",
							aggregated_output:
								"[stderr]\n\u001b[31;1mTool error block\u001b[0m\nTraceback: boom",
						},
					}),
					"stdout",
				);

				return { exitCode: 0 };
			},
		);

		try {
			const result = await engine.execute("test prompt", testWorkDir);
			const displayLog = readCodexDisplayLog(testWorkDir);
			const [, ...bodyLines] = displayLog.split(/\r?\n/);
			const logBody = bodyLines.join("\n");

			expect(result.success).toBe(true);
			expect(result.response).toBe("Continued after the tool failure.");
			expect(logBody).not.toContain("aggregated_output");
			expect(logBody).not.toContain("[stderr]");
			expect(logBody).not.toContain("Tool error block");
			expect(logBody).not.toContain("Traceback: boom");
			expect(logBody).not.toContain("[31;1m");
			expect(logBody).not.toContain("[cmd:done]");
			expect(logBody).not.toContain("python scripts/fail.py --flag");
		} finally {
			execSpy.mockRestore();
		}
	});
});
