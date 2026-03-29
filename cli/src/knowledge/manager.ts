import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { getRalphyDir } from "../config/loader.ts";
import {
	DEFAULT_KNOWLEDGE_OPTIONS,
	type KnowledgeContext,
	type KnowledgeOptions,
	type TaskLearning,
} from "./types.ts";

export const PROGRESS_MD_FILE = "progress.md";
export const AGENTS_MD_FILE = "AGENTS.md";

/**
 * Consolidate patterns every N iterations
 */
const CONSOLIDATE_EVERY = 5;

/**
 * Get the full path to progress.md
 */
export function getProgressMdPath(workDir = process.cwd()): string {
	return join(getRalphyDir(workDir), PROGRESS_MD_FILE);
}

/**
 * Get the full path to AGENTS.md
 */
export function getAgentsMdPath(workDir = process.cwd()): string {
	return join(getRalphyDir(workDir), AGENTS_MD_FILE);
}

/**
 * Create initial progress.md
 */
export function initProgressMd(workDir = process.cwd()): void {
	const path = getProgressMdPath(workDir);
	if (existsSync(path)) return;

	const content = `# Codebase Patterns (Auto-Updated Summary)

_No patterns recorded yet. Patterns will be consolidated after ${CONSOLIDATE_EVERY} iterations._

---

# Iteration Learnings

`;
	writeFileSync(path, content, "utf-8");
}

/**
 * Create initial AGENTS.md using detected project info
 */
export function initAgentsMd(
	workDir = process.cwd(),
	projectInfo?: {
		name?: string;
		language?: string;
		framework?: string;
		testCmd?: string;
		lintCmd?: string;
		buildCmd?: string;
	},
): void {
	const path = getAgentsMdPath(workDir);
	if (existsSync(path)) return;

	const name = projectInfo?.name || "";
	const language = projectInfo?.language || "";
	const framework = projectInfo?.framework || "";
	const testCmd = projectInfo?.testCmd || "";
	const lintCmd = projectInfo?.lintCmd || "";
	const buildCmd = projectInfo?.buildCmd || "";

	const overview = [
		name,
		language && `Language: ${language}`,
		framework && `Framework: ${framework}`,
	]
		.filter(Boolean)
		.join(" | ");

	const commandLines = [
		testCmd && `- Test: \`${testCmd}\``,
		lintCmd && `- Lint: \`${lintCmd}\``,
		buildCmd && `- Build: \`${buildCmd}\``,
	]
		.filter(Boolean)
		.join("\n");

	const content = `# Agent Instructions

## Project Overview

${overview || "_Fill in project overview here._"}

## Coding Conventions

_Document project-specific coding conventions here. For example:_
- _Follow existing patterns in the codebase_
- _Keep changes focused and minimal_

## Known Pitfalls

_Document known issues and gotchas discovered during development._

## Testing Notes

${commandLines || "_Document how to run tests and any test-specific requirements._"}

## Dependencies & Environment

_Document required environment variables, external dependencies, and setup notes._
`;

	writeFileSync(path, content, "utf-8");
}

/**
 * Read the knowledge context to inject into a prompt
 */
export function readKnowledgeContext(
	options: KnowledgeOptions,
	workDir = process.cwd(),
): KnowledgeContext {
	const mergedOptions = { ...DEFAULT_KNOWLEDGE_OPTIONS, ...options };

	if (!mergedOptions.enabled) {
		return { agentsContent: "", recentLearnings: "", patternsSection: "" };
	}

	const agentsPath = getAgentsMdPath(workDir);
	const progressPath = getProgressMdPath(workDir);

	const agentsContent = existsSync(agentsPath) ? readFileSync(agentsPath, "utf-8").trim() : "";

	let patternsSection = "";
	let recentLearnings = "";

	if (existsSync(progressPath)) {
		const raw = readFileSync(progressPath, "utf-8");
		const parts = raw.split(/^---$/m);

		// First section before the separator is the patterns block
		if (parts.length >= 1) {
			const patternBlock = parts[0].trim();
			// Only include if it has actual content beyond the placeholder
			if (!patternBlock.includes("No patterns recorded yet")) {
				patternsSection = patternBlock;
			}
		}

		// Extract the last N learning entries
		const learningsSection = parts.slice(1).join("---");
		const entries = learningsSection
			.split(/^## \[/m)
			.filter((e) => e.trim().length > 0)
			.map((e) => `## [${e.trim()}`);

		const recent = entries.slice(-mergedOptions.contextWindow);
		if (recent.length > 0) {
			recentLearnings = recent.join("\n\n");
		}
	}

	return { agentsContent, recentLearnings, patternsSection };
}

/**
 * Append a learning entry to progress.md
 */
export async function appendLearning(
	learning: TaskLearning,
	workDir = process.cwd(),
): Promise<void> {
	const path = getProgressMdPath(workDir);
	if (!existsSync(path)) return;

	const lines: string[] = [
		`\n## [${learning.timestamp}] Task: "${learning.task}"`,
		`- Engine: ${learning.engine}`,
		`- Status: ${learning.status}`,
	];

	if (learning.learnings.length > 0) {
		lines.push("- Learnings:");
		for (const l of learning.learnings) {
			lines.push(`  - ${l}`);
		}
	}

	if (learning.issuesEncountered.length > 0) {
		lines.push("- Issues Encountered:");
		for (const issue of learning.issuesEncountered) {
			lines.push(`  - ${issue}`);
		}
	}

	lines.push("");

	try {
		await appendFile(path, lines.join("\n"), "utf-8");
	} catch {
		// Ignore write errors
	}

	// Periodically consolidate patterns
	await maybeConsolidatePatterns(workDir);
}

/**
 * Extract a basic learning entry from task output and git diff
 */
export function extractLearning(
	task: string,
	engine: string,
	status: "completed" | "failed",
	errorMessage?: string,
): TaskLearning {
	const issuesEncountered: string[] = [];

	if (status === "failed" && errorMessage) {
		issuesEncountered.push(errorMessage.slice(0, 200));
	}

	return {
		timestamp: new Date().toISOString(),
		task,
		engine,
		status,
		learnings: [],
		issuesEncountered,
	};
}

/**
 * Count the number of learning entries in progress.md
 */
function countLearningEntries(workDir = process.cwd()): number {
	const path = getProgressMdPath(workDir);
	if (!existsSync(path)) return 0;

	const content = readFileSync(path, "utf-8");
	const matches = content.match(/^## \[/gm);
	return matches ? matches.length : 0;
}

function collectEntryLearnings(entry: string): string[] {
	const lines = entry.split("\n");
	const learnings: string[] = [];
	let inLearningsSection = false;

	for (const line of lines) {
		if (line.startsWith("- Learnings:")) {
			inLearningsSection = true;
			continue;
		}

		if (inLearningsSection && line.startsWith("- ")) {
			break;
		}

		if (inLearningsSection && line.startsWith("  - ")) {
			const learning = line.slice(4).trim();
			if (learning) {
				learnings.push(learning);
			}
		}
	}

	return learnings;
}

/**
 * Consolidate patterns every CONSOLIDATE_EVERY iterations
 */
async function maybeConsolidatePatterns(workDir = process.cwd()): Promise<void> {
	const count = countLearningEntries(workDir);
	if (count === 0 || count % CONSOLIDATE_EVERY !== 0) return;

	const path = getProgressMdPath(workDir);
	const raw = readFileSync(path, "utf-8");

	// Extract only `- Learnings:` bullets from each entry.
	const allLearnings: string[] = [];
	const entries = raw
		.split(/^## \[/m)
		.slice(1)
		.map((entry) => `## [${entry.trim()}`);

	for (const entry of entries) {
		for (const learning of collectEntryLearnings(entry)) {
			if (!allLearnings.includes(learning) && allLearnings.length < 20) {
				allLearnings.push(learning);
			}
		}
	}

	if (allLearnings.length === 0) return;

	const patternLines = allLearnings.map((l) => `- ${l}`).join("\n");
	const newPatternsSection = `# Codebase Patterns (Auto-Updated Summary)\n\n${patternLines}\n`;

	// Replace the section before the first "---" separator
	const separatorIndex = raw.indexOf("\n---\n");
	if (separatorIndex === -1) return;

	const afterSeparator = raw.slice(separatorIndex);
	const updated = `${newPatternsSection}${afterSeparator}`;

	try {
		writeFileSync(path, updated, "utf-8");
	} catch {
		// Ignore write errors
	}
}

/**
 * Format knowledge context as a prompt section
 */
export function formatKnowledgeForPrompt(
	context: KnowledgeContext,
	options: KnowledgeOptions = DEFAULT_KNOWLEDGE_OPTIONS,
): string {
	const mergedOptions = { ...DEFAULT_KNOWLEDGE_OPTIONS, ...options };
	const agentsSection = context.agentsContent
		? `## Agent Instructions\n${context.agentsContent}`
		: "";

	const joinSections = (patternsSection: string, recentLearnings: string): string =>
		[
			agentsSection,
			patternsSection && `## Known Codebase Patterns\n${patternsSection}`,
			recentLearnings && `## Recent Task Learnings\n${recentLearnings}`,
		]
			.filter(Boolean)
			.join("\n\n");

	let patternsSection = context.patternsSection;
	let recentLearnings = context.recentLearnings;
	let combined = joinSections(patternsSection, recentLearnings);

	if (combined.length <= mergedOptions.maxChars) {
		return combined;
	}

	if (recentLearnings) {
		const recentEntries = recentLearnings
			.split(/^## \[/m)
			.filter((entry) => entry.trim().length > 0)
			.map((entry) => `## [${entry.trim()}`);

		while (recentEntries.length > 0) {
			recentEntries.shift();
			recentLearnings = recentEntries.join("\n\n");
			combined = joinSections(patternsSection, recentLearnings);
			if (combined.length <= mergedOptions.maxChars) {
				return combined;
			}
		}
		recentLearnings = "";
	}

	if (patternsSection) {
		const patternLines = patternsSection.split("\n");
		while (patternLines.length > 0 && combined.length > mergedOptions.maxChars) {
			patternLines.pop();
			patternsSection = patternLines.join("\n").trimEnd();
			combined = joinSections(patternsSection, recentLearnings);
		}
	}

	return combined;
}

/**
 * Get a summary of current knowledge state (for `ralphy knowledge show`)
 */
export function getKnowledgeSummary(workDir = process.cwd()): string {
	const agentsPath = getAgentsMdPath(workDir);
	const progressPath = getProgressMdPath(workDir);

	const lines: string[] = ["## Knowledge State\n"];

	if (existsSync(agentsPath)) {
		const content = readFileSync(agentsPath, "utf-8");
		const lineCount = content.split("\n").length;
		lines.push(`**AGENTS.md**: ${lineCount} lines`);
	} else {
		lines.push("**AGENTS.md**: not found");
	}

	if (existsSync(progressPath)) {
		const count = countLearningEntries(workDir);
		lines.push(`**progress.md**: ${count} learning entries`);
	} else {
		lines.push("**progress.md**: not found");
	}

	return lines.join("\n");
}
