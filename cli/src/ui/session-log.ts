import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SessionLogWriter {
	path: string;
	append(line: string): void;
	appendLines(lines: string[]): void;
}

interface SessionLogOptions {
	workDir: string;
	modelName: string;
	invocation?: string;
}

const sessionLogs = new Map<string, SessionLogWriter>();
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]+/g;

function sanitizeModelPrefix(modelName: string): string {
	const sanitized = modelName
		.trim()
		.replace(INVALID_FILENAME_CHARS, "-")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^\.+|\.+$/g, "")
		.replace(/^-+|-+$/g, "");

	return sanitized || "unknown-model";
}

function quoteInvocationArg(arg: string): string {
	if (!/[ \t"]/.test(arg)) {
		return arg;
	}

	return `"${arg.replace(/(["\\])/g, "\\$1")}"`;
}

function buildInvocationFallback(): string {
	const entrypoint = process.argv[1] || "ralphy";
	const renderedArgs = process.argv.slice(2).map(quoteInvocationArg).join(" ");
	return renderedArgs ? `${entrypoint} ${renderedArgs}` : entrypoint;
}

export function getRalphyInvocation(invocation?: string): string {
	return invocation?.trim() || process.env.RALPHY_INVOCATION?.trim() || buildInvocationFallback();
}

export function getOrCreateSessionLog(options: SessionLogOptions): SessionLogWriter {
	const modelPrefix = sanitizeModelPrefix(options.modelName);
	const key = `${options.workDir}\0${modelPrefix}`;
	const existing = sessionLogs.get(key);

	if (existing && existsSync(existing.path)) {
		return existing;
	}

	if (existing) {
		sessionLogs.delete(key);
	}

	const logDir = join(options.workDir, ".ralphy", "logs");
	mkdirSync(logDir, { recursive: true });

	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const path = join(logDir, `${modelPrefix}-${timestamp}.log`);

	try {
		writeFileSync(path, `${getRalphyInvocation(options.invocation)}\n`, "utf-8");
	} catch {
		// Ignore log initialization errors.
	}

	const writer: SessionLogWriter = {
		path,
		append(line: string): void {
			const trimmed = line.trim();
			if (!trimmed) {
				return;
			}

			try {
				appendFileSync(path, `${trimmed}\n`, "utf-8");
			} catch {
				// Ignore log write errors.
			}
		},
		appendLines(lines: string[]): void {
			for (const line of lines) {
				this.append(line);
			}
		},
	};

	sessionLogs.set(key, writer);
	return writer;
}

export function resetSessionLogs(): void {
	sessionLogs.clear();
}
