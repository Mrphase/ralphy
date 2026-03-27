#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";
const userArgs = process.argv.slice(2);

function getPlatformBinary() {
	const platform = process.platform;
	const arch = process.arch;

	const platformMap = {
		darwin: "darwin",
		linux: "linux",
		win32: "windows",
	};

	const archMap = {
		arm64: "arm64",
		aarch64: "arm64",
		x64: "x64",
		amd64: "x64",
	};

	const platformKey = platformMap[platform];
	const archKey = archMap[arch];

	if (!platformKey || !archKey) {
		console.error(`Unsupported platform: ${platform}-${arch}`);
		process.exit(1);
	}

	const ext = platform === "win32" ? ".exe" : "";
	const binaryName = `ralphy-${platformKey}-${archKey}${ext}`;

	return join(__dirname, "dist", binaryName);
}

/**
 * Check if a command exists in PATH
 */
function commandExists(name) {
	try {
		const cmd = isWindows ? "where" : "which";
		const result = spawnSync(cmd, [name], { stdio: "pipe" });
		return result.status === 0;
	} catch {
		return false;
	}
}

function resolveLocalCommand(name) {
	const ext = isWindows ? ".cmd" : "";
	const localPath = join(__dirname, "node_modules", ".bin", `${name}${ext}`);
	return existsSync(localPath) ? localPath : null;
}

function runCommand(command, args) {
	if (isWindows) {
		return spawnSync("cmd.exe", ["/c", command, ...args], {
			stdio: "inherit",
			cwd: process.cwd(),
		});
	}

	return spawnSync(command, args, {
		stdio: "inherit",
		cwd: process.cwd(),
	});
}

function ensureVersionFile() {
	const versionFilePath = join(__dirname, "src", "version.ts");
	if (existsSync(versionFilePath)) {
		return true;
	}

	const generatorPath = join(__dirname, "scripts", "generate-version.js");
	const result = spawnSync(process.execPath, [generatorPath], {
		stdio: "inherit",
		cwd: __dirname,
	});

	return result.status === 0;
}

function getDevRunners(srcPath) {
	const runners = [];
	const localTsx = resolveLocalCommand("tsx");

	if (localTsx) {
		runners.push({ command: localTsx, args: [srcPath] });
	}

	if (commandExists("tsx")) {
		runners.push({ command: "tsx", args: [srcPath] });
	}

	if (commandExists("bun")) {
		runners.push({ command: "bun", args: ["run", srcPath] });
	}

	if (commandExists("npx")) {
		runners.push({ command: "npx", args: ["--yes", "tsx", srcPath] });
	}

	return runners;
}

function main() {
	const binaryPath = getPlatformBinary();

	if (!existsSync(binaryPath)) {
		// Fallback: try running with tsx or bun directly (development mode)
		const srcPath = join(__dirname, "src", "index.ts");
		if (existsSync(srcPath)) {
			const nodeModulesPath = join(__dirname, "node_modules");
			if (!existsSync(nodeModulesPath)) {
				console.error("Dependencies are not installed.");
				console.error("Run 'npm install --no-package-lock' in the cli directory first.");
				process.exit(1);
			}

			if (!ensureVersionFile()) {
				console.error("Failed to generate cli/src/version.ts.");
				process.exit(1);
			}

			for (const runner of getDevRunners(srcPath)) {
				const result = runCommand(runner.command, [...runner.args, ...userArgs]);
				if (result.error === undefined) {
					process.exit(result.status ?? 1);
				}
			}
		}

		console.error(`Binary not found: ${binaryPath}`);
		console.error("For a local Windows clone, run 'cd cli && npm install --no-package-lock' first.");
		console.error("Then rerun this command; the launcher will generate cli/src/version.ts automatically.");
		console.error("If you prefer the compiled binary path, run 'bun run build:windows-x64'.");
		process.exit(1);
	}

	const result = spawnSync(binaryPath, userArgs, {
		stdio: "inherit",
		cwd: process.cwd(),
	});

	process.exit(result.status ?? 1);
}

main();
