import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execCommand } from "../engines/base.ts";
import { logDebug, logError } from "../ui/logger.ts";

/**
 * Objective direction for the evaluation metric
 */
export type MetricObjective = "minimize" | "maximize" | "pass-fail";

/**
 * Configuration for the evaluation harness
 */
export interface EvaluateConfig {
	/** Shell command to run as the evaluation script */
	script: string;
	/** JSON key to extract from script output (default: "score") */
	metricKey?: string;
	/** Optimization direction */
	objective: MetricObjective;
}

/**
 * Result from running the evaluation script
 */
export interface EvaluateResult {
	/** Whether the evaluation script ran successfully (exit code 0) */
	success: boolean;
	/** Numeric score extracted from the script output */
	score?: number;
	/** Raw stdout from the evaluation script */
	output: string;
	/** Raw stderr from the evaluation script */
	error?: string;
}

/**
 * A single row in the results log
 */
export interface ResultEntry {
	round: number;
	score: number | null;
	status: "keep" | "discard" | "crash";
	description: string;
}

/**
 * Run the user-provided evaluation script and parse the result.
 *
 * The script should print either:
 * - A JSON object with a "score" key: {"score": 0.95}
 * - A plain number on a line: 0.95
 *
 * Exit code 0 = success, non-zero = crash.
 */
export async function runEvaluation(
	config: EvaluateConfig,
	workDir: string,
): Promise<EvaluateResult> {
	const { script, metricKey = "score" } = config;

	// Split script into command and args for execCommand
	const parts = parseCommandLine(script);
	if (parts.length === 0) {
		return { success: false, output: "", error: "Empty evaluation script" };
	}

	const [command, ...args] = parts;

	try {
		logDebug(`Running evaluation: ${script}`);
		const { stdout, stderr, exitCode } = await execCommand(command, args, workDir);

		if (exitCode !== 0) {
			logDebug(`Evaluation script exited with code ${exitCode}`);
			return {
				success: false,
				output: stdout,
				error: stderr || `Evaluation script exited with code ${exitCode}`,
			};
		}

		// Try to parse score from stdout
		const score = parseScore(stdout, metricKey);

		return {
			success: true,
			score: score ?? undefined,
			output: stdout,
			error: stderr || undefined,
		};
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		logError(`Evaluation script failed: ${errorMsg}`);
		return { success: false, output: "", error: errorMsg };
	}
}

/**
 * Parse a score from evaluation script output.
 *
 * Tries in order:
 * 1. JSON object with the metric key: {"score": 0.95}
 * 2. A line matching "key: value" (e.g. "val_bpb: 0.997")
 * 3. A plain number on its own line
 */
function parseScore(output: string, metricKey: string): number | null {
	const trimmed = output.trim();
	if (!trimmed) return null;

	// 1. Try JSON parse
	try {
		const json = JSON.parse(trimmed);
		if (typeof json === "object" && json !== null && metricKey in json) {
			const val = Number(json[metricKey]);
			if (!Number.isNaN(val)) return val;
		}
		// Also try if the JSON itself is a number
		if (typeof json === "number" && !Number.isNaN(json)) return json;
	} catch {
		// Not JSON, continue
	}

	// Try JSON on each line (in case there's other output before/after)
	for (const line of trimmed.split("\n")) {
		const l = line.trim();
		if (l.startsWith("{")) {
			try {
				const json = JSON.parse(l);
				if (typeof json === "object" && json !== null && metricKey in json) {
					const val = Number(json[metricKey]);
					if (!Number.isNaN(val)) return val;
				}
			} catch {
				// continue
			}
		}
	}

	// 2. Try "key: value" pattern (like autoresearch's "val_bpb: 0.997900")
	const keyPattern = new RegExp(`^${escapeRegExp(metricKey)}:\\s*([\\d.eE+-]+)`, "m");
	const keyMatch = trimmed.match(keyPattern);
	if (keyMatch) {
		const val = Number(keyMatch[1]);
		if (!Number.isNaN(val)) return val;
	}

	// 3. Try plain number on last non-empty line
	const lines = trimmed.split("\n").filter((l) => l.trim().length > 0);
	if (lines.length > 0) {
		const lastLine = lines[lines.length - 1].trim();
		const val = Number(lastLine);
		if (!Number.isNaN(val) && lastLine.length > 0) return val;
	}

	return null;
}

/**
 * Determine if a new score is better than the current best,
 * given the optimization objective.
 */
export function isBetterScore(
	newScore: number,
	bestScore: number | null,
	objective: MetricObjective,
): boolean {
	if (bestScore === null) return true;
	if (objective === "minimize") return newScore < bestScore;
	if (objective === "maximize") return newScore > bestScore;
	// pass-fail: any truthy score is good, not really "better"
	return newScore > 0 && bestScore <= 0;
}

/**
 * Format a results history table (TSV format, like autoresearch)
 */
export function formatResultsTable(entries: ResultEntry[]): string {
	const header = "round\tscore\tstatus\tdescription";
	const rows = entries.map(
		(e) => `${e.round}\t${e.score !== null ? e.score.toFixed(6) : "N/A"}\t${e.status}\t${e.description}`,
	);
	return [header, ...rows].join("\n");
}

/**
 * Append an entry to the results TSV file
 */
export function appendResultsLog(
	logPath: string,
	entry: ResultEntry,
): void {
	const header = "round\tscore\tstatus\tdescription\n";
	const row = `${entry.round}\t${entry.score !== null ? entry.score.toFixed(6) : "N/A"}\t${entry.status}\t${entry.description}\n`;

	if (!existsSync(logPath)) {
		writeFileSync(logPath, header + row, "utf-8");
	} else {
		appendFileSync(logPath, row, "utf-8");
	}
}

/**
 * Parse a shell command string into parts, respecting quotes.
 */
function parseCommandLine(cmd: string): string[] {
	const parts: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;

	for (let i = 0; i < cmd.length; i++) {
		const ch = cmd[i];
		if (ch === "'" && !inDouble) {
			inSingle = !inSingle;
		} else if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
		} else if (ch === " " && !inSingle && !inDouble) {
			if (current.length > 0) {
				parts.push(current);
				current = "";
			}
		} else {
			current += ch;
		}
	}
	if (current.length > 0) {
		parts.push(current);
	}
	return parts;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
