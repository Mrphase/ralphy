import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as baseModule from "./base.ts";
import { CodexEngine } from "./codex.ts";

describe("CodexEngine", () => {
	let engine: CodexEngine;
	const testWorkDir = join(tmpdir(), "codex-test");

	beforeEach(() => {
		engine = new CodexEngine();
		mkdirSync(testWorkDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testWorkDir)) {
			rmSync(testWorkDir, { recursive: true, force: true });
		}
	});

	it("preserves multiline usage-limit errors from Codex JSON output", async () => {
		const usageLimitError = [
			"You've hit your usage limit. To get more access now, send a request to your admin or try again at 2:57 PM.",
			"You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Feb 23rd, 2026 9:01 PM.",
		].join("\n");

		const spy = spyOn(baseModule, "execCommand").mockResolvedValue({
			stdout: JSON.stringify({
				type: "error",
				message: usageLimitError,
			}),
			stderr: "",
			exitCode: 1,
		});

		const result = await engine.execute("test prompt", testWorkDir);

		expect(result.success).toBe(false);
		expect(result.error).toBe(usageLimitError);

		spy.mockRestore();
	});
});
