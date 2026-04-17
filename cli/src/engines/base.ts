import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { AIEngine, AIResult, EngineOptions, ProgressCallback } from "./types.ts";

export type CommandOutputStream = "stdout" | "stderr";

// Check if running in Bun
const isBun = typeof Bun !== "undefined";
const isWindows = process.platform === "win32";

function resolveWindowsCommandPath(command: string): string | null {
	if (!isWindows) {
		return null;
	}

	if (command.includes("\\") || command.includes("/")) {
		return command;
	}

	try {
		const result = spawnSync("where", [command], { stdio: "pipe" });
		if (result.status !== 0) {
			return null;
		}

		const candidates = result.stdout
			.toString()
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);

		const preferredCandidates = [".exe", ".com", ".cmd", ".bat", ".ps1"]
			.map((extension) =>
				candidates.find(
					(candidate) => candidate.toLowerCase().endsWith(extension) && existsSync(candidate),
				),
			)
			.filter((candidate): candidate is string => Boolean(candidate));

		if (preferredCandidates.length > 0) {
			return preferredCandidates[0];
		}

		const existingCandidate = candidates.find((candidate) => existsSync(candidate));
		if (existingCandidate) {
			return existingCandidate;
		}

		return candidates[0] || null;
	} catch {
		return null;
	}
}

function getWindowsPowerShellHost(): string {
	return (
		resolveWindowsCommandPath("pwsh") || resolveWindowsCommandPath("powershell") || "powershell.exe"
	);
}

function getWindowsSpawnConfig(
	command: string,
	args: string[],
): { command: string; args: string[] } {
	const resolvedCommand = resolveWindowsCommandPath(command) || command;
	const lowerResolvedCommand = resolvedCommand.toLowerCase();

	if (lowerResolvedCommand.endsWith(".ps1")) {
		return {
			command: getWindowsPowerShellHost(),
			args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolvedCommand, ...args],
		};
	}

	if (lowerResolvedCommand.endsWith(".cmd") || lowerResolvedCommand.endsWith(".bat")) {
		return {
			command: "cmd.exe",
			args: ["/c", resolvedCommand, ...args],
		};
	}

	if (
		resolvedCommand.includes("\\") ||
		resolvedCommand.includes("/") ||
		lowerResolvedCommand.endsWith(".exe") ||
		lowerResolvedCommand.endsWith(".com")
	) {
		return {
			command: resolvedCommand,
			args,
		};
	}

	return {
		command: "cmd.exe",
		args: ["/c", command, ...args],
	};
}

/**
 * Check if a command is available in PATH
 */
export async function commandExists(command: string): Promise<boolean> {
	try {
		const checkCommand = isWindows ? "where" : "which";
		if (isBun) {
			const proc = Bun.spawn([checkCommand, command], {
				stdout: "pipe",
				stderr: "pipe",
			});
			const exitCode = await proc.exited;
			return exitCode === 0;
		}
		// Node.js fallback - where/which don't need shell
		const result = spawnSync(checkCommand, [command], { stdio: "pipe" });
		return result.status === 0;
	} catch {
		return false;
	}
}

/**
 * Execute a command and return stdout
 * @param stdinContent - Optional content to pass via stdin (useful for multi-line prompts on Windows)
 */
export async function execCommand(
	command: string,
	args: string[],
	workDir: string,
	env?: Record<string, string>,
	stdinContent?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	if (isBun) {
		const spawnConfig = isWindows ? getWindowsSpawnConfig(command, args) : { command, args };
		const proc = Bun.spawn([spawnConfig.command, ...spawnConfig.args], {
			cwd: workDir,
			stdin: stdinContent ? "pipe" : "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, ...env },
		});

		// Write stdin content if provided
		if (stdinContent && proc.stdin) {
			proc.stdin.write(stdinContent);
			proc.stdin.end();
		}

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		return { stdout, stderr, exitCode };
	}

	// Node.js fallback
	return new Promise((resolve) => {
		const spawnConfig = isWindows ? getWindowsSpawnConfig(command, args) : { command, args };
		const proc = spawn(spawnConfig.command, spawnConfig.args, {
			cwd: workDir,
			env: { ...process.env, ...env },
			stdio: [stdinContent ? "pipe" : "ignore", "pipe", "pipe"],
		});

		// Write stdin content if provided
		if (stdinContent && proc.stdin) {
			proc.stdin.write(stdinContent);
			proc.stdin.end();
		}

		let stdout = "";
		let stderr = "";

		proc.stdout?.on("data", (data) => {
			stdout += data.toString();
		});

		proc.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (exitCode) => {
			resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
		});

		proc.on("error", (err) => {
			// Maintain backward compatibility - don't reject, include error in stderr
			stderr += `\nSpawn error: ${err.message}`;
			resolve({ stdout, stderr, exitCode: 1 });
		});
	});
}

/**
 * Parse token counts from stream-json output (Claude/Qwen format)
 */
export function parseStreamJsonResult(output: string): {
	response: string;
	inputTokens: number;
	outputTokens: number;
} {
	const lines = output.split("\n").filter(Boolean);
	let response = "";
	let inputTokens = 0;
	let outputTokens = 0;

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line);
			if (parsed.type === "result") {
				response = parsed.result || "Task completed";
				inputTokens = parsed.usage?.input_tokens || 0;
				outputTokens = parsed.usage?.output_tokens || 0;
			}
		} catch {
			// Ignore non-JSON lines
		}
	}

	return { response: response || "Task completed", inputTokens, outputTokens };
}

const ANSI_ESCAPE_PATTERN =
	/\u001b(?:\][^\u0007]*(?:\u0007|\u001b\\)|[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f-\u009f]/g;
const DISPLAY_NOISE_PATTERNS = [
	/^reading prompt from stdin\.\.\.$/i,
	/^qgenie cli v[\d.]+/i,
	/^qgenie agent v[\d.]+/i,
	/^qgenie cli works best on linux\.$/i,
	/^(>|\$)\s*qgenie(?:\.exe)?\s+agent\s+exec\b/i,
	/^- windows \(powershell\) support is experimental/i,
	/^- for best results, please use wsl/i,
	/^-{3,}$/i,
	/^(workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|session id):/i,
	/^user$/i,
	/\bcodex_core::tools::router\b/i,
	/^warning: failed to clean up stale arg0 temp dirs:/i,
	/^warning: proceeding, even though we could not update path:/i,
	/^set-psreadlineoption:/i,
	/^line \|$/i,
	/^\d+\s+\|\s+set-psreadlineoption\b/i,
	/^\|\s+~+/i,
	/^the predictive suggestion feature cannot be enabled\b/i,
	/^processing or it'?s redirected\.$/i,
	/^fatal: not a git repository \(or any of the parent directories\): \.git$/i,
	/^output:$/i,
	/^wall time:/i,
];
const CODEX_ROUTER_NOISE_PATTERN = /\bcodex_core::tools::router\b/i;

export function stripAnsiControlSequences(value: string): string {
	return value.replace(ANSI_ESCAPE_PATTERN, "").replace(CONTROL_CHAR_PATTERN, "");
}

export function sanitizeDisplayLine(line: string): string | null {
	const stripped = stripAnsiControlSequences(line).replace(/\r/g, "").trim();
	if (!stripped) {
		return null;
	}

	if (DISPLAY_NOISE_PATTERNS.some((pattern) => pattern.test(stripped))) {
		return null;
	}

	return stripped;
}

function sanitizeDisplayBlock(output: string): string[] {
	const lines: string[] = [];

	for (const line of output.split(/\r?\n/)) {
		const sanitized = sanitizeDisplayLine(line);
		if (sanitized) {
			lines.push(sanitized);
		}
	}

	return lines;
}

function normalizeDisplayText(value: unknown): string[] {
	if (typeof value === "string") {
		return sanitizeDisplayBlock(value);
	}

	if (Array.isArray(value)) {
		return value.flatMap((item) => normalizeDisplayText(item));
	}

	if (!value || typeof value !== "object") {
		return [];
	}

	const record = value as Record<string, unknown>;

	if (typeof record.text === "string") {
		return normalizeDisplayText(record.text);
	}

	if (record.type === "text" && typeof record.text === "string") {
		return normalizeDisplayText(record.text);
	}

	if (record.content !== undefined) {
		const contentLines = normalizeDisplayText(record.content);
		if (contentLines.length > 0) {
			return contentLines;
		}
	}

	if (record.message !== undefined) {
		const messageLines = normalizeDisplayText(record.message);
		if (messageLines.length > 0) {
			return messageLines;
		}
	}

	return [];
}

function collectCodexStyleText(value: unknown): string[] {
	if (typeof value === "string") {
		return sanitizeDisplayBlock(value);
	}

	if (Array.isArray(value)) {
		return value.flatMap((item) => collectCodexStyleText(item));
	}

	if (!value || typeof value !== "object") {
		return [];
	}

	const record = value as Record<string, unknown>;

	if (typeof record.text === "string") {
		return collectCodexStyleText(record.text);
	}

	return [record.message, record.error, record.result, record.content].flatMap((item) =>
		collectCodexStyleText(item),
	);
}

export function extractCodexLikeError(output: string): string | null {
	const lines = output.split("\n").filter(Boolean);

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			const isErrorLine =
				parsed.type === "error" ||
				parsed.is_error === true ||
				(typeof parsed.error === "string" && parsed.error.length > 0);

			if (!isErrorLine) {
				continue;
			}

			const messages = [parsed.message, parsed.error, parsed.result]
				.flatMap((item) => collectCodexStyleText(item))
				.filter(Boolean);
			if (messages.length > 0) {
				return messages.join("\n");
			}

			return "Unknown error";
		} catch {
			// Ignore non-JSON lines
		}
	}

	return null;
}

export function extractLatestCodexAgentMessage(output: string): string {
	const lines = output.split("\n").filter(Boolean);
	let latestMessage = "";

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			const item = (parsed.item ?? {}) as Record<string, unknown>;
			if (item.type === "agent_message" && typeof item.text === "string") {
				const messageLines = sanitizeDisplayBlock(item.text);
				if (messageLines.length > 0) {
					latestMessage = messageLines.join("\n");
				}
			}
		} catch {
			// Ignore non-JSON lines
		}
	}

	return latestMessage || "Task completed";
}

export function extractDisplayLinesFromCodexEventLine(line: string): string[] | null {
	const trimmed = line.trim();
	if (!trimmed) {
		return null;
	}

	try {
		const parsed = JSON.parse(trimmed) as Record<string, unknown>;
		const item = (parsed.item ?? {}) as Record<string, unknown>;
		const itemType = item.type as string | undefined;

		if (itemType === "reasoning" && typeof item.text === "string") {
			const reasoningLines = sanitizeDisplayBlock(item.text);
			return reasoningLines.length > 0 ? reasoningLines : null;
		}

		if (itemType === "agent_message" && typeof item.text === "string") {
			const messageLines = sanitizeDisplayBlock(item.text);
			return messageLines.length > 0 ? messageLines : null;
		}

		if (parsed.type === "error") {
			const errorLines = [parsed.message, parsed.error, parsed.result]
				.flatMap((value) => collectCodexStyleText(value))
				.filter((value) => !CODEX_ROUTER_NOISE_PATTERN.test(value));

			if (errorLines.length === 0) {
				return null;
			}

			return [`[error] ${errorLines.join(" | ").slice(0, 240)}`];
		}

		return null;
	} catch {
		const fallback = sanitizeDisplayLine(line);
		return fallback ? [fallback] : null;
	}
}

/**
 * Extract human-readable text from a single stream-json line.
 * Returns null for machine-oriented JSON events that should stay hidden in verbose mode.
 */
export function extractDisplayLinesFromStreamJsonLine(line: string): string[] | null {
	const trimmed = line.trim();
	if (!trimmed) {
		return null;
	}

	try {
		const parsed = JSON.parse(trimmed) as Record<string, unknown>;

		if (parsed.type === "assistant") {
			const assistantLines = normalizeDisplayText(parsed.message);
			if (assistantLines.length > 0) {
				return assistantLines;
			}

			const contentLines = normalizeDisplayText(parsed.content);
			return contentLines.length > 0 ? contentLines : null;
		}

		if (parsed.type === "result") {
			const resultLines = normalizeDisplayText(parsed.result);
			return resultLines.length > 0 ? resultLines : null;
		}

		if (parsed.type === "error") {
			const errorLines = normalizeDisplayText(parsed.error);
			if (errorLines.length > 0) {
				return errorLines;
			}

			const messageLines = normalizeDisplayText(parsed.message);
			return messageLines.length > 0 ? messageLines : null;
		}

		return null;
	} catch {
		const fallback = sanitizeDisplayLine(line);
		return fallback ? [fallback] : null;
	}
}

/**
 * Check for errors in stream-json output
 */
export function checkForErrors(output: string): string | null {
	const lines = output.split("\n").filter(Boolean);

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line);
			if (parsed.type === "error") {
				return parsed.error?.message || parsed.message || "Unknown error";
			}
		} catch {
			// Ignore non-JSON lines
		}
	}

	return null;
}

/**
 * Extract authentication error message from stream-json output.
 * Looks for error type messages or result messages with authentication-related keywords.
 * Returns the clean error message if found, null otherwise.
 */
export function extractAuthenticationError(output: string): string | null {
	const lines = output.split("\n").filter(Boolean);

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line);

			// Check if this is any kind of error response
			if (
				parsed.type === "error" ||
				parsed.is_error === true ||
				parsed.error === "authentication_failed"
			) {
				// Extract message from content array (assistant type) or standard fields
				let message = "";
				const content = parsed.message?.content;
				if (Array.isArray(content)) {
					const textItem = content.find(
						(item: { type?: string; text?: string }) => item.type === "text" && item.text,
					);
					if (textItem) message = textItem.text;
				}
				if (!message) {
					message = parsed.result || parsed.error?.message || parsed.message || "";
				}

				if (message && isAuthenticationMessage(message.toLowerCase())) {
					return message;
				}
			}
		} catch {
			// Ignore non-JSON lines
		}
	}

	return null;
}

/**
 * Check if a message contains authentication-related keywords
 */
function isAuthenticationMessage(messageLower: string): boolean {
	return (
		messageLower.includes("invalid api key") ||
		messageLower.includes("authentication") ||
		messageLower.includes("not authenticated") ||
		messageLower.includes("unauthorized") ||
		messageLower.includes("/login")
	);
}

/**
 * Format a command failure with useful output context.
 * If the output contains an authentication error, returns just that error message.
 * Otherwise returns the full error with output context.
 */
export function formatCommandError(exitCode: number, output: string): string {
	const trimmed = output.trim();
	if (!trimmed) {
		return `Command failed with exit code ${exitCode}`;
	}

	// Check for authentication errors first - return the clean message if found
	const authError = extractAuthenticationError(output);
	if (authError) {
		return authError;
	}

	const lines = trimmed.split("\n").filter(Boolean);
	const snippet = lines.slice(-12).join("\n");
	return `Command failed with exit code ${exitCode}. Output:\n${snippet}`;
}

/**
 * Read a stream line by line, calling onLine for each non-empty line
 */
async function readStream(
	stream: ReadableStream<Uint8Array>,
	onLine: (line: string, stream: CommandOutputStream) => void,
	streamName: CommandOutputStream,
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) {
				if (line.trim()) onLine(line, streamName);
			}
		}
		if (buffer.trim()) onLine(buffer, streamName);
	} finally {
		reader.releaseLock();
	}
}

/**
 * Execute a command with streaming output, calling onLine for each line
 * @param stdinContent - Optional content to pass via stdin (useful for multi-line prompts on Windows)
 */
export async function execCommandStreaming(
	command: string,
	args: string[],
	workDir: string,
	onLine: (line: string, stream: CommandOutputStream) => void,
	env?: Record<string, string>,
	stdinContent?: string,
): Promise<{ exitCode: number }> {
	if (isBun) {
		const spawnConfig = isWindows ? getWindowsSpawnConfig(command, args) : { command, args };
		const proc = Bun.spawn([spawnConfig.command, ...spawnConfig.args], {
			cwd: workDir,
			stdin: stdinContent ? "pipe" : "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, ...env },
		});

		// Write stdin content if provided
		if (stdinContent && proc.stdin) {
			proc.stdin.write(stdinContent);
			proc.stdin.end();
		}

		// Process both stdout and stderr in parallel
		await Promise.all([
			readStream(proc.stdout, onLine, "stdout"),
			readStream(proc.stderr, onLine, "stderr"),
		]);

		const exitCode = await proc.exited;
		return { exitCode };
	}

	// Node.js fallback
	return new Promise((resolve) => {
		const spawnConfig = isWindows ? getWindowsSpawnConfig(command, args) : { command, args };
		const proc = spawn(spawnConfig.command, spawnConfig.args, {
			cwd: workDir,
			env: { ...process.env, ...env },
			stdio: [stdinContent ? "pipe" : "ignore", "pipe", "pipe"],
		});

		// Write stdin content if provided
		if (stdinContent && proc.stdin) {
			proc.stdin.write(stdinContent);
			proc.stdin.end();
		}

		let stdoutBuffer = "";
		let stderrBuffer = "";

		const processBuffer = (buffer: string, stream: CommandOutputStream) => {
			const lines = buffer.split("\n");
			const remaining = lines.pop() || "";
			for (const line of lines) {
				if (line.trim()) onLine(line, stream);
			}
			return remaining;
		};

		proc.stdout?.on("data", (data) => {
			stdoutBuffer += data.toString();
			stdoutBuffer = processBuffer(stdoutBuffer, "stdout");
		});

		proc.stderr?.on("data", (data) => {
			stderrBuffer += data.toString();
			stderrBuffer = processBuffer(stderrBuffer, "stderr");
		});

		proc.on("close", (exitCode) => {
			// Process any remaining data
			if (stdoutBuffer.trim()) onLine(stdoutBuffer, "stdout");
			if (stderrBuffer.trim()) onLine(stderrBuffer, "stderr");
			resolve({ exitCode: exitCode ?? 1 });
		});

		proc.on("error", (err) => {
			// Maintain backward compatibility - don't reject, report error via onLine
			onLine(`Spawn error: ${err.message}`, "stderr");
			resolve({ exitCode: 1 });
		});
	});
}

/**
 * Check if a file path looks like a test file
 */
function isTestFile(filePath: string): boolean {
	const lower = filePath.toLowerCase();
	return (
		lower.includes(".test.") ||
		lower.includes(".spec.") ||
		lower.includes("__tests__") ||
		lower.includes("_test.go")
	);
}

/**
 * Detect the current step from a JSON output line
 * Returns step name like "Reading code", "Implementing", etc.
 */
export function detectStepFromOutput(line: string): string | null {
	// Fast path: skip non-JSON lines
	const trimmed = line.trim();
	if (!trimmed.startsWith("{")) {
		return null;
	}

	try {
		const parsed = JSON.parse(trimmed);

		// Extract specific fields for pattern matching (avoid stringifying entire object)
		const toolName =
			parsed.tool?.toLowerCase() ||
			parsed.name?.toLowerCase() ||
			parsed.tool_name?.toLowerCase() ||
			"";
		const command = parsed.command?.toLowerCase() || "";
		const filePath = (parsed.file_path || parsed.filePath || parsed.path || "").toLowerCase();
		const description = (parsed.description || "").toLowerCase();

		// Check tool name first to determine operation type
		const isReadOperation = toolName === "read" || toolName === "glob" || toolName === "grep";
		const isWriteOperation = toolName === "write" || toolName === "edit";

		// Reading code - check this early to avoid misclassifying reads of test files
		if (isReadOperation) {
			return "Reading code";
		}

		// Git commit
		if (command.includes("git commit") || description.includes("git commit")) {
			return "Committing";
		}

		// Git add/staging
		if (command.includes("git add") || description.includes("git add")) {
			return "Staging";
		}

		// Linting - check command for lint tools
		if (
			command.includes("lint") ||
			command.includes("eslint") ||
			command.includes("biome") ||
			command.includes("prettier")
		) {
			return "Linting";
		}

		// Testing - check command for test runners
		if (
			command.includes("vitest") ||
			command.includes("jest") ||
			command.includes("bun test") ||
			command.includes("npm test") ||
			command.includes("pytest") ||
			command.includes("go test")
		) {
			return "Testing";
		}

		// Writing tests - only for write operations to test files
		if (isWriteOperation && isTestFile(filePath)) {
			return "Writing tests";
		}

		// Writing/Editing code
		if (isWriteOperation) {
			return "Implementing";
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * Base implementation for AI engines
 */
export abstract class BaseAIEngine implements AIEngine {
	abstract name: string;
	abstract cliCommand: string;

	async isAvailable(): Promise<boolean> {
		return commandExists(this.cliCommand);
	}

	abstract execute(prompt: string, workDir: string, options?: EngineOptions): Promise<AIResult>;

	/**
	 * Execute with streaming progress updates (optional implementation)
	 */
	executeStreaming?(
		prompt: string,
		workDir: string,
		onProgress: ProgressCallback,
		options?: EngineOptions,
	): Promise<AIResult>;
}
