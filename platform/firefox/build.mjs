// Build wiring for the Firefox (AMO) target. Run after `tsc`:
//   npm install && npm run build && node platform/firefox/build.mjs
// `tsc` emits dist/src/**; this script stages dist/firefox/ as a loadable
// extension root (Firefox manifest + the compiled pieces the popup and the
// claude.ai content script need) and zips it for AMO upload.
//
// Zip tool, in order of preference: web-ext (npm i -D web-ext), then
// PowerShell Compress-Archive (Windows fallback). AMO accepts either zip.
import { execFileSync } from "node:child_process";
import { build as esbuildBuild } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = join(root, "dist");
const stage = join(dist, "firefox");
const artifacts = join(dist, "artifacts");

if (
	!existsSync(join(dist, "src", "ui", "popup.js")) ||
	!existsSync(join(dist, "src", "adapters", "claude", "content.js")) ||
	!existsSync(join(dist, "src", "adapters", "chatgpt", "content.js"))
) {
	console.error("dist/src output missing — run `tsc` first (npm run build).");
	process.exit(1);
}

// Content scripts must be CLASSIC scripts — transform tsc's ESM output to
// IIFE in place before staging (idempotent; also run by the Chrome build,
// which may have already done it depending on invocation order).
for (const rel of ["src/adapters/chatgpt/content.js", "src/adapters/claude/content.js"]) {
	await esbuildBuild({
		entryPoints: [join(dist, rel)],
		allowOverwrite: true,
		bundle: true,
		format: "iife",
		outfile: join(dist, rel),
		logLevel: "warning",
	});
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "src"), { recursive: true });
mkdirSync(join(stage, "platform", "icons"), { recursive: true });
mkdirSync(artifacts, { recursive: true });

cpSync(join(root, "platform", "firefox", "manifest.json"), join(stage, "manifest.json"));
// Copy only what this build actually loads: the popup (an ES module importing
// registry + core at runtime) and the content scripts named in the manifest.
// tsc does not clean outDir, so copying dist/src wholesale would sweep in
// stale outputs from removed modules.
cpSync(join(root, "platform", "icons"), join(stage, "platform", "icons"), { recursive: true });

for (const rel of ["src/ui", "src/core", "src/adapters/registry.js", "src/adapters/claude", "src/adapters/chatgpt"]) {
	cpSync(join(dist, rel), join(stage, rel), { recursive: true });
}

const { version } = JSON.parse(readFileSync(join(stage, "manifest.json"), "utf8"));
const artifact = join(artifacts, `curt_conversation_exporter-${version}.zip`);

function zipWithWebExt() {
	execFileSync(
		process.platform === "win32" ? "npx.cmd" : "npx",
		["web-ext", "build", `--source-dir=${stage}`, `--artifacts-dir=${artifacts}`, "--overwrite-dest"],
		{ stdio: "inherit", cwd: root },
	);
}

function zipWithPowerShell() {
	// web-ext absent: fall back to the platform zip. Compress-Archive uses
	// backslash separators in some versions; AMO accepts both layouts.
	execFileSync("powershell.exe", [
		"-NoProfile", "-Command",
		`Compress-Archive -Path (Join-Path '${stage.replaceAll("'", "''")}' '*') -DestinationPath '${artifact.replaceAll("'", "''")}' -Force`,
	]);
}

try {
	zipWithWebExt();
} catch {
	console.warn("web-ext not available — falling back to Compress-Archive.");
	zipWithPowerShell();
}

console.log(`Artifact: ${artifact}`);
console.log("Load unpacked for testing: about:debugging -> This Firefox -> Load Temporary Add-on -> dist/firefox/manifest.json");
