import { describe, expect, it } from "bun:test";
import { parseArgs } from "./args.ts";

describe("parseArgs", () => {
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
});
