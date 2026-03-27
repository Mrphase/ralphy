import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { logDebug, logSuccess, logWarn } from "../ui/logger.ts";

const isBun = typeof Bun !== "undefined";
const isWindows = process.platform === "win32";

async function runGhCommand(
	args: string[],
	workDir = process.cwd(),
): Promise<{ exitCode: number; stderr: string }> {
	if (isBun) {
		try {
			const proc = Bun.spawn(["gh", ...args], {
				cwd: workDir,
				stdout: "pipe",
				stderr: "pipe",
			});
			const [exitCode, stderr] = await Promise.all([
				proc.exited,
				new Response(proc.stderr).text(),
			]);
			return { exitCode, stderr };
		} catch (error) {
			return {
				exitCode: 1,
				stderr: error instanceof Error ? error.message : String(error),
			};
		}
	}

	return new Promise((resolve) => {
		const proc = spawn("gh", args, {
			cwd: workDir,
			stdio: ["ignore", "pipe", "pipe"],
			shell: isWindows,
		});

		let stderr = "";

		proc.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (exitCode) => {
			resolve({ exitCode: exitCode ?? 1, stderr });
		});

		proc.on("error", (error) => {
			resolve({
				exitCode: 1,
				stderr: error.message,
			});
		});
	});
}

/**
 * Check if gh CLI is available and authenticated
 */
async function isGhAvailable(): Promise<boolean> {
	const { exitCode } = await runGhCommand(["auth", "status"]);
	return exitCode === 0;
}

/**
 * Sync PRD file content to a GitHub issue body.
 * This allows tracking task progress in a GitHub issue as documentation.
 *
 * @param prdFile - Path to the PRD file (relative or absolute)
 * @param issueNumber - GitHub issue number to sync to
 * @param workDir - Working directory for resolving relative paths
 * @returns true if sync succeeded, false otherwise
 */
export async function syncPrdToIssue(
	prdFile: string,
	issueNumber: number,
	workDir: string,
): Promise<boolean> {
	// Check if gh CLI is available
	const ghAvailable = await isGhAvailable();
	if (!ghAvailable) {
		logWarn("Cannot sync: gh CLI not installed or not authenticated");
		return false;
	}

	// Read PRD file content
	const prdPath = isAbsolute(prdFile) ? prdFile : join(workDir, prdFile);
	let prdContent: string;

	try {
		prdContent = readFileSync(prdPath, "utf-8");
	} catch {
		logWarn(`Cannot sync: ${prdFile} not found`);
		return false;
	}

	// Update issue body using gh CLI
	logDebug(`Syncing ${prdFile} to issue #${issueNumber}`);

	const { exitCode, stderr } = await runGhCommand(
		["issue", "edit", String(issueNumber), "--body", prdContent],
		workDir,
	);

	if (exitCode === 0) {
		logSuccess(`Synced PRD -> GitHub issue #${issueNumber}`);
		return true;
	}

	const message = stderr.trim() || `gh exited with code ${exitCode}`;
	logWarn(`Failed to sync PRD to issue #${issueNumber}: ${message}`);
	return false;
}

