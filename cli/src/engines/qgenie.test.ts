import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setVerbose } from "../ui/logger.ts";
import * as baseModule from "./base.ts";
import { QGenieEngine } from "./qgenie.ts";

describe("QGenieEngine", () => {
	let engine: QGenieEngine;
	const testWorkDir = join(tmpdir(), "qgenie-test");
	const ansiEscapePattern = /\u001b\[[0-9;]*m/g;
	const originalInvocation = process.env.RALPHY_INVOCATION;
	const noisyQGenieStderr = [
		"\u001b[90mQGenie CLI v1.2.3\u001b[0m",
		"> qgenie agent exec --full-auto -C D:\\repo --skip-git-repo-check --model azure::gpt-5.4",
		"Thinking through the failing tests...",
		"Applied the requested change",
	].join("\n");

	function getQGenieVerboseLines(consoleSpy: { mock: { calls: unknown[][] } }): string[] {
		return consoleSpy.mock.calls
			.filter((call) => typeof call[0] === "string" && call[0].includes("QGenie"))
			.flatMap((call) => call.slice(1))
			.filter((arg): arg is string => typeof arg === "string");
	}

	function readQGenieDisplayLog(workDir: string): { fileName: string; content: string } {
		const logDir = join(workDir, ".ralphy", "logs");
		const logFiles = readdirSync(logDir).filter((file) => file.endsWith(".log"));

		expect(logFiles).toHaveLength(1);

		return {
			fileName: logFiles[0],
			content: readFileSync(join(logDir, logFiles[0]), "utf-8"),
		};
	}

	beforeEach(() => {
		engine = new QGenieEngine();
		process.env.RALPHY_INVOCATION =
			"D:\\D_Code_2\\ralph\\ralphy\\ralphy.ps1 --qgenie -v --no-commit";
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

	it("uses the default model and reasoning effort when no overrides are specified", async () => {
		let capturedArgs: string[] = [];

		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_cmd: string, args: string[]) => {
				capturedArgs = args;
				return {
					stdout: "Task completed",
					stderr: "",
					exitCode: 0,
				};
			},
		);

		await engine.execute("test", testWorkDir);

		expect(capturedArgs).toContain("--model");
		const modelIndex = capturedArgs.indexOf("--model");
		expect(capturedArgs[modelIndex + 1]).toBe("azure::gpt-5.4");
		expect(capturedArgs).toContain("-c");
		const configIndex = capturedArgs.indexOf("-c");
		expect(capturedArgs[configIndex + 1]).toBe('model_reasoning_effort="xhigh"');

		spy.mockRestore();
	});

	it("allows overriding the default model and reasoning effort", async () => {
		let capturedArgs: string[] = [];

		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_cmd: string, args: string[]) => {
				capturedArgs = args;
				return {
					stdout: "Task completed",
					stderr: "",
					exitCode: 0,
				};
			},
		);

		await engine.execute("test", testWorkDir, {
			modelOverride: "azure::gpt-5.4",
			reasoningEffort: "xhigh",
		});

		expect(capturedArgs).toContain("--model");
		expect(capturedArgs).toContain("-c");
		const configIndex = capturedArgs.indexOf("-c");
		expect(capturedArgs[configIndex + 1]).toBe('model_reasoning_effort="xhigh"');

		spy.mockRestore();
	});

	it("does not inject effort config when engine args already override it", async () => {
		let capturedArgs: string[] = [];

		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_cmd: string, args: string[]) => {
				capturedArgs = args;
				return {
					stdout: "Task completed",
					stderr: "",
					exitCode: 0,
				};
			},
		);

		await engine.execute("test", testWorkDir, {
			reasoningEffort: "xhigh",
			engineArgs: ["-c", 'model_reasoning_effort="low"'],
		});

		expect(capturedArgs.filter((arg) => arg === "-c")).toHaveLength(1);
		const configIndex = capturedArgs.indexOf("-c");
		expect(capturedArgs[configIndex + 1]).toBe('model_reasoning_effort="low"');

		spy.mockRestore();
	});

	it("filters stderr down to concise thinking and message lines", async () => {
		setVerbose(true);
		const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
		const execSpy = spyOn(baseModule, "execCommand").mockResolvedValue({
			stdout: "",
			stderr: noisyQGenieStderr,
			exitCode: 0,
		});

		const result = await engine.execute("test", testWorkDir);
		const responseLines = result.response.split("\n").filter(Boolean);
		const verboseLines = getQGenieVerboseLines(consoleSpy);
		const verboseOutput = verboseLines.join("\n");

		expect(result.success).toBe(true);
		expect(responseLines).toHaveLength(2);
		expect(responseLines).toEqual(
			expect.arrayContaining([
				expect.stringContaining("Thinking through the failing tests"),
				expect.stringContaining("Applied the requested change"),
			]),
		);
		expect(result.response).not.toContain("QGenie CLI v1.2.3");
		expect(result.response).not.toContain("qgenie agent exec --full-auto");
		expect(result.response).not.toMatch(ansiEscapePattern);

		expect(verboseLines).toHaveLength(2);
		expect(verboseLines).toEqual(
			expect.arrayContaining([
				expect.stringContaining("Thinking through the failing tests"),
				expect.stringContaining("Applied the requested change"),
			]),
		);
		expect(verboseOutput).not.toContain("QGenie CLI v1.2.3");
		expect(verboseOutput).not.toContain("qgenie agent exec --full-auto");
		expect(verboseOutput).not.toMatch(ansiEscapePattern);

		execSpy.mockRestore();
		consoleSpy.mockRestore();
	});

	it("streams filtered QGenie stderr in verbose mode", async () => {
		setVerbose(true);
		const onProgressCalls: string[] = [];
		const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
		const execSpy = spyOn(baseModule, "execCommandStreaming").mockImplementation(
			async (_cmd, _args, _cwd, onLine) => {
				for (const line of noisyQGenieStderr.split("\n")) {
					onLine(line, "stderr");
				}
				return { exitCode: 0 };
			},
		);

		const result = await engine.executeStreaming?.("test", testWorkDir, (step) => {
			onProgressCalls.push(step);
		});
		const responseLines = result?.response.split("\n").filter(Boolean) || [];
		const verboseLines = getQGenieVerboseLines(consoleSpy);
		const verboseOutput = verboseLines.join("\n");

		expect(result?.success).toBe(true);
		expect(responseLines).toHaveLength(2);
		expect(responseLines).toEqual(
			expect.arrayContaining([
				expect.stringContaining("Thinking through the failing tests"),
				expect.stringContaining("Applied the requested change"),
			]),
		);
		expect(result?.response).not.toContain("QGenie CLI v1.2.3");
		expect(result?.response).not.toContain("qgenie agent exec --full-auto");
		expect(result?.response).not.toMatch(ansiEscapePattern);
		expect(onProgressCalls).toContain("Thinking");
		expect(verboseLines).toHaveLength(2);
		expect(verboseLines).toEqual(
			expect.arrayContaining([
				expect.stringContaining("Thinking through the failing tests"),
				expect.stringContaining("Applied the requested change"),
			]),
		);
		expect(verboseOutput).not.toContain("QGenie CLI v1.2.3");
		expect(verboseOutput).not.toContain("qgenie agent exec --full-auto");
		expect(verboseOutput).not.toMatch(ansiEscapePattern);

		execSpy.mockRestore();
		consoleSpy.mockRestore();
	});

	it("writes a clean session log with a model-prefixed filename and invocation header", async () => {
		const invocation =
			"D:\\D_Code_2\\ralph\\ralphy\\ralphy.ps1 --qgenie --model anthropic::claude-4-6-opus:1M -v --yaml .\\PRD-log-monitor-tuning.yaml --no-commit";
		process.env.RALPHY_INVOCATION = invocation;

		const execSpy = spyOn(baseModule, "execCommand").mockResolvedValue({
			stdout: [
				JSON.stringify({
					type: "item.updated",
					item: {
						type: "reasoning",
						text: "Thinking through the failing tests...",
					},
				}),
				JSON.stringify({
					type: "item.completed",
					item: {
						type: "agent_message",
						text: "Applied the requested change",
					},
				}),
			].join("\n"),
			stderr: [
				"\u001b[90mQGenie CLI v1.2.3\u001b[0m",
				"> qgenie agent exec --full-auto -C D:\\repo",
			].join("\n"),
			exitCode: 0,
		});

		try {
			const result = await engine.execute("test", testWorkDir, {
				modelOverride: "anthropic::claude-4-6-opus:1M",
			});
			const { fileName, content } = readQGenieDisplayLog(testWorkDir);
			const [invocationLine, ...bodyLines] = content.split(/\r?\n/);
			const logBody = bodyLines.join("\n");

			expect(result.success).toBe(true);
			expect(fileName.startsWith("anthropic-claude-4-6-opus-1M-")).toBe(true);
			expect(invocationLine).toBe(invocation);
			expect(logBody).toContain("Thinking through the failing tests");
			expect(logBody).toContain("Applied the requested change");
			expect(logBody).not.toContain("QGenie CLI v1.2.3");
			expect(logBody).not.toContain("qgenie agent exec --full-auto");
			expect(logBody).not.toMatch(ansiEscapePattern);
		} finally {
			execSpy.mockRestore();
		}
	});
});
