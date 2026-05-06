import { describe, expect, it } from "bun:test";
import { createProgram, parseArgs } from "./args.ts";

describe("parseArgs", () => {
	it("enables usage-limit auto-resume by default", () => {
		const result = parseArgs(["node", "ralphy", "--codex", "fix auth bug"]);

		expect(result.options.usageLimitResume).toBe(true);
		expect(result.options.usageLimitWaitHours).toBe(5.5);
	});

	it("parses custom usage-limit wait hours", () => {
		const result = parseArgs([
			"node",
			"ralphy",
			"--codex",
			"--usage-limit-wait-hours",
			"6.25",
			"fix auth bug",
		]);

		expect(result.options.usageLimitWaitHours).toBe(6.25);
	});

	it("allows disabling usage-limit auto-resume", () => {
		const result = parseArgs([
			"node",
			"ralphy",
			"--codex",
			"--no-usage-limit-resume",
			"fix auth bug",
		]);

		expect(result.options.usageLimitResume).toBe(false);
	});

	it("parses session-level reasoning effort", () => {
		const result = parseArgs([
			"node",
			"ralphy",
			"--qgenie",
			"--effort",
			"xhigh",
			"implement feature",
		]);

		expect(result.options.reasoningEffort).toBe("xhigh");
	});

	it("parses knowledge show without treating it as a task", () => {
		const result = parseArgs(["node", "ralphy", "knowledge", "show"]);

		expect(result.knowledgeCommand).toBe("show");
		expect(result.task).toBeUndefined();
	});

	it("defaults bare knowledge command to show", () => {
		const result = parseArgs(["node", "ralphy", "knowledge"]);

		expect(result.knowledgeCommand).toBe("show");
		expect(result.task).toBeUndefined();
	});

	it("parses knowledge reset without treating it as a task", () => {
		const result = parseArgs(["node", "ralphy", "knowledge", "reset"]);

		expect(result.knowledgeCommand).toBe("reset");
		expect(result.task).toBeUndefined();
	});

	it("keeps normal single-task mode unchanged", () => {
		const result = parseArgs(["node", "ralphy", "fix auth bug"]);

		expect(result.knowledgeCommand).toBeUndefined();
		expect(result.task).toBe("fix auth bug");
	});

	it("documents yaml task files separately in help output", () => {
		const helpText = createProgram().helpInformation();

		expect(helpText).toContain("Markdown PRD file or folder (use --yaml for .yaml/.yml)");
		expect(helpText).toContain("YAML task file (.yaml or .yml)");
	});

	it("parses bare --goal as goalMode without description", () => {
		const result = parseArgs([
			"node",
			"ralphy",
			"--codex",
			"--goal",
			"fix auth bug",
		]);

		expect(result.options.goalMode).toBe(true);
		expect(result.options.goalDescription).toBeUndefined();
		expect(result.task).toBe("fix auth bug");
	});

	it("parses --goal=<text> with a description", () => {
		const result = parseArgs([
			"node",
			"ralphy",
			"--codex",
			"--goal=ship v2 with green tests",
			"fix auth bug",
		]);

		expect(result.options.goalMode).toBe(true);
		expect(result.options.goalDescription).toBe("ship v2 with green tests");
		expect(result.task).toBe("fix auth bug");
	});

	it("does not enable goalMode when --goal is absent", () => {
		const result = parseArgs(["node", "ralphy", "--codex", "fix auth bug"]);

		expect(result.options.goalMode).toBe(false);
		expect(result.options.goalDescription).toBeUndefined();
	});

	it("documents --goal in help output", () => {
		const helpText = createProgram().helpInformation();
		expect(helpText).toContain("--goal");
		expect(helpText).toContain("/goal");
	});
});
