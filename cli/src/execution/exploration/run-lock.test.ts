import { afterEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { basename, join } from "node:path";
import simpleGit from "simple-git";
import {
	ExplorationRunLockCollisionError,
	acquireExplorationRunLock,
	getExplorationRunLockPath,
	recoverExplorationRunLock,
	releaseExplorationRunLock,
} from "./run-lock.ts";

const roots: string[] = [];
async function repo() {
	const root = mkdtempSync(join(tmpdir(), "ralphy-lock-"));
	roots.push(root);
	const git = simpleGit(root);
	await git.init();
	await git.addConfig("user.name", "Test");
	await git.addConfig("user.email", "test@example.com");
	writeFileSync(join(root, "a"), "a");
	await git.add(".");
	await git.commit("base");
	return root;
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("repository exploration run lock", () => {
	it("atomically permits exactly one owner and bounds collision evidence", async () => {
		const root = await repo();
		const settled = await Promise.allSettled([
			acquireExplorationRunLock(root, "main"),
			acquireExplorationRunLock(root, "main"),
		]);
		expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		const rejection = settled.find((result) => result.status === "rejected");
		expect(rejection?.status === "rejected" && rejection.reason).toBeInstanceOf(
			ExplorationRunLockCollisionError,
		);
		if (rejection?.status === "rejected") {
			const error = rejection.reason as ExplorationRunLockCollisionError;
			expect(error.message.length).toBeLessThan(8000);
			expect(error.recoveryToken).not.toBeNull();
			expect(error.message).toContain(`--explore-recover-lock ${error.recoveryToken}`);
		}
		const winner = settled.find((result) => result.status === "fulfilled");
		if (winner?.status === "fulfilled") await releaseExplorationRunLock(winner.value);
	});

	it("publishes only a complete synced owner record and cleans process temp files", async () => {
		const root = await repo();
		let releasePublish!: () => void;
		const publishGate = new Promise<void>((resolve) => {
			releasePublish = resolve;
		});
		let ownerReady!: () => void;
		const ownerIsReady = new Promise<void>((resolve) => {
			ownerReady = resolve;
		});
		const delayed = acquireExplorationRunLock(root, "main", {
			pid: 1001,
			randomToken: () => "a".repeat(64),
			beforePublish: async () => {
				ownerReady();
				await publishGate;
			},
		});
		await ownerIsReady;

		const winner = await acquireExplorationRunLock(root, "main", {
			pid: 1002,
			randomToken: () => "b".repeat(64),
		});
		releasePublish();
		await expect(delayed).rejects.toMatchObject({
			recoveryToken: "b".repeat(64),
		});
		const persisted = JSON.parse(readFileSync(join(winner.lockPath, "owner.json"), "utf8"));
		expect(persisted).toMatchObject({
			version: 1,
			token: "b".repeat(64),
			pid: 1002,
			baseBranch: "main",
		});
		const siblings = readdirSync(join(winner.lockPath, ".."));
		expect(
			siblings.filter((name) => name.startsWith("ralphy-exploration-run.lock.owner-")),
		).toEqual([]);
		await releaseExplorationRunLock(winner);
	});

	it("uses the common git directory for main and linked worktrees", async () => {
		const root = await repo();
		const linked = `${root}-linked`;
		roots.push(linked);
		await simpleGit(root).raw(["worktree", "add", "--detach", linked]);
		expect(await getExplorationRunLockPath(root)).toBe(await getExplorationRunLockPath(linked));
	});

	it("releases only an exact valid token and supports finally cleanup", async () => {
		const root = await repo();
		const lock = await acquireExplorationRunLock(root, "main");
		await releaseExplorationRunLock({ ...lock, token: "0".repeat(64) });
		expect(readFileSync(join(lock.lockPath, "owner.json"), "utf8")).toContain(lock.token);
		try {
			throw new Error("handled");
		} catch {
			// handled
		} finally {
			await releaseExplorationRunLock(lock);
		}
		expect(existsSync(lock.lockPath)).toBe(false);
	});

	it("preserves malformed lock files on release", async () => {
		const root = await repo();
		const lock = await acquireExplorationRunLock(root, "main");
		writeFileSync(join(lock.lockPath, "owner.json"), "malformed");
		await releaseExplorationRunLock(lock);
		expect(readFileSync(join(lock.lockPath, "owner.json"), "utf8")).toBe("malformed");
	});

	it.each([
		["wrong token", { recoveryToken: "0".repeat(64) }],
		["wrong host", { hostname: "other-host" }],
		["live pid", { probePid: () => "alive" as const }],
		["unverifiable pid", { probePid: () => "unverifiable" as const }],
	])("refuses recovery for %s", async (_name, override) => {
		const root = await repo();
		const lock = await acquireExplorationRunLock(root, "main", { probePid: () => "alive" });
		await expect(
			recoverExplorationRunLock(root, {
				recoveryToken: lock.token,
				hostname: hostname(),
				probePid: () => "dead",
				...override,
			}),
		).rejects.toThrow();
		expect(existsSync(lock.lockPath)).toBe(true);
	});

	it.each([
		["malformed", "malformed"],
		["oversized", "x".repeat(16_385)],
	])("refuses recovery for %s owner evidence", async (_name, contents) => {
		const root = await repo();
		const path = await getExplorationRunLockPath(root);
		mkdirSync(path);
		writeFileSync(join(path, "owner.json"), contents);
		await expect(
			recoverExplorationRunLock(root, {
				recoveryToken: "0".repeat(64),
				hostname: hostname(),
				probePid: () => "dead",
			}),
		).rejects.toThrow();
		expect(readFileSync(join(path, "owner.json"), "utf8")).toBe(contents);
	});

	it("quarantines exact-token confirmed-dead bytes without reacquiring", async () => {
		const root = await repo();
		const lock = await acquireExplorationRunLock(root, "main");
		const bytes = readFileSync(join(lock.lockPath, "owner.json"));
		const quarantine = await recoverExplorationRunLock(root, {
			recoveryToken: lock.token,
			hostname: hostname(),
			probePid: () => "dead",
			now: () => new Date("2026-07-31T01:02:03Z"),
		});
		expect(basename(quarantine)).not.toContain(":");
		expect(existsSync(lock.lockPath)).toBe(false);
		expect(readFileSync(join(quarantine, "owner.json"))).toEqual(bytes);
	});
	it("prevents a stale recovery from moving a replacement owner", async () => {
		const root = await repo();
		const first = await acquireExplorationRunLock(root, "main", {
			pid: 2001,
			randomToken: () => "c".repeat(64),
			now: () => new Date("2026-07-31T01:02:03Z"),
		});
		let releaseAction!: () => void;
		const actionGate = new Promise<void>((resolve) => {
			releaseAction = resolve;
		});
		let validated!: () => void;
		const validationReached = new Promise<void>((resolve) => {
			validated = resolve;
		});
		const staleRecovery = recoverExplorationRunLock(root, {
			recoveryToken: first.token,
			hostname: hostname(),
			probePid: () => "dead",
			beforeQuarantine: async () => {
				validated();
				await actionGate;
			},
		});
		await validationReached;
		await recoverExplorationRunLock(root, {
			recoveryToken: first.token,
			hostname: hostname(),
			probePid: () => "dead",
		});
		const replacement = await acquireExplorationRunLock(root, "main", {
			pid: 2002,
			randomToken: () => "d".repeat(64),
		});
		releaseAction();
		await expect(staleRecovery).rejects.toThrow();
		expect(JSON.parse(readFileSync(join(replacement.lockPath, "owner.json"), "utf8")).token).toBe(
			replacement.token,
		);
		expect(existsSync(replacement.lockPath)).toBe(true);
		await releaseExplorationRunLock(replacement);
	});
	it("uses one deterministic transition target for release and recovery", async () => {
		const token = "e".repeat(64);
		const startedAt = () => new Date("2026-07-31T01:02:03Z");
		const releaseRoot = await repo();
		const releasedLock = await acquireExplorationRunLock(releaseRoot, "main", {
			pid: 3001,
			randomToken: () => token,
			now: startedAt,
		});
		await releaseExplorationRunLock(releasedLock);
		const releaseTarget = readdirSync(join(releasedLock.lockPath, "..")).find((name) =>
			name.includes(token),
		);
		expect(releaseTarget).toBeDefined();

		const recoveryRoot = await repo();
		const recoverableLock = await acquireExplorationRunLock(recoveryRoot, "main", {
			pid: 3002,
			randomToken: () => token,
			now: startedAt,
		});
		const recoveryTarget = await recoverExplorationRunLock(recoveryRoot, {
			recoveryToken: recoverableLock.token,
			hostname: hostname(),
			probePid: () => "dead",
		});
		expect(basename(recoveryTarget)).toBe(releaseTarget);
	});

	it("prevents a stale release from transitioning a replacement after recovery", async () => {
		const root = await repo();
		const first = await acquireExplorationRunLock(root, "main", {
			pid: 4001,
			randomToken: () => "f".repeat(64),
			now: () => new Date("2026-07-31T01:02:03Z"),
		});
		let releaseTransition!: () => void;
		const transitionGate = new Promise<void>((resolve) => {
			releaseTransition = resolve;
		});
		let validated!: () => void;
		const validationReached = new Promise<void>((resolve) => {
			validated = resolve;
		});
		const staleRelease = releaseExplorationRunLock(first, {
			beforeTransition: async () => {
				validated();
				await transitionGate;
			},
		});
		const phase = await Promise.race([
			validationReached.then(() => "validated" as const),
			staleRelease.then(() => "completed" as const),
		]);
		expect(phase).toBe("validated");
		if (phase !== "validated") return;

		await recoverExplorationRunLock(root, {
			recoveryToken: first.token,
			hostname: hostname(),
			probePid: () => "dead",
		});
		const replacement = await acquireExplorationRunLock(root, "main", {
			pid: 4002,
			randomToken: () => "1".repeat(64),
		});
		releaseTransition();
		await staleRelease;
		expect(JSON.parse(readFileSync(join(replacement.lockPath, "owner.json"), "utf8")).token).toBe(
			replacement.token,
		);
		expect(existsSync(replacement.lockPath)).toBe(true);
		await releaseExplorationRunLock(replacement);
	});
});
