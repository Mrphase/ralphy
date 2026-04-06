import { describe, expect, it } from "bun:test";
import {
	UsageLimitExhaustedError,
	computeUsageLimitResumeAt,
	extractCodexRetryAt,
	isCodexUsageLimitError,
	waitForUsageLimitResume,
	withCodexUsageLimitResume,
} from "./usage-limit.ts";

describe("isCodexUsageLimitError", () => {
	it("matches the stable Codex usage limit phrase", () => {
		expect(
			isCodexUsageLimitError(
				"You've hit your usage limit. Upgrade to Pro or try again at Feb 23rd, 2026 9:01 PM.",
			),
		).toBe(true);
	});

	it("accepts related quota wording", () => {
		expect(isCodexUsageLimitError("Quota exceeded. Too many requests right now.")).toBe(true);
	});

	it("ignores unrelated errors", () => {
		expect(isCodexUsageLimitError("Network timeout while contacting the API")).toBe(false);
	});
});

describe("extractCodexRetryAt", () => {
	it("parses time-only retry hints in local time", () => {
		const now = new Date(2026, 1, 23, 14, 30, 0);
		const retryAt = extractCodexRetryAt(
			"You've hit your usage limit. To get more access now, send a request to your admin or try again at 2:57 PM.",
			now,
		);

		expect(retryAt).not.toBeNull();
		expect(retryAt?.getFullYear()).toBe(2026);
		expect(retryAt?.getMonth()).toBe(1);
		expect(retryAt?.getDate()).toBe(23);
		expect(retryAt?.getHours()).toBe(14);
		expect(retryAt?.getMinutes()).toBe(57);
	});

	it("rolls time-only retry hints to the next day when the time has passed", () => {
		const now = new Date(2026, 1, 23, 15, 30, 0);
		const retryAt = extractCodexRetryAt(
			"You've hit your usage limit. To get more access now, send a request to your admin or try again at 2:57 PM.",
			now,
		);

		expect(retryAt).not.toBeNull();
		expect(retryAt?.getDate()).toBe(24);
		expect(retryAt?.getHours()).toBe(14);
		expect(retryAt?.getMinutes()).toBe(57);
	});

	it("parses dated retry hints with ordinal suffixes", () => {
		const now = new Date(2026, 1, 23, 20, 55, 0);
		const retryAt = extractCodexRetryAt(
			"You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Feb 23rd, 2026 9:01 PM.",
			now,
		);

		expect(retryAt).not.toBeNull();
		expect(retryAt?.getFullYear()).toBe(2026);
		expect(retryAt?.getMonth()).toBe(1);
		expect(retryAt?.getDate()).toBe(23);
		expect(retryAt?.getHours()).toBe(21);
		expect(retryAt?.getMinutes()).toBe(1);
	});
});

describe("computeUsageLimitResumeAt", () => {
	it("adds a fixed two-minute buffer to parsed retry times", () => {
		const now = new Date(2026, 1, 23, 20, 55, 0);
		const resumeAt = computeUsageLimitResumeAt(
			"You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Feb 23rd, 2026 9:01 PM.",
			now,
			5.5,
		);

		expect(resumeAt.getHours()).toBe(21);
		expect(resumeAt.getMinutes()).toBe(3);
	});

	it("falls back to the configured hours when no retry time can be parsed", () => {
		const now = new Date(2026, 1, 23, 10, 0, 0);
		const resumeAt = computeUsageLimitResumeAt(
			"You've hit your usage limit. Upgrade to Pro for more access.",
			now,
			5.5,
		);

		expect(resumeAt.getTime()).toBe(now.getTime() + 5.5 * 60 * 60 * 1000);
	});
});

describe("waitForUsageLimitResume", () => {
	it("waits until the requested resume time", async () => {
		let currentTime = new Date(2026, 1, 23, 10, 0, 0);
		const sleeps: number[] = [];
		const resumeAt = new Date(currentTime.getTime() + 65 * 1000);

		await waitForUsageLimitResume(resumeAt, {
			now: () => currentTime,
			sleepFn: async (ms) => {
				sleeps.push(ms);
				currentTime = new Date(currentTime.getTime() + ms);
			},
		});

		expect(sleeps).toEqual([60000, 5000]);
		expect(currentTime.getTime()).toBe(resumeAt.getTime());
	});
});

describe("withCodexUsageLimitResume", () => {
	it("waits and retries the same operation after a Codex usage-limit error", async () => {
		let attempts = 0;
		let currentTime = new Date(2026, 1, 23, 20, 55, 0);
		const sleeps: number[] = [];
		const recorded: Array<{ source: string; resumeAt: Date }> = [];

		const result = await withCodexUsageLimitResume(
			async () => {
				attempts++;
				if (attempts === 1) {
					throw new Error(
						"You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Feb 23rd, 2026 9:01 PM.",
					);
				}
				return "ok";
			},
			{
				enabled: true,
				engineName: "Codex",
				fallbackHours: 5.5,
				maxDeferrals: 3,
				now: () => currentTime,
				sleepFn: async (ms) => {
					sleeps.push(ms);
					currentTime = new Date(currentTime.getTime() + ms);
				},
				recordDeferral: ({ source, resumeAt }) => {
					recorded.push({ source, resumeAt });
					return 1;
				},
			},
		);

		expect(result).toBe("ok");
		expect(attempts).toBe(2);
		expect(recorded).toHaveLength(1);
		expect(recorded[0]?.source).toBe("parsed-retry-at");
		expect(recorded[0]?.resumeAt.getHours()).toBe(21);
		expect(recorded[0]?.resumeAt.getMinutes()).toBe(3);
		expect(sleeps.reduce((total, ms) => total + ms, 0)).toBe(480000);
	});

	it("throws a UsageLimitExhaustedError after the configured deferral cap", async () => {
		await expect(
			withCodexUsageLimitResume(
				async () => {
					throw new Error(
						"You've hit your usage limit. To get more access now, send a request to your admin or try again at 2:57 PM.",
					);
				},
				{
					enabled: true,
					engineName: "Codex",
					fallbackHours: 5.5,
					maxDeferrals: 2,
					now: () => new Date(2026, 1, 23, 14, 0, 0),
					sleepFn: async () => {
						throw new Error("should not sleep after exhausting deferrals");
					},
					recordDeferral: () => 2,
				},
			),
		).rejects.toBeInstanceOf(UsageLimitExhaustedError);
	});
});
