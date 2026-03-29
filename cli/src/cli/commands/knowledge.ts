import { rmSync } from "node:fs";
import pc from "picocolors";
import {
	getAgentsMdPath,
	getKnowledgeSummary,
	getProgressMdPath,
	initAgentsMd,
	initProgressMd,
} from "../../knowledge/manager.ts";
import { logInfo, logSuccess, logWarn } from "../../ui/logger.ts";

/**
 * Show current knowledge state
 */
export function runKnowledgeShow(workDir = process.cwd()): void {
	const summary = getKnowledgeSummary(workDir);
	console.log(summary);
	console.log("");
	console.log(pc.bold("Knowledge files:"));
	console.log(`  ${pc.cyan(getProgressMdPath(workDir))}`);
	console.log(`  ${pc.cyan(getAgentsMdPath(workDir))}`);
}

/**
 * Reset (clear) knowledge files
 */
export function runKnowledgeReset(workDir = process.cwd()): void {
	const progressPath = getProgressMdPath(workDir);
	const agentsPath = getAgentsMdPath(workDir);

	try {
		rmSync(progressPath, { force: true });
		logInfo(`Removed ${progressPath}`);
	} catch {
		logWarn(`Could not remove ${progressPath}`);
	}

	try {
		rmSync(agentsPath, { force: true });
		logInfo(`Removed ${agentsPath}`);
	} catch {
		logWarn(`Could not remove ${agentsPath}`);
	}

	// Re-create fresh files
	initProgressMd(workDir);
	initAgentsMd(workDir);

	logSuccess("Knowledge files reset to empty state.");
}
