import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	appendLearning,
	consolidateIfNeeded,
	formatKnowledgeForPrompt,
	getAgentsMdPath,
	getProgressMdPath,
	initAgentsMd,
	initProgressMd,
	readKnowledgeContext,
} from "../manager.ts";

describe("knowledge manager", () => {
	let workDir: string;

	beforeEach(() => {
		workDir = join(tmpdir(), `knowledge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(join(workDir, ".ralphy"), { recursive: true });
	});

	afterEach(() => {
		rmSync(workDir, { recursive: true, force: true });
	});

	describe("initProgressMd", () => {
		it("creates progress.md when it does not exist", () => {
			initProgressMd(workDir);

			const progressPath = getProgressMdPath(workDir);
			expect(existsSync(progressPath)).toBe(true);
			expect(readFileSync(progressPath, "utf-8")).toContain("# Iteration Learnings");
		});

		it("does not overwrite an existing progress.md", () => {
			const progressPath = getProgressMdPath(workDir);
			writeFileSync(progressPath, "custom progress", "utf-8");

			initProgressMd(workDir);

			expect(readFileSync(progressPath, "utf-8")).toBe("custom progress");
		});
	});

	describe("initAgentsMd", () => {
		it("creates AGENTS.md with detected project info", () => {
			initAgentsMd(workDir, {
				name: "ralphy",
				language: "TypeScript",
				framework: "Commander",
				testCmd: "bun test",
				lintCmd: "bun run check",
			});

			const content = readFileSync(getAgentsMdPath(workDir), "utf-8");
			expect(content).toContain("ralphy");
			expect(content).toContain("Language: TypeScript");
			expect(content).toContain("Framework: Commander");
			expect(content).toContain("`bun test`");
		});

		it("creates AGENTS.md placeholders when project info is missing", () => {
			initAgentsMd(workDir);

			const content = readFileSync(getAgentsMdPath(workDir), "utf-8");
			expect(content).toContain("_Fill in project overview here._");
			expect(content).toContain("_Document how to run tests");
		});
	});

	describe("readKnowledgeContext", () => {
		it("returns empty sections when knowledge files are empty or absent", () => {
			const context = readKnowledgeContext({ enabled: true, contextWindow: 10 }, workDir);

			expect(context.agentsContent).toBe("");
			expect(context.patternsSection).toBe("");
			expect(context.recentLearnings).toBe("");
		});

		it("reads patterns and limits recent learnings to the context window", () => {
			writeFileSync(
				getAgentsMdPath(workDir),
				"# Agent Instructions\n\n## Project Overview\n\nTest project\n",
				"utf-8",
			);
			writeFileSync(
				getProgressMdPath(workDir),
				[
					"# Codebase Patterns (Auto-Updated Summary)",
					"",
					"- Pattern A",
					"- Pattern B",
					"",
					"---",
					"",
					"# Iteration Learnings",
					"",
					'## [2026-03-29T00:00:00Z] Task: "One"',
					"- Learnings:",
					"  - Learned one",
					"",
					'## [2026-03-29T00:01:00Z] Task: "Two"',
					"- Learnings:",
					"  - Learned two",
					"",
					'## [2026-03-29T00:02:00Z] Task: "Three"',
					"- Learnings:",
					"  - Learned three",
					"",
				].join("\n"),
				"utf-8",
			);

			const context = readKnowledgeContext({ enabled: true, contextWindow: 2 }, workDir);

			expect(context.agentsContent).toContain("Test project");
			expect(context.patternsSection).toContain("- Pattern A");
			expect(context.recentLearnings).not.toContain('Task: "One"');
			expect(context.recentLearnings).toContain('Task: "Two"');
			expect(context.recentLearnings).toContain('Task: "Three"');
		});

		it("does not treat the iteration heading as a learning entry", () => {
			writeFileSync(
				getProgressMdPath(workDir),
				[
					"# Codebase Patterns (Auto-Updated Summary)",
					"",
					"_No patterns recorded yet. Patterns will be consolidated after 5 iterations._",
					"",
					"---",
					"",
					"# Iteration Learnings",
					"",
					'## [2026-03-29T00:00:00Z] Task: "One"',
					"- Learnings:",
					"  - Learned one",
					"",
				].join("\n"),
				"utf-8",
			);

			const context = readKnowledgeContext({ enabled: true, contextWindow: 10 }, workDir);

			expect(context.recentLearnings).toContain('Task: "One"');
			expect(context.recentLearnings).not.toContain("## [# Iteration Learnings");
		});
	});

	describe("appendLearning consolidation", () => {
		it("consolidates only Learnings items after every five entries", async () => {
			initProgressMd(workDir);

			for (let index = 1; index <= 5; index++) {
				await appendLearning(
					{
						timestamp: `2026-03-29T00:0${index}:00Z`,
						task: `Task ${index}`,
						engine: "Claude",
						status: "completed",
						learnings: [`Pattern ${index}`],
						issuesEncountered: [`Ignored issue ${index}`],
					},
					workDir,
				);
			}
			consolidateIfNeeded(workDir);

			const content = readFileSync(getProgressMdPath(workDir), "utf-8");
			const summarySection = content.split("\n---\n")[0];
			expect(summarySection).toContain("- Pattern 1");
			expect(summarySection).toContain("- Pattern 5");
			expect(summarySection).not.toContain("- Ignored issue 1");
			expect(content).toContain("# Iteration Learnings");
		});

		it("can consolidate lazily when knowledge context is read", () => {
			writeFileSync(
				getProgressMdPath(workDir),
				[
					"# Codebase Patterns (Auto-Updated Summary)",
					"",
					"_No patterns recorded yet. Patterns will be consolidated after 5 iterations._",
					"",
					"---",
					"",
					"# Iteration Learnings",
					"",
					'## [2026-03-29T00:01:00Z] Task: "Task 1"',
					"- Learnings:",
					"  - Pattern 1",
					"- Issues Encountered:",
					"  - Ignored issue 1",
					"",
					'## [2026-03-29T00:02:00Z] Task: "Task 2"',
					"- Learnings:",
					"  - Pattern 2",
					"",
					'## [2026-03-29T00:03:00Z] Task: "Task 3"',
					"- Learnings:",
					"  - Pattern 3",
					"",
					'## [2026-03-29T00:04:00Z] Task: "Task 4"',
					"- Learnings:",
					"  - Pattern 4",
					"",
					'## [2026-03-29T00:05:00Z] Task: "Task 5"',
					"- Learnings:",
					"  - Pattern 5",
					"",
				].join("\n"),
				"utf-8",
			);

			const context = readKnowledgeContext({ enabled: true, contextWindow: 2 }, workDir);

			expect(context.patternsSection).toContain("- Pattern 1");
			expect(context.patternsSection).not.toContain("- Ignored issue 1");
		});

		it("consolidates flat learning bullets produced by real agent runs", () => {
			writeFileSync(
				getProgressMdPath(workDir),
				[
					"# Codebase Patterns (Auto-Updated Summary)",
					"",
					"_No patterns recorded yet. Patterns will be consolidated after 5 iterations._",
					"",
					"---",
					"",
					"# Iteration Learnings",
					"",
					'## [2026-03-29T00:01:00Z] Task: "Task 1"',
					"- Learnings:",
					"- Pattern 1",
					"- Issues Encountered:",
					"- Ignored issue 1",
					"",
					'## [2026-03-29T00:02:00Z] Task: "Task 2"',
					"- Learnings:",
					"- Pattern 2",
					"",
					'## [2026-03-29T00:03:00Z] Task: "Task 3"',
					"- Learnings:",
					"- Pattern 3",
					"",
					'## [2026-03-29T00:04:00Z] Task: "Task 4"',
					"- Learnings:",
					"- Pattern 4",
					"",
					'## [2026-03-29T00:05:00Z] Task: "Task 5"',
					"- Learnings:",
					"- Pattern 5",
					"",
				].join("\n"),
				"utf-8",
			);

			const context = readKnowledgeContext({ enabled: true, contextWindow: 2 }, workDir);

			expect(context.patternsSection).toContain("- Pattern 1");
			expect(context.patternsSection).toContain("- Pattern 5");
			expect(context.patternsSection).not.toContain("- Ignored issue 1");
		});
	});

	describe("formatKnowledgeForPrompt", () => {
		it("formats only agents content", () => {
			const result = formatKnowledgeForPrompt({
				agentsContent: "# Agent Instructions",
				patternsSection: "",
				recentLearnings: "",
			});

			expect(result).toContain("## Agent Instructions");
			expect(result).not.toContain("## Known Codebase Patterns");
		});

		it("formats only patterns content", () => {
			const result = formatKnowledgeForPrompt({
				agentsContent: "",
				patternsSection: "# Codebase Patterns\n- Pattern A",
				recentLearnings: "",
			});

			expect(result).toContain("## Known Codebase Patterns");
			expect(result).toContain("Pattern A");
		});

		it("formats all sections together", () => {
			const result = formatKnowledgeForPrompt({
				agentsContent: "# Agent Instructions",
				patternsSection: "# Codebase Patterns\n- Pattern A",
				recentLearnings: '## [2026-03-29T00:00:00Z] Task: "One"\n- Learnings:\n  - Learned one',
			});

			expect(result).toContain("## Agent Instructions");
			expect(result).toContain("## Known Codebase Patterns");
			expect(result).toContain("## Recent Task Learnings");
		});

		it("returns an empty string when all sections are empty", () => {
			const result = formatKnowledgeForPrompt({
				agentsContent: "",
				patternsSection: "",
				recentLearnings: "",
			});

			expect(result).toBe("");
		});
	});
});
