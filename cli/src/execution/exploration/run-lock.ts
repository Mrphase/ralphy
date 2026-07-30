import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { hostname as osHostname } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "bun";
import { z } from "zod";

const OWNER_FILE = "owner.json";
const OwnerSchema = z
	.object({
		version: z.literal(1),
		token: z.string().regex(/^[0-9a-f]{64}$/),
		pid: z.number().int().positive().safe(),
		hostname: z.string().min(1).max(255),
		startedAt: z.string().datetime(),
		worktreePath: z.string().min(1).max(2000),
		baseBranch: z.string().min(1).max(300),
	})
	.strict();
export type ExplorationRunLockOwner = z.infer<typeof OwnerSchema>;
export interface ExplorationRunLock extends ExplorationRunLockOwner {
	lockPath: string;
}
export type PidState = "alive" | "dead" | "unverifiable";
export interface RunLockDependencies {
	pid?: number;
	hostname?: string;
	now?: () => Date;
	randomToken?: () => string;
	probePid?: (pid: number) => PidState;
	beforePublish?: () => void | Promise<void>;
}
export class ExplorationRunLockCollisionError extends Error {
	constructor(
		public lockPath: string,
		public ownerEvidence: string,
		public recoveryToken: string | null,
	) {
		super(
			recoveryToken
				? `Exploration run already locked at ${lockPath}. Owner: ${ownerEvidence}. Recover with: ralphy --explore-recover-lock ${recoveryToken}`
				: `Exploration run already locked at ${lockPath}. Owner: ${ownerEvidence}. Automatic recovery is unavailable because no valid recovery token could be read.`,
		);
		this.name = "ExplorationRunLockCollisionError";
	}
}

async function git(workDir: string, args: string[]): Promise<string> {
	const process = spawn(["git", ...args], { cwd: workDir, stdout: "pipe", stderr: "pipe" });
	const output = await new Response(process.stdout).text();
	const error = await new Response(process.stderr).text();
	if ((await process.exited) !== 0)
		throw new Error(`git ${args.join(" ")} failed: ${error.slice(0, 1000)}`);
	return output.trim();
}

export async function getExplorationRunLockPath(workDir: string): Promise<string> {
	const canonicalWorktree = await realpath(workDir);
	const common = await git(canonicalWorktree, ["rev-parse", "--git-common-dir"]);
	const commonPath = await realpath(
		isAbsolute(common) ? common : resolve(canonicalWorktree, common),
	);
	return join(commonPath, "ralphy-exploration-run.lock");
}

const ownerPath = (lockPath: string) => join(lockPath, OWNER_FILE);
const boundedRead = async (path: string) => {
	const handle = await open(path, "r");
	try {
		const buffer = Buffer.alloc(16_385);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		if (bytesRead > 16_384) throw new Error("lock owner file is oversized");
		return buffer.subarray(0, bytesRead).toString("utf8");
	} finally {
		await handle.close();
	}
};
const parseOwner = async (lockPath: string) =>
	OwnerSchema.parse(JSON.parse(await boundedRead(ownerPath(lockPath))));
const transitionPath = (lockPath: string, owner: ExplorationRunLockOwner) => {
	const stamp = owner.startedAt.replace(/[:.]/g, "-");
	return join(dirname(lockPath), `ralphy-exploration-run.lock.quarantine-${stamp}-${owner.token}`);
};
const pathExists = async (path: string) => {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
};

export async function acquireExplorationRunLock(
	workDir: string,
	baseBranch: string,
	deps: RunLockDependencies = {},
): Promise<ExplorationRunLock> {
	const lockPath = await getExplorationRunLockPath(workDir);
	const owner: ExplorationRunLockOwner = OwnerSchema.parse({
		version: 1,
		token: deps.randomToken?.() ?? randomBytes(32).toString("hex"),
		pid: deps.pid ?? process.pid,
		hostname: deps.hostname ?? osHostname(),
		startedAt: (deps.now?.() ?? new Date()).toISOString(),
		worktreePath: await realpath(workDir),
		baseBranch,
	});
	const temporaryPath = `${lockPath}.owner-${owner.token}`;
	let published = false;
	try {
		await mkdir(temporaryPath, { mode: 0o700 });
		const handle = await open(ownerPath(temporaryPath), "wx", 0o600);
		try {
			await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		await deps.beforePublish?.();
		try {
			await rename(temporaryPath, lockPath);
			published = true;
		} catch (publishError) {
			if (!(await pathExists(lockPath))) throw publishError;
			let evidence = "unreadable owner";
			let token: string | null = null;
			try {
				const existing = await parseOwner(lockPath);
				evidence = JSON.stringify(existing).slice(0, 4000);
				token = existing.token;
			} catch (readError) {
				evidence = `invalid owner (${readError instanceof Error ? readError.message.slice(0, 500) : "unknown"})`;
			}
			throw new ExplorationRunLockCollisionError(lockPath, evidence, token);
		}
	} finally {
		if (!published) await rm(temporaryPath, { recursive: true, force: true });
	}
	return { ...owner, lockPath };
}

export interface ReleaseOptions {
	beforeTransition?: () => void | Promise<void>;
}
export async function releaseExplorationRunLock(
	lock: ExplorationRunLock,
	options: ReleaseOptions = {},
): Promise<void> {
	let owner: ExplorationRunLockOwner;
	try {
		owner = await parseOwner(lock.lockPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		return;
	}
	if (owner.token !== lock.token) return;
	const releasedPath = transitionPath(lock.lockPath, owner);
	await options.beforeTransition?.();
	try {
		await rename(lock.lockPath, releasedPath);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "EEXIST" || code === "ENOTEMPTY" || code === "EPERM") return;
		throw error;
	}
	const moved = await parseOwner(releasedPath);
	if (moved.token !== owner.token) {
		if (!(await pathExists(lock.lockPath))) await rename(releasedPath, lock.lockPath);
		throw new Error("release lock identity changed during transition");
	}
}

const defaultProbePid = (pid: number): PidState => {
	try {
		process.kill(pid, 0);
		return "alive";
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code === "ESRCH" ? "dead" : "unverifiable";
	}
};
export interface RecoveryOptions {
	recoveryToken: string;
	hostname?: string;
	probePid?: (pid: number) => PidState;
	now?: () => Date;
	beforeQuarantine?: () => void | Promise<void>;
}
export async function recoverExplorationRunLock(
	workDir: string,
	options: RecoveryOptions,
): Promise<string> {
	const lockPath = await getExplorationRunLockPath(workDir);
	const owner = await parseOwner(lockPath);
	if (owner.token !== options.recoveryToken) throw new Error("recovery token mismatch");
	if (owner.hostname !== (options.hostname ?? osHostname()))
		throw new Error("recovery hostname mismatch");
	if ((options.probePid ?? defaultProbePid)(owner.pid) !== "dead")
		throw new Error("owner PID is alive or unverifiable");
	await options.beforeQuarantine?.();

	const quarantine = transitionPath(lockPath, owner);

	await rename(lockPath, quarantine);
	const moved = await parseOwner(quarantine);
	if (moved.token !== owner.token) {
		if (!(await pathExists(lockPath))) await rename(quarantine, lockPath);
		throw new Error("recovery lock identity changed during transition");
	}
	return quarantine;
}

export type ExploreRunLock = ExplorationRunLock;
export const acquireExploreRunLock = acquireExplorationRunLock;
export const releaseExploreRunLock = releaseExplorationRunLock;
export async function quarantineConfirmedDeadExploreLock(
	workDir: string,
	expectedToken: string,
	deps: Omit<RecoveryOptions, "recoveryToken"> = {},
): Promise<string> {
	return recoverExplorationRunLock(workDir, {
		...deps,
		recoveryToken: expectedToken,
	});
}
