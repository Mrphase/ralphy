import { logInfo, logWarn } from "../ui/logger.ts";
import { sleep } from "./retry.ts";

export type UsageLimitResumeSource = "parsed-retry-at" | "fallback-hours";

export interface UsageLimitResumeInfo {
	error: string;
	resumeAt: Date;
	source: UsageLimitResumeSource;
}

export interface WaitForUsageLimitResumeOptions {
	now?: () => Date;
	sleepFn?: (ms: number) => Promise<void>;
}

export interface WithCodexUsageLimitResumeOptions extends WaitForUsageLimitResumeOptions {
	enabled: boolean;
	engineName: string;
	fallbackHours: number;
	maxDeferrals: number;
	recordDeferral: (info: UsageLimitResumeInfo) => number | Promise<number>;
	onBeforeWait?: (info: UsageLimitResumeInfo & { deferrals: number }) => void | Promise<void>;
}

const MINUTE_MS = 60 * 1000;
const BUFFER_MS = 2 * MINUTE_MS;
const HOUR_MS = 60 * MINUTE_MS;

export class UsageLimitExhaustedError extends Error {
	constructor(
		message: string,
		public readonly deferrals: number,
		public readonly resumeAt: Date,
		public readonly source: UsageLimitResumeSource,
	) {
		super(message);
		this.name = "UsageLimitExhaustedError";
	}
}

function isCodexEngine(engineName: string): boolean {
	return engineName.trim().toLowerCase() === "codex";
}

function stripOrdinalSuffixes(value: string): string {
	return value.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1");
}

function isValidDate(value: Date): boolean {
	return Number.isFinite(value.getTime());
}

function parseTimeOnlyRetryAt(timeText: string, now: Date): Date | null {
	const match = timeText.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
	if (!match) {
		return null;
	}

	let hours = Number.parseInt(match[1] || "0", 10);
	const minutes = Number.parseInt(match[2] || "0", 10);
	const meridiem = (match[3] || "").toUpperCase();

	if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
		return null;
	}

	if (meridiem === "PM" && hours < 12) {
		hours += 12;
	} else if (meridiem === "AM" && hours === 12) {
		hours = 0;
	}

	const retryAt = new Date(now);
	retryAt.setHours(hours, minutes, 0, 0);

	if (retryAt.getTime() <= now.getTime()) {
		retryAt.setDate(retryAt.getDate() + 1);
	}

	return retryAt;
}

export function isCodexUsageLimitError(error: string): boolean {
	const trimmed = error.trim();
	if (!trimmed) {
		return false;
	}

	if (/you['’]ve hit your usage limit/i.test(trimmed)) {
		return true;
	}

	return [
		/\busage limit\b/i,
		/\bhit your limit\b/i,
		/\bquota\b/i,
		/\brate limit\b/i,
		/\btoo many requests\b/i,
	].some((pattern) => pattern.test(trimmed));
}

export function extractCodexRetryAt(error: string, now: Date): Date | null {
	const datedMatch = error.match(
		/try again at\s+([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,\s+\d{4}\s+\d{1,2}:\d{2}\s*[AP]M)/i,
	);
	if (datedMatch?.[1]) {
		const parsed = new Date(stripOrdinalSuffixes(datedMatch[1]));
		if (isValidDate(parsed)) {
			return parsed;
		}
	}

	const timeOnlyMatch = error.match(/try again at\s+(\d{1,2}:\d{2}\s*[AP]M)\b/i);
	if (timeOnlyMatch?.[1]) {
		return parseTimeOnlyRetryAt(timeOnlyMatch[1], now);
	}

	return null;
}

export function computeUsageLimitResumeAt(error: string, now: Date, fallbackHours: number): Date {
	const retryAt = extractCodexRetryAt(error, now);
	if (retryAt) {
		return new Date(retryAt.getTime() + BUFFER_MS);
	}

	return new Date(now.getTime() + fallbackHours * HOUR_MS);
}

export function getUsageLimitResumeSource(error: string, now: Date): UsageLimitResumeSource {
	return extractCodexRetryAt(error, now) ? "parsed-retry-at" : "fallback-hours";
}

export function formatUsageLimitResumeSource(
	source: UsageLimitResumeSource,
	fallbackHours: number,
): string {
	if (source === "parsed-retry-at") {
		return "parsed from Codex output";
	}

	return `fallback ${fallbackHours}h`;
}

export async function waitForUsageLimitResume(
	resumeAt: Date,
	options: WaitForUsageLimitResumeOptions = {},
): Promise<void> {
	const now = options.now ?? (() => new Date());
	const sleepFn = options.sleepFn ?? sleep;

	while (true) {
		const remainingMs = resumeAt.getTime() - now().getTime();
		if (remainingMs <= 0) {
			return;
		}

		await sleepFn(Math.min(MINUTE_MS, remainingMs));
	}
}

export async function withCodexUsageLimitResume<T>(
	operation: () => Promise<T>,
	options: WithCodexUsageLimitResumeOptions,
): Promise<T> {
	const now = options.now ?? (() => new Date());

	while (true) {
		try {
			return await operation();
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			if (
				!options.enabled ||
				!isCodexEngine(options.engineName) ||
				!isCodexUsageLimitError(errorMsg)
			) {
				throw error;
			}

			const currentTime = now();
			const resumeAt = computeUsageLimitResumeAt(errorMsg, currentTime, options.fallbackHours);
			const source = getUsageLimitResumeSource(errorMsg, currentTime);
			const deferrals = await options.recordDeferral({
				error: errorMsg,
				resumeAt,
				source,
			});

			if (deferrals >= options.maxDeferrals) {
				throw new UsageLimitExhaustedError(errorMsg, deferrals, resumeAt, source);
			}

			await options.onBeforeWait?.({
				error: errorMsg,
				resumeAt,
				source,
				deferrals,
			});

			logWarn(
				`Codex usage limit hit. Waiting until ${resumeAt.toLocaleString()} (${formatUsageLimitResumeSource(source, options.fallbackHours)}).`,
			);
			logInfo(`Codex usage-limit deferral ${deferrals}/${options.maxDeferrals}`);

			await waitForUsageLimitResume(resumeAt, options);
		}
	}
}
