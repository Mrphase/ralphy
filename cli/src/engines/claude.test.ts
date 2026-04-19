import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setVerbose } from "../ui/logger.ts";
import * as baseModule from "./base.ts";
import { ClaudeEngine } from "./claude.ts";

describe("ClaudeEngine", () => {
	let engine: ClaudeEngine;
	const testWorkDir = join(tmpdir(), "claude-test");

	beforeEach(() => {
		engine = new ClaudeEngine();
		mkdirSync(testWorkDir, { recursive: true });
	});

	afterEach(() => {
		setVerbose(false);
		if (existsSync(testWorkDir)) {
			rmSync(testWorkDir, { recursive: true, force: true });
		}
	});

	it("uses claude-opus-4-7[1m] as the default Claude model", async () => {
		let capturedArgs: string[] = [];

		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_cmd: string, args: string[]) => {
				capturedArgs = args;
				return {
					stdout: JSON.stringify({
						type: "result",
						result: "Task completed",
						usage: { input_tokens: 1, output_tokens: 1 },
					}),
					stderr: "",
					exitCode: 0,
				};
			},
		);

		try {
			const result = await engine.execute("test", testWorkDir);

			expect(result.success).toBe(true);
			expect(capturedArgs).toContain("--model");
			expect(capturedArgs[capturedArgs.indexOf("--model") + 1]).toBe("claude-opus-4-7[1m]");
		} finally {
			spy.mockRestore();
		}
	});

	it("falls back to the next Claude model when the initial model fails before producing a response", async () => {
		const capturedModels: string[] = [];

		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_cmd: string, args: string[]) => {
				capturedModels.push(args[args.indexOf("--model") + 1]);

				if (capturedModels.length === 1) {
					return {
						stdout: "",
						stderr: JSON.stringify({ type: "error", error: { message: "model unavailable" } }),
						exitCode: 1,
					};
				}

				return {
					stdout: JSON.stringify({
						type: "result",
						result: "Fallback model answered",
						usage: { input_tokens: 7, output_tokens: 3 },
					}),
					stderr: "",
					exitCode: 0,
				};
			},
		);

		try {
			const result = await engine.execute("test", testWorkDir);

			expect(result.success).toBe(true);
			expect(result.response).toBe("Fallback model answered");
			expect(capturedModels).toEqual(["claude-opus-4-7[1m]", "claude-opus-4-7"]);
		} finally {
			spy.mockRestore();
		}
	});

	it("does not fallback on authentication errors", async () => {
		const capturedModels: string[] = [];

		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_cmd: string, args: string[]) => {
				capturedModels.push(args[args.indexOf("--model") + 1]);
				return {
					stdout: "",
					stderr: JSON.stringify({ type: "error", error: { message: "Invalid API key" } }),
					exitCode: 1,
				};
			},
		);

		try {
			const result = await engine.execute("test", testWorkDir);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Invalid API key");
			expect(capturedModels).toEqual(["claude-opus-4-7[1m]"]);
		} finally {
			spy.mockRestore();
		}
	});

	it("falls back during streaming execution", async () => {
		const capturedModels: string[] = [];
		const onProgressCalls: string[] = [];

		const spy = spyOn(baseModule, "execCommandStreaming").mockImplementation(
			async (_cmd, args, _cwd, onLine) => {
				capturedModels.push(args[args.indexOf("--model") + 1]);

				if (capturedModels.length === 1) {
					onLine(
						JSON.stringify({ type: "error", error: { message: "rate limit exceeded" } }),
						"stderr",
					);
					return { exitCode: 1 };
				}

				onLine(
					JSON.stringify({
						type: "assistant",
						message: { content: [{ type: "text", text: "Thinking through fallback..." }] },
					}),
					"stdout",
				);
				onLine(
					JSON.stringify({
						type: "result",
						result: "Streaming fallback model answered",
						usage: { input_tokens: 5, output_tokens: 2 },
					}),
					"stdout",
				);
				return { exitCode: 0 };
			},
		);

		try {
			const result = await engine.executeStreaming?.("test", testWorkDir, (step) => {
				onProgressCalls.push(step);
			});

			expect(result?.success).toBe(true);
			expect(result?.response).toBe("Streaming fallback model answered");
			expect(onProgressCalls).toContain("Switching model");
			expect(capturedModels).toEqual(["claude-opus-4-7[1m]", "claude-opus-4-7"]);
		} finally {
			spy.mockRestore();
		}
	});
});
