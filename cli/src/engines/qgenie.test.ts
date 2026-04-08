import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setVerbose } from "../ui/logger.ts";
import * as baseModule from "./base.ts";
import { QGenieEngine } from "./qgenie.ts";

describe("QGenieEngine", () => {
	let engine: QGenieEngine;
	const testWorkDir = join(tmpdir(), "qgenie-test");

	beforeEach(() => {
		engine = new QGenieEngine();
		mkdirSync(testWorkDir, { recursive: true });
	});

	afterEach(() => {
		setVerbose(false);
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

	it("streams raw QGenie output in verbose mode", async () => {
		setVerbose(true);
		const onProgressCalls: string[] = [];
		const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
		const execSpy = spyOn(baseModule, "execCommandStreaming").mockImplementation(
			async (_cmd, _args, _cwd, onLine) => {
				onLine("Thinking...", "stdout");
				onLine("Applied the requested change", "stdout");
				return { exitCode: 0 };
			},
		);

		const result = await engine.executeStreaming?.("test", testWorkDir, (step) => {
			onProgressCalls.push(step);
		});

		expect(result?.success).toBe(true);
		expect(result?.response).toContain("Applied the requested change");
		expect(onProgressCalls).toContain("Thinking");
		expect(
			consoleSpy.mock.calls.some((call) =>
				call.some((arg) => typeof arg === "string" && arg.includes("Applied the requested change")),
			),
		).toBe(true);

		execSpy.mockRestore();
		consoleSpy.mockRestore();
	});
});
